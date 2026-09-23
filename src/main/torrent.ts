import { readFile } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { Context, Effect, Layer, type Scope, type Stream } from 'effect'
import { TorrentError } from '../shared/errors'
import { type ByteRange, serveFile } from './file-server'

export type { ByteRange } from './file-server'
export { parseRange } from './file-server'

/** A magnet link, an info hash, or the bytes of a `.torrent` file. */
export type TorrentSource = string | Uint8Array

/**
 * Collection entries store `.torrent` files as `file:<path>`; webtorrent wants the bytes.
 * Magnets and info hashes pass through untouched.
 */
export function readTorrentSource(source: string): Effect.Effect<TorrentSource, TorrentError> {
  if (!source.startsWith('file:')) return Effect.succeed(source)
  const path = source.slice('file:'.length)
  return Effect.tryPromise({
    try: () => readFile(path),
    catch: (cause) =>
      new TorrentError({ message: `cannot read torrent file at ${path}`, infoHash: source, cause }),
  })
}

export interface TorrentProgress {
  readonly downloaded: number
  readonly uploaded: number
  readonly speed: number
  readonly peers: number
  readonly progress: number
  readonly length: number
  readonly timeRemaining: number
}

export interface TorrentFile {
  readonly name: string
  readonly length: number
}

export interface TorrentFileInfo extends TorrentFile {
  readonly index: number
}

/** The file list of a torrent, read without keeping it loaded. */
export interface TorrentProbe {
  readonly infoHash: string
  readonly files: ReadonlyArray<TorrentFileInfo>
  /** The loaded torrent, so a following stream start does not load it twice. */
  readonly handle: TorrentHandle
}

/** Everything the seedbox shows about a loaded torrent, read at call time. */
export interface TorrentStatus {
  readonly name: string
  readonly length: number
  readonly downloaded: number
  readonly uploaded: number
  readonly downloadSpeed: number
  readonly uploadSpeed: number
  readonly peers: number
  readonly progress: number
  readonly paused: boolean
  readonly files: ReadonlyArray<TorrentFileInfo>
}

/** One loaded torrent. The engine port keeps webtorrent out of the service's tests. */
export interface TorrentHandle {
  readonly infoHash: string
  readonly files: ReadonlyArray<TorrentFile>
  readonly status: () => TorrentStatus
  readonly select: (fileIndex: number) => Effect.Effect<TorrentFile, TorrentError>
  readonly progress: Stream.Stream<TorrentProgress>
  readonly createReadStream: (fileIndex: number, range?: ByteRange) => Readable
  readonly pause: Effect.Effect<void>
  readonly resume: Effect.Effect<void>
  readonly destroy: Effect.Effect<void>
}

export interface TorrentEngineShape {
  readonly load: (
    source: TorrentSource,
    downloadPath: string,
  ) => Effect.Effect<TorrentHandle, TorrentError>
}

export class TorrentEngine extends Context.Tag('TorrentEngine')<
  TorrentEngine,
  TorrentEngineShape
>() {}

export interface StreamRequest {
  /** A magnet link, info hash, or a `file:<path>` collection entry. */
  readonly torrentId: string
  readonly fileIndex: number
  readonly downloadPath: string
  /** 0 or omitted picks an ephemeral port. */
  readonly port?: number
  /** The only origin allowed to receive CORS headers; never reflected blindly. */
  readonly origin: string
}

export interface StreamSession {
  readonly infoHash: string
  readonly port: number
  readonly url: string
  readonly progress: Stream.Stream<TorrentProgress>
  readonly handle: TorrentHandle
}

export interface TorrentServiceShape {
  readonly start: (
    request: StreamRequest,
  ) => Effect.Effect<StreamSession, TorrentError, Scope.Scope>
  /** Loads the torrent just far enough to list its files, then releases it. */
  readonly probe: (
    torrentId: string,
    downloadPath: string,
  ) => Effect.Effect<TorrentProbe, TorrentError>
}

export class TorrentService extends Context.Tag('TorrentService')<
  TorrentService,
  TorrentServiceShape
>() {}

export const TorrentServiceLive = Layer.effect(
  TorrentService,
  Effect.map(TorrentEngine, (engine) =>
    TorrentService.of({
      start: (request) =>
        Effect.gen(function* () {
          const source = yield* readTorrentSource(request.torrentId)
          const handle = yield* engine.load(source, request.downloadPath)
          // A previous session may have paused this torrent; starting a stream resumes it.
          yield* handle.resume
          const file = yield* handle.select(request.fileIndex)
          const served = yield* serveFile({
            file,
            fileIndex: request.fileIndex,
            createStream: (range) => handle.createReadStream(request.fileIndex, range),
            port: request.port ?? 0,
            origin: request.origin,
          })
          return {
            infoHash: handle.infoHash,
            port: served.port,
            url: served.url,
            progress: handle.progress,
            handle,
          }
        }),
      probe: (torrentId, downloadPath) =>
        Effect.gen(function* () {
          const source = yield* readTorrentSource(torrentId)
          const handle = yield* engine.load(source, downloadPath)
          const files = handle.files.map((file, index) => ({
            index,
            name: file.name,
            length: file.length,
          }))
          // Kept loaded: webtorrent crashes if a torrent is destroyed while its metadata
          // handlers are still firing, and the stream start reuses it by info hash anyway.
          return { infoHash: handle.infoHash, files, handle }
        }),
    }),
  ),
)
