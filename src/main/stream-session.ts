import { randomUUID } from 'node:crypto'
import { Context, Effect, Exit, Layer, PubSub, Ref, Scope, Stream, SubscriptionRef } from 'effect'
import { TorrentError } from '../shared/errors'
import type { IpcEventPayload, StreamState } from '../shared/ipc'
import { serveFile } from './file-server'
import {
  readTorrentSource,
  TorrentEngine,
  type TorrentFile,
  type TorrentFileInfo,
  type TorrentHandle,
  type TorrentProbe,
  type TorrentStatus,
} from './torrent'

export interface TorrentSummary extends TorrentStatus {
  readonly infoHash: string
}

/** The hint the renderer gives when it already knows which file to play. */
export interface OpenRequest {
  /** A magnet link, info hash, or a `file:<path>` collection entry. */
  readonly source: string
  /** An explicit file index from `/select`. */
  readonly fileIndex?: number
  /** A file-name fragment (e.g. a release name). */
  readonly fileHint?: string
  /** Season and episode to match when no explicit index is given. */
  readonly season?: string
  readonly episode?: string
  readonly downloadPath: string
  /** 0 or omitted picks an ephemeral port. */
  readonly port?: number
  /** The only origin allowed to receive CORS headers; never reflected blindly. */
  readonly origin: string
}

export interface StreamSessionHandle {
  readonly id: string
}

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v']

