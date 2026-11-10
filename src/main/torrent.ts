import { readFile } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { Context, Effect, type Stream } from 'effect'
import { TorrentError } from '../shared/errors'
import type { ByteRange } from './file-server'

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
  /** Bytes per second; `uploaded` is the running total, which the UI mistook for this. */
  readonly uploadSpeed: number
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
