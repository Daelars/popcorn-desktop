/**
 * Minimal declarations for the webtorrent surface the main process uses.
 * webtorrent 3.x ships no types; this covers exactly what TorrentEngine needs.
 */
declare module 'webtorrent' {
  import type { Readable } from 'node:stream'

  export interface WebTorrentFile {
    readonly name: string
    readonly length: number
    readonly path: string
    createReadStream(options?: { start?: number; end?: number }): Readable
  }

  export interface WebTorrentTorrent {
    readonly infoHash: string
    readonly name: string
    readonly length: number
    readonly files: ReadonlyArray<WebTorrentFile>
    readonly downloaded: number
    readonly uploaded: number
    readonly downloadSpeed: number
    readonly uploadSpeed: number
    readonly numPeers: number
    readonly progress: number
    readonly paused: boolean
    readonly ready: boolean
    once(event: 'ready', listener: () => void): this
    once(event: 'error', listener: (error: Error) => void): this
    on(event: 'download', listener: (bytes: number) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    off(event: 'download', listener: (bytes: number) => void): this
    off(event: 'error', listener: (error: Error) => void): this
    off(event: 'ready', listener: () => void): this
    select(index: number, priority?: number): void
    pause(): void
    resume(): void
    destroy(callback?: () => void): void
  }

  export interface WebTorrentOptions {
    readonly maxConns?: number | undefined
    readonly downloadLimit?: number | undefined
    readonly uploadLimit?: number | undefined
    readonly dht?: { readonly concurrency?: number | undefined } | undefined
    readonly secure?: boolean | undefined
    readonly tracker?: { readonly announce?: ReadonlyArray<string> | undefined } | undefined
  }

  export default class WebTorrent {
    constructor(options?: WebTorrentOptions)
    readonly torrents: ReadonlyArray<WebTorrentTorrent>
    add(
      torrentId: string | Uint8Array,
      options: { readonly path?: string },
      callback: (torrent: WebTorrentTorrent) => void,
    ): WebTorrentTorrent
    on(event: 'error', listener: (error: Error) => void): this
    destroy(callback?: () => void): void
  }
}
