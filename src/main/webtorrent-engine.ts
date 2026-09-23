import { Effect, Layer, Stream } from 'effect'
import type WebTorrent from 'webtorrent'
import type { WebTorrentTorrent } from 'webtorrent'
import { TorrentError } from '../shared/errors'
import type { Settings } from '../shared/settings'
import { DEFAULT_TRACKERS, SettingsService } from './settings'
import {
  TorrentEngine,
  type TorrentHandle,
  type TorrentProgress,
  type TorrentSource,
  type TorrentStatus,
} from './torrent'

function progressStream(torrent: WebTorrentTorrent): Stream.Stream<TorrentProgress> {
  return Stream.asyncPush<TorrentProgress>((emit) => {
    const onDownload = () => {
      emit.single({
        downloaded: torrent.downloaded,
        uploaded: torrent.uploaded,
        speed: torrent.downloadSpeed,
        peers: torrent.numPeers,
        progress: torrent.progress,
        length: torrent.length,
        // webtorrent's own `timeRemaining` getter, recomputed here because its types omit it.
        timeRemaining:
          torrent.downloadSpeed > 0
            ? ((torrent.length - torrent.downloaded) / torrent.downloadSpeed) * 1000
            : Number.POSITIVE_INFINITY,
      })
    }
    torrent.on('download', onDownload)
    return Effect.sync(() => torrent.off('download', onDownload))
  })
}

function statusOf(torrent: WebTorrentTorrent): TorrentStatus {
  return {
    name: torrent.name,
    length: torrent.length,
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    peers: torrent.numPeers,
    progress: torrent.progress,
    paused: torrent.paused,
    files: torrent.files.map((file, index) => ({
      index,
      name: file.name,
      length: file.length,
    })),
  }
}

function handleOf(torrent: WebTorrentTorrent): TorrentHandle {
  const fileAt = (index: number) => {
    const file = torrent.files[index]
    if (file === undefined) {
      throw new TorrentError({
        message: `file index ${index} out of range`,
        infoHash: torrent.infoHash,
      })
    }
    return file
  }

  return {
    infoHash: torrent.infoHash,
    files: torrent.files.map((file) => ({ name: file.name, length: file.length })),
    status: () => statusOf(torrent),
    pause: Effect.sync(() => torrent.pause()),
    resume: Effect.sync(() => torrent.resume()),
    select: (index) =>
      Effect.try({
        try: () => {
          torrent.select(index, 1)
          const file = fileAt(index)
          return { name: file.name, length: file.length }
        },
        catch: (cause) =>
          new TorrentError({
            message: `cannot select file ${index}`,
            infoHash: torrent.infoHash,
            cause,
          }),
      }),
    progress: progressStream(torrent),
    createReadStream: (index, range) => {
      const file = fileAt(index)
      return range === undefined
        ? file.createReadStream()
        : file.createReadStream({ start: range.start, end: range.end })
    },
    destroy: Effect.sync(() => torrent.destroy()),
  }
}

function load(
  client: WebTorrent,
  source: TorrentSource,
  downloadPath: string,
): Effect.Effect<TorrentHandle, TorrentError> {
  return Effect.async<TorrentHandle, TorrentError>((resume) => {
    // Reuse an already loaded torrent: adding the same info hash again fails with
    // "duplicate torrent", which used to surface as a playback error. `client.get` is
    // async, so the info hash is matched against the client's torrents directly.
    const hash = typeof source === 'string' ? /btih:([0-9a-fA-F]{40})/.exec(source)?.[1] : undefined
    const existing =
      hash === undefined
        ? undefined
        : client.torrents.find((torrent) => torrent.infoHash.toLowerCase() === hash.toLowerCase())
    if (existing !== undefined) {
      const reuse = () => resume(Effect.succeed(handleOf(existing)))
      if (existing.ready === true) {
        reuse()
        return
      }
      const onReady = () => {
        existing.off('error', onError)
        reuse()
      }
      const onError = (cause: Error) => {
        existing.off('ready', onReady)
        resume(
          Effect.fail(
            new TorrentError({
              message: 'cannot load torrent',
              infoHash: typeof source === 'string' ? source : 'torrent file',
              cause,
            }),
          ),
        )
      }
      existing.once('ready', onReady)
      existing.once('error', onError)
      return Effect.sync(() => {
        existing.off('ready', onReady)
        existing.off('error', onError)
      })
    }

    const torrent = client.add(source, { path: downloadPath }, (ready) => {
      resume(Effect.succeed(handleOf(ready)))
    })
    const onError = (cause: Error) => {
      // webtorrent rejects the second add of an info hash and hands back the first torrent.
      const duplicate = /duplicate torrent ([0-9a-fA-F]+)/.exec(cause.message)
      if (duplicate?.[1] !== undefined) {
        const loaded = client.torrents.find(
          (candidate) => candidate.infoHash.toLowerCase() === duplicate[1]?.toLowerCase(),
        )
        if (loaded !== undefined) {
          resume(Effect.succeed(handleOf(loaded)))
          return
        }
      }
      resume(
        Effect.fail(
          new TorrentError({
            message: 'cannot load torrent',
            infoHash: typeof source === 'string' ? source : 'torrent file',
            cause,
          }),
        ),
      )
    }
    torrent.on('error', onError)
    return Effect.sync(() => torrent.off('error', onError))
  })
}