function isVideo(name: string): boolean {
  const lower = name.toLowerCase()
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** `S01E02`, `1x02` or `E02`, matching how the legacy picked the episode file. */
export function matchesEpisode(name: string, season: string, episode: string): boolean {
  const patterns = [
    new RegExp(`s0*${Number(season)}e0*${Number(episode)}`, 'i'),
    new RegExp(`\\b${Number(season)}x0*${Number(episode)}\\b`, 'i'),
    new RegExp(`\\bE0*${Number(episode)}\\b`, 'i'),
  ]
  return patterns.some((pattern) => pattern.test(name))
}

/**
 * The legacy file choice: an explicit index wins; otherwise the episode whose name matches
 * the requested season/episode; otherwise the largest video file (largest file if none is
 * recognisably a video).
 */
export function chooseFile(files: ReadonlyArray<TorrentFileInfo>, request: OpenRequest): number {
  if (request.fileIndex !== undefined && files[request.fileIndex] !== undefined) {
    return request.fileIndex
  }
  if (request.fileHint !== undefined && request.fileHint !== '') {
    const hint = request.fileHint.toLowerCase()
    const match = files.find((file) => file.name.toLowerCase().includes(hint))
    if (match !== undefined) return match.index
  }
  if (request.season !== undefined && request.episode !== undefined) {
    const match = files.find((file) =>
      matchesEpisode(file.name, request.season ?? '', request.episode ?? ''),
    )
    if (match !== undefined) return match.index
  }
  const videos = files.filter((file) => isVideo(file.name))
  const pool = videos.length > 0 ? videos : files
  return pool.reduce((best, file) => (file.length > best.length ? file : best)).index
}

interface Session {
  readonly id: string
  readonly infoHash: string
  readonly scope: Scope.CloseableScope
  readonly ref: SubscriptionRef.SubscriptionRef<StreamState>
  readonly handle: TorrentHandle
}

export interface StreamSessionShape {
  /** Opens a session and returns its id immediately; `states(id)` reports the loading state. */
  readonly open: (request: OpenRequest) => Effect.Effect<StreamSessionHandle, TorrentError>
  readonly states: (id: string) => Stream.Stream<StreamState>
  /** The latest state for a session, or undefined when it is gone. */
  readonly current: (id: string) => Effect.Effect<StreamState | undefined>
  /** Every state change across sessions, for the renderer event publisher. */
  readonly stateEvents: Stream.Stream<StreamState>
  readonly close: (id: string) => Effect.Effect<void>
  /** Stops every session for a torrent; used when a torrent is removed from the seedbox. */
  readonly closeAll: (infoHash: string) => Effect.Effect<void>
  /** Lists the files inside a torrent so the renderer can pick one to play. */
  readonly files: (
    torrentId: string,
    downloadPath: string,
  ) => Effect.Effect<TorrentProbe, TorrentError>
  readonly list: Effect.Effect<ReadonlyArray<TorrentSummary>>
  readonly pause: (infoHash: string) => Effect.Effect<void>
  readonly resume: (infoHash: string) => Effect.Effect<void>
  /** Progress for every live session, tagged with its info hash for the renderer event. */
  readonly progress: Stream.Stream<IpcEventPayload<'streams:progress'>>
}

export class StreamSession extends Context.Tag('StreamSession')<
  StreamSession,
  StreamSessionShape
>() {}

const ZERO_PROGRESS = {
  downloaded: 0,
  uploaded: 0,
  speed: 0,
  uploadSpeed: 0,
  peers: 0,
  progress: 0,
  length: 0,
  timeRemaining: Number.POSITIVE_INFINITY,
} as const

/**
 * One playing torrent from `open` to `close`: it owns file choice, the legacy loading state
 * machine, progress and the loopback URL. Resources are acquired in the session scope so
 * `close` releases the file server and the torrent handle together.
 */
export const StreamSessionLive = Layer.scoped(
  StreamSession,
  Effect.gen(function* () {
    const engine = yield* TorrentEngine
    const layerScope = yield* Effect.scope
    const sessions = yield* Ref.make(new Map<string, Session>())
    const stateBus = yield* PubSub.unbounded<StreamState>()
    const progressBus = yield* PubSub.unbounded<IpcEventPayload<'streams:progress'>>()

    const sessionsFor = (
      current: ReadonlyMap<string, Session>,
      infoHash: string,
    ): ReadonlyArray<Session> =>
      [...current.values()].filter((session) => session.infoHash === infoHash)

    const patch = (
      ref: SubscriptionRef.SubscriptionRef<StreamState>,
      changes: Partial<StreamState>,
    ): Effect.Effect<void> => SubscriptionRef.update(ref, (state) => ({ ...state, ...changes }))

    const publish = (state: StreamState): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* PubSub.publish(stateBus, state)
        if (state.state !== 'connecting' && state.state !== 'closed') {
          yield* PubSub.publish(progressBus, {
            infoHash: state.infoHash,
            downloaded: state.downloaded,
            uploaded: state.uploaded,
            speed: state.speed,
            uploadSpeed: state.uploadSpeed,
            peers: state.peers,
            progress: state.progress,
            length: state.length,
            timeRemaining: state.timeRemaining,
          })
        }
      })

    const open: StreamSessionShape['open'] = (request) =>
      Effect.gen(function* () {
        const id = randomUUID()
        const scope = yield* Scope.make()
        // The session scope closes with the layer, so nothing leaks past `dispose`.
        yield* Scope.addFinalizer(layerScope, Scope.close(scope, Exit.void))

        const initial: StreamState = {
          id,
          infoHash: '',
          state: 'connecting',
          url: '',
          port: 0,
          ...ZERO_PROGRESS,
        }
        const ref = yield* SubscriptionRef.make(initial)
        yield* Scope.addFinalizer(
          scope,
          patch(ref, { state: 'closed' }).pipe(
            Effect.zipRight(publish({ ...initial, state: 'closed' })),
          ),
        )

        const work = Effect.gen(function* () {
          const source = yield* readTorrentSource(request.source)
          const handle = yield* engine.load(source, request.downloadPath)
          const session: Session = { id, infoHash: handle.infoHash, scope, ref, handle }
          yield* Ref.update(sessions, (current) => new Map(current).set(id, session))
          yield* patch(ref, { infoHash: handle.infoHash, state: 'startingDownload' })
          yield* publish(yield* SubscriptionRef.get(ref))

          const files = handle.files.map((file, index) => ({ index, ...file }))
          const fileIndex = chooseFile(files, request)
          yield* handle.resume
          const file = yield* handle.select(fileIndex)
          yield* patch(ref, {
            state: 'downloading',
            name: file.name,
            length: file.length,
          })
          yield* publish(yield* SubscriptionRef.get(ref))

          const served = yield* serveFile({
            file,
            fileIndex,
            createStream: (range) => handle.createReadStream(fileIndex, range),
            port: request.port ?? 0,
            origin: request.origin,
          })
          yield* patch(ref, { state: 'ready', url: served.url, port: served.port })
          yield* publish(yield* SubscriptionRef.get(ref))

          yield* handle.progress.pipe(
            Stream.runForEach((progress) =>
              Effect.gen(function* () {
                yield* patch(ref, {
                  ...progress,
                  state: progress.progress >= 1 ? 'ready' : 'downloading',
                })
                yield* publish(yield* SubscriptionRef.get(ref))
              }),
            ),
            Effect.forkIn(scope),
          )
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* patch(ref, { state: 'failed', message: error.message })
              yield* publish(yield* SubscriptionRef.get(ref))
            }),
          ),
          // `serveFile` acquires its server in a Scope; the session scope is the ambient one.
          Effect.provideService(Scope.Scope, scope),
          Effect.forkIn(scope),
        )

        yield* work

        return { id }
      })

    const close: StreamSessionShape['close'] = (id) =>
      Effect.gen(function* () {
        const session = (yield* Ref.get(sessions)).get(id)
        if (session === undefined) return
        yield* Ref.update(sessions, (current) => {
          const next = new Map(current)
          next.delete(id)
          return next
        })
        yield* Scope.close(session.scope, Exit.void)
        if (sessionsFor(yield* Ref.get(sessions), session.infoHash).length === 0) {
          yield* session.handle.pause
        }
      })

    const closeAll: StreamSessionShape['closeAll'] = (infoHash) =>
      Effect.gen(function* () {
        for (const session of sessionsFor(yield* Ref.get(sessions), infoHash)) {
          yield* close(session.id)
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

    const files: StreamSessionShape['files'] = (torrentId, downloadPath) =>
      Effect.gen(function* () {
        const source = yield* readTorrentSource(torrentId)
        const handle = yield* engine.load(source, downloadPath)
        const list: ReadonlyArray<TorrentFileInfo> = handle.files.map(
          (file: TorrentFile, index) => ({ index, name: file.name, length: file.length }),
        )
        // Kept loaded: webtorrent crashes if a torrent is destroyed while its metadata
        // handlers are still firing, and a following stream start reuses it by info hash.
        return { infoHash: handle.infoHash, files: list, handle }
      }).pipe(
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

    return StreamSession.of({
      open,
      states: (id) =>
        Stream.unwrap(
          Ref.get(sessions).pipe(
            Effect.map((current) => {
              const session = current.get(id)
              return session === undefined ? Stream.empty : session.ref.changes
            }),
          ),
        ),
      stateEvents: Stream.fromPubSub(stateBus),
      current: (id) =>
        Effect.gen(function* () {
          const session = (yield* Ref.get(sessions)).get(id)
          return session === undefined ? undefined : yield* SubscriptionRef.get(session.ref)
        }),
      close,
      closeAll,
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
      progress: Stream.fromPubSub(progressBus),
    })
  }),
)
