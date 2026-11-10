import { Context, Effect, Exit, Layer, PubSub, Ref, Scope, Stream } from 'effect'
import { TorrentError } from '../shared/errors'
import type { IpcEventPayload } from '../shared/ipc'
import type { TorrentHandle, TorrentProbe, TorrentStatus } from './torrent'
import { type StreamRequest, TorrentService } from './torrent'

export interface StreamHandle {
  readonly infoHash: string
  readonly port: number
  readonly url: string
}

export interface TorrentSummary extends TorrentStatus {
  readonly infoHash: string
}

interface Session {
  readonly infoHash: string
  readonly port: number
  readonly scope: Scope.CloseableScope
  readonly handle: TorrentHandle
}

export interface StreamManagerShape {
  readonly start: (request: StreamRequest) => Effect.Effect<StreamHandle, TorrentError>
  /**
   * Stops one stream session, identified by the port it is served on. Sessions are keyed
   * by port, not info hash: two sessions can share one torrent (StrictMode remounts,
   * external players) and stopping one must not close the other's server.
   */
  readonly stopSession: (port: number) => Effect.Effect<void>
  /** Stops every session for a torrent; used when a torrent is removed from the seedbox. */
  readonly stop: (infoHash: string) => Effect.Effect<void>
  /** Lists the files inside a torrent so the renderer can pick one to play. */
  readonly files: (
    torrentId: string,
    downloadPath: string,
  ) => Effect.Effect<TorrentProbe, TorrentError>
  /** Every live torrent, for the seedbox view. */
  readonly list: Effect.Effect<ReadonlyArray<TorrentSummary>>
  readonly pause: (infoHash: string) => Effect.Effect<void>
  readonly resume: (infoHash: string) => Effect.Effect<void>
  /** Progress for every live session, tagged with its info hash for the renderer event. */
  readonly progress: Stream.Stream<IpcEventPayload<'streams:progress'>>
}

export class StreamManager extends Context.Tag('StreamManager')<
  StreamManager,
  StreamManagerShape
>() {}

/**
 * Keeps torrent sessions alive beyond the IPC call that starts them: each session's
 * scope is stored under its info hash and closed by `stop` (or when the layer ends).
 */
export const StreamManagerLive = Layer.scoped(
  StreamManager,
  Effect.gen(function* () {
    const torrents = yield* TorrentService
    const sessions = yield* Ref.make(new Map<number, Session>())
    const events = yield* PubSub.unbounded<IpcEventPayload<'streams:progress'>>()

    const sessionsFor = (
      current: ReadonlyMap<number, Session>,
      infoHash: string,
    ): ReadonlyArray<Session> =>
      [...current.values()].filter((session) => session.infoHash === infoHash)

    const start: StreamManagerShape['start'] = (request) =>
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const session = yield* Scope.extend(torrents.start(request), scope)
        yield* Ref.update(sessions, (current) =>
          new Map(current).set(session.port, {
            infoHash: session.infoHash,
            port: session.port,
            scope,
            handle: session.handle,
          }),
        )
        yield* session.progress.pipe(
          Stream.map((progress) => ({ ...progress, infoHash: session.infoHash })),
          Stream.runForEach((progress) => PubSub.publish(events, progress)),
          Effect.forkIn(scope),
        )
        return { infoHash: session.infoHash, port: session.port, url: session.url }
      })

    const stopSession: StreamManagerShape['stopSession'] = (port) =>
      Effect.gen(function* () {
        const session = (yield* Ref.get(sessions)).get(port)
        if (session === undefined) return
        yield* Ref.update(sessions, (current) => {
          const next = new Map(current)
          next.delete(port)
          return next
        })
        yield* Scope.close(session.scope, Exit.void)
        // Pausing stops the traffic, but only once nothing streams the torrent any more:
        // sessions share one loaded torrent, so pausing here would stall the other one.
        if (sessionsFor(yield* Ref.get(sessions), session.infoHash).length === 0) {
          yield* session.handle.pause
        }
      })

    const stop: StreamManagerShape['stop'] = (infoHash) =>
      Effect.gen(function* () {
        for (const session of sessionsFor(yield* Ref.get(sessions), infoHash)) {
          yield* stopSession(session.port)
        }
      })

    const withHandle = (
      infoHash: string,
      act: (handle: TorrentHandle) => Effect.Effect<void>,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const session = sessionsFor(yield* Ref.get(sessions), infoHash)[0]
        if (session === undefined) return
        yield* act(session.handle)
      })

    /** Probed torrents stay loaded for the file picker; the next probe releases the last one. */
    const probes = yield* Ref.make(new Map<string, TorrentHandle>())

    const files: StreamManagerShape['files'] = (torrentId, downloadPath) =>
      Effect.gen(function* () {
        // Without this the picker spins forever when a magnet finds no peers.
        const probe = yield* torrents.probe(torrentId, downloadPath).pipe(
          Effect.timeout('60 seconds'),
          Effect.catchTag('TimeoutException', () =>
            Effect.fail(
              new TorrentError({
                message: 'no peers answered for this torrent (metadata timed out)',
                infoHash: torrentId,
              }),
            ),
          ),
        )
        const previous = yield* Ref.get(probes)
        for (const [hash, handle] of previous) {
          if (hash !== probe.infoHash && sessionsFor(yield* Ref.get(sessions), hash).length === 0) {
            yield* handle.destroy
          }
        }
        yield* Ref.set(
          probes,
          new Map(
            sessionsFor(yield* Ref.get(sessions), probe.infoHash).length === 0
              ? [[probe.infoHash, probe.handle]]
              : [],
          ),
        )
        return probe
      })

    return StreamManager.of({
      start,
      stopSession,
      stop,
      files,
      list: Effect.map(Ref.get(sessions), (current) => {
        const byHash = new Map<string, Session>()
        for (const session of current.values()) byHash.set(session.infoHash, session)
        return [...byHash.values()].map((session) => ({
          infoHash: session.infoHash,
          ...session.handle.status(),
        }))
      }),
      pause: (infoHash) => withHandle(infoHash, (handle) => handle.pause),
      resume: (infoHash) => withHandle(infoHash, (handle) => handle.resume),
      progress: Stream.fromPubSub(events),
    })
  }),
)