/** The webtorrent client options the engine derives from settings. */
export interface WebTorrentOptions {
  readonly maxConns?: number
  readonly downloadLimit?: number
  readonly uploadLimit?: number
  readonly dhtConcurrency?: number
  readonly secure?: boolean
  readonly announce?: ReadonlyArray<string>
}

/** The runtime-tunable limits, applied to the running client from settings changes. */
export interface LiveLimits {
  readonly maxConns: number
  readonly downloadLimit: number
  readonly uploadLimit: number
}

/**
 * The limits that can change while the client runs. `maxConns` and the speed limits are
 * runtime properties in webtorrent; DHT concurrency and protocol encryption are constructor
 * options and still need a restart, which is why the metadata marks the latter `restart`.
 */
export function liveLimits(snapshot: Settings): LiveLimits {
  return {
    maxConns: snapshot.connectionLimit,
    downloadLimit: Number.parseFloat(snapshot.downloadLimit) * snapshot.maxLimitMult || -1,
    uploadLimit: Number.parseFloat(snapshot.uploadLimit) * snapshot.maxLimitMult || -1,
  }
}

/**
 * Real engine: one webtorrent client for the process, torn down with the layer's scope. It
 * reads its connection options from `Settings` when the layer is built, so migration runs
 * first and no separate settings probe is needed. webtorrent 3.x is ESM with top-level await,
 * so it is loaded through a dynamic import — a static import compiles to `require()` in the
 * CJS main bundle and fails at boot.
 */
export const WebTorrentEngineLive = Layer.scoped(
  TorrentEngine,
  Effect.gen(function* () {
    const settings = yield* SettingsService
    const snapshot = yield* settings.snapshot
    const options: WebTorrentOptions = {
      maxConns: snapshot.connectionLimit,
      dhtConcurrency: snapshot.maxUdpReqLimit,
      secure: snapshot.protocolEncryption,
      announce: snapshot.trackers.forced.length > 0 ? snapshot.trackers.forced : DEFAULT_TRACKERS,
      downloadLimit: Number.parseFloat(snapshot.downloadLimit) * snapshot.maxLimitMult || -1,
      uploadLimit: Number.parseFloat(snapshot.uploadLimit) * snapshot.maxLimitMult || -1,
    }
    console.log(
      `[torrent] announce=${options.announce?.length ?? 0} maxConns=${String(options.maxConns)} dht=${String(options.dhtConcurrency)} secure=${String(options.secure)}`,
    )
    const module = yield* Effect.promise(() => import('webtorrent'))
    const client = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new module.default({
            maxConns: options.maxConns,
            downloadLimit: options.downloadLimit,
            uploadLimit: options.uploadLimit,
            dht: { concurrency: options.dhtConcurrency },
            secure: options.secure,
            tracker: { announce: options.announce },
          }),
      ),
      (instance) =>
        Effect.async<void>((resume) => {
          instance.destroy(() => resume(Effect.void))
        }),
    )
    // Live apply: connection and speed limit changes reach the running client in one tick.
    yield* settings.changes.pipe(
      Stream.runForEach(() =>
        Effect.gen(function* () {
          const current = yield* settings.snapshot
          const limits = liveLimits(current)
          client.maxConns = limits.maxConns
          client.throttleDownload(limits.downloadLimit)
          client.throttleUpload(limits.uploadLimit)
        }),
      ),
      Effect.forkScoped,
    )
    return TorrentEngine.of({
      load: (torrentId, downloadPath) => load(client, torrentId, downloadPath),
    })
  }),
)
