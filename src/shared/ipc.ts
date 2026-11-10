import { Schema } from 'effect'
import { FetchResult, Filters, Provider, TabFilters } from './provider'
import type { Settings, SettingsKey } from './settings'

/** Request/response contracts for every IPC channel. Validated on both sides. */
export const contracts = {
  'settings:get': {
    request: Schema.Struct({ key: Schema.String }),
    response: Schema.Unknown,
  },
  'settings:set': {
    request: Schema.Struct({ key: Schema.String, value: Schema.Unknown }),
    response: Schema.Undefined,
  },
  'settings:all': {
    request: Schema.Struct({}),
    response: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  },
  'bookmarks:list': {
    request: Schema.Struct({ type: Schema.optional(Schema.String) }),
    response: Schema.Array(Schema.Struct({ imdbId: Schema.String, type: Schema.String })),
  },
  'bookmarks:add': {
    request: Schema.Struct({ imdbId: Schema.String, type: Schema.String }),
    response: Schema.Undefined,
  },
  'bookmarks:remove': {
    request: Schema.Struct({ imdbId: Schema.String }),
    response: Schema.Undefined,
  },
  'watched:movies': {
    request: Schema.Struct({}),
    response: Schema.Array(Schema.String),
  },
  'watched:markMovie': {
    request: Schema.Struct({ imdbId: Schema.String }),
    response: Schema.Undefined,
  },
  'watched:unmarkMovie': {
    request: Schema.Struct({ imdbId: Schema.String }),
    response: Schema.Undefined,
  },
  'watched:episodes': {
    request: Schema.Struct({ tvdbId: Schema.optional(Schema.String) }),
    response: Schema.Array(
      Schema.Struct({
        tvdbId: Schema.String,
        imdbId: Schema.String,
        season: Schema.String,
        episode: Schema.String,
        watchedAt: Schema.String,
      }),
    ),
  },
  'watched:markEpisode': {
    request: Schema.Struct({
      tvdbId: Schema.String,
      imdbId: Schema.String,
      season: Schema.String,
      episode: Schema.String,
    }),
    response: Schema.Undefined,
  },
  'watched:unmarkEpisode': {
    request: Schema.Struct({
      tvdbId: Schema.String,
      imdbId: Schema.String,
      season: Schema.String,
      episode: Schema.String,
    }),
    response: Schema.Undefined,
  },
  'browse:providers': {
    request: Schema.Struct({}),
    response: Schema.Array(Provider),
  },
  'browse:fetch': {
    request: Schema.Struct({ tab: Schema.String, filters: Filters }),
    response: FetchResult,
  },
  'browse:filters': {
    request: Schema.Struct({ tab: Schema.String }),
    response: TabFilters,
  },
  'media:getMovie': {
    request: Schema.Struct({ imdbId: Schema.String }),
    response: Schema.Unknown,
  },
  'media:getShow': {
    request: Schema.Struct({ imdbId: Schema.String }),
    response: Schema.Unknown,
  },
  /** Metadata, episodes and torrents on demand for a title opened from a TMDB grid. */
  'media:resolve': {
    request: Schema.Struct({
      type: Schema.Literal('movie', 'tvshow', 'anime'),
      imdbId: Schema.String,
      tmdbId: Schema.optional(Schema.Number),
      title: Schema.String,
      year: Schema.optional(Schema.Number),
    }),
    response: Schema.Unknown,
  },
  'window:minimize': {
    request: Schema.Struct({}),
    response: Schema.Undefined,
  },
  'window:maximize': {
    request: Schema.Struct({}),
    response: Schema.Undefined,
  },
  'window:close': {
    request: Schema.Struct({}),
    response: Schema.Undefined,
  },
  'window:setSize': {
    request: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
    response: Schema.Undefined,
  },
  /** Serves a dropped video file over loopback, with any sidecar subtitle beside it. */
  'local:serve': {
    request: Schema.Struct({ path: Schema.String, origin: Schema.String }),
    response: Schema.Struct({
      port: Schema.Number,
      url: Schema.String,
      name: Schema.String,
      subtitle: Schema.optional(Schema.String),
    }),
  },
  'local:stop': {
    request: Schema.Struct({ port: Schema.Number }),
    response: Schema.Undefined,
  },
  /** Converts a dropped subtitle to WebVTT and serves it from loopback. */
  'local:subtitle': {
    request: Schema.Struct({ path: Schema.String, origin: Schema.String }),
    response: Schema.Struct({ port: Schema.Number, url: Schema.String }),
  },
  /** `update:subtitles`: the provider's language map for a title (code → download url). */
  'subtitles:list': {
    request: Schema.Struct({ imdbId: Schema.String }),
    response: Schema.Struct({
      subtitles: Schema.Record({ key: Schema.String, value: Schema.String }),
    }),
  },
  /** Downloads one language and serves it as WebVTT, which is what the player can cue. */
  'subtitles:fetch': {
    request: Schema.Struct({
      imdbId: Schema.String,
      lang: Schema.String,
      origin: Schema.String,
    }),
    response: Schema.Struct({ port: Schema.Number, url: Schema.String }),
  },
  /** A manual check comes from the About page; the automatic one runs at start-up. */
  'updates:check': {
    request: Schema.Struct({ manual: Schema.Boolean }),
    response: Schema.Undefined,
  },
  'updates:download': {
    request: Schema.Struct({}),
    response: Schema.Undefined,
  },
  /** `quitAndInstall`: the update replaces the installed app and relaunches it. */
  'updates:install': {
    request: Schema.Struct({}),
    response: Schema.Undefined,
  },
  'stream:files': {
    request: Schema.Struct({ torrentId: Schema.String }),
    response: Schema.Struct({
      infoHash: Schema.String,
      files: Schema.Array(
        Schema.Struct({
          index: Schema.Number,
          name: Schema.String,
          length: Schema.Number,
        }),
      ),
    }),
  },
  'stream:start': {
    request: Schema.Struct({
      torrentId: Schema.String,
      fileIndex: Schema.optional(Schema.Number),
      fileHint: Schema.optional(Schema.String),
      season: Schema.optional(Schema.String),
      episode: Schema.optional(Schema.String),
      port: Schema.optional(Schema.Number),
      origin: Schema.String,
    }),
    /** The session id plus its ready URL; `streams:state` carries loading from then on. */
    response: Schema.Struct({
      id: Schema.String,
      infoHash: Schema.String,
      port: Schema.Number,
      url: Schema.String,
    }),
  },
  'stream:stop': {
    request: Schema.Struct({ id: Schema.String }),
    response: Schema.Undefined,
  },
  'collection:list': {
    request: Schema.Struct({}),
    response: Schema.Array(
      Schema.Struct({
        id: Schema.Number,
        name: Schema.String,
        source: Schema.String,
        addedAt: Schema.String,
      }),
    ),
  },
  'collection:add': {
    request: Schema.Struct({ name: Schema.String, source: Schema.String }),
    response: Schema.Undefined,
  },
  'collection:import': {
    request: Schema.Struct({}),
    response: Schema.Undefined,
  },
  'search:torrents': {
    request: Schema.Struct({
      query: Schema.String,
      category: Schema.String,
    }),
    response: Schema.Struct({
      results: Schema.Array(
        Schema.Struct({
          title: Schema.String,
          magnet: Schema.String,
          size: Schema.String,
          seeds: Schema.Number,
          peers: Schema.Number,
          provider: Schema.String,
          source: Schema.String,
        }),
      ),
      counts: Schema.Record({ key: Schema.String, value: Schema.Number }),
      failures: Schema.Array(Schema.Struct({ provider: Schema.String, message: Schema.String })),
    }),
  },
  'players:list': {
    request: Schema.Struct({}),
    response: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        type: Schema.String,
        path: Schema.String,
      }),
    ),
  },
  'players:play': {
    request: Schema.Struct({
      playerId: Schema.String,
      url: Schema.String,
      title: Schema.optional(Schema.String),
      subtitle: Schema.optional(Schema.String),
      fullscreen: Schema.optional(Schema.Boolean),
    }),
    response: Schema.Undefined,
  },
  'disclaimer:status': {
    request: Schema.Struct({}),
    response: Schema.Struct({ accepted: Schema.Boolean }),
  },
  'disclaimer:accept': {
    request: Schema.Struct({}),
    response: Schema.Undefined,
  },
  'files:openDirectory': {
    request: Schema.Struct({
      target: Schema.Literal('cache', 'downloads', 'database'),
    }),
    response: Schema.Undefined,
  },
  'collection:remove': {
    request: Schema.Struct({ id: Schema.Number }),
    response: Schema.Undefined,
  },
  'collection:rename': {
    request: Schema.Struct({ id: Schema.Number, name: Schema.String }),
    response: Schema.Undefined,
  },
  'torrents:list': {
    request: Schema.Struct({}),
    response: Schema.Array(
      Schema.Struct({
        infoHash: Schema.String,
        name: Schema.String,
        length: Schema.Number,
        downloaded: Schema.Number,
        uploaded: Schema.Number,
        downloadSpeed: Schema.Number,
        uploadSpeed: Schema.Number,
        peers: Schema.Number,
        progress: Schema.Number,
        paused: Schema.Boolean,
        files: Schema.Array(
          Schema.Struct({
            index: Schema.Number,
            name: Schema.String,
            length: Schema.Number,
          }),
        ),
      }),
    ),
  },
  'torrents:pause': {
    request: Schema.Struct({ infoHash: Schema.String }),
    response: Schema.Undefined,
  },
  'torrents:resume': {
    request: Schema.Struct({ infoHash: Schema.String }),
    response: Schema.Undefined,
  },
  'torrents:remove': {
    request: Schema.Struct({ infoHash: Schema.String }),
    response: Schema.Undefined,
  },
} as const

export type IpcChannel = keyof typeof contracts
export type IpcRequest<K extends IpcChannel> = Schema.Schema.Type<(typeof contracts)[K]['request']>
export type IpcResponse<K extends IpcChannel> = Schema.Schema.Type<
  (typeof contracts)[K]['response']
>

/** Push channels; the main process publishes, the renderer subscribes. Never polled. */
/** `Updater.onlyNotification` states, plus the electron-updater download half. */
export const UpdateStatus = Schema.Struct({
  state: Schema.Literal(
    'idle',
    'checking',
    'latest',
    'available',
    'downloading',
    'ready',
    'error',
    'unsupported',
  ),
  version: Schema.optional(Schema.String),
  percent: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
})
export type UpdateStatus = Schema.Schema.Type<typeof UpdateStatus>

/** One playback session's state; the renderer drives LoadingScreen and the player from it. */
export const StreamState = Schema.Struct({
  id: Schema.String,
  infoHash: Schema.String,
  /** The legacy streamer.js states, in order, ending at closed or failed. */
  state: Schema.Literal(
    'connecting',
    'startingDownload',
    'downloading',
    'waitingForSubtitles',
    'ready',
    'playingExternally',
    'closed',
    'failed',
  ),
  url: Schema.String,
  port: Schema.Number,
  /** The chosen file's name, once known. */
  name: Schema.optional(Schema.String),
  downloaded: Schema.Number,
  uploaded: Schema.Number,
  speed: Schema.Number,
  peers: Schema.Number,
  progress: Schema.Number,
  length: Schema.Number,
  timeRemaining: Schema.Number,
  /** A short reason when `state` is `failed`. */
  message: Schema.optional(Schema.String),
})
export type StreamState = Schema.Schema.Type<typeof StreamState>

export const events = {
  'streams:progress': Schema.Struct({
    infoHash: Schema.String,
    downloaded: Schema.Number,
    uploaded: Schema.Number,
    speed: Schema.Number,
    peers: Schema.Number,
    progress: Schema.Number,
    /** Torrent size, so the player can render "1.2 GB / 3.8 GB" like the legacy did. */
    length: Schema.Number,
    /** Milliseconds left, as webtorrent estimates it. */
    timeRemaining: Schema.Number,
  }),
  /** The legacy loading state machine, per session, tagged with the session id. */
  'streams:state': StreamState,
  /** An OS "open with" target: a video path, a `.torrent` path, or a magnet/http url. */
  'window:openFile': Schema.String,
  'updates:status': UpdateStatus,
} as const

export type IpcEvent = keyof typeof events
export type IpcEventPayload<K extends IpcEvent> = Schema.Schema.Type<(typeof events)[K]>

/** Tagged failures cross the boundary as data, not stack strings. */
export const IpcFailure = Schema.Struct({
  tag: Schema.String,
  message: Schema.String,
  context: Schema.optional(Schema.Unknown),
})
export type IpcFailure = Schema.Schema.Type<typeof IpcFailure>

export const IpcEnvelope = Schema.Union(
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({ ok: Schema.Literal(false), error: IpcFailure }),
)
export type IpcEnvelope = Schema.Schema.Type<typeof IpcEnvelope>

/** Turns any thrown/tagged error into serialisable data. */
export function toIpcFailure(error: unknown): IpcFailure {
  if (error !== null && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const tag = typeof record._tag === 'string' ? record._tag : 'UnknownError'
    const message = typeof record.message === 'string' ? record.message : String(error)
    const context: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (
        key === '_tag' ||
        key === 'message' ||
        key === 'name' ||
        key === 'stack' ||
        key === 'cause'
      )
        continue
      context[key] = value
    }
    return Object.keys(context).length > 0 ? { tag, message, context } : { tag, message }
  }
  return { tag: 'UnknownError', message: String(error) }
}

/** The renderer-facing API surface, implemented by the preload bridge. */
export interface PopcornBridge {
  /** Settings are generic over the key, so a value's type comes from the schema. */
  invoke<K extends SettingsKey>(
    channel: 'settings:get',
    request: { readonly key: K },
  ): Promise<Settings[K]>
  invoke<K extends SettingsKey>(
    channel: 'settings:set',
    request: { readonly key: K; readonly value: Settings[K] },
  ): Promise<void>
  invoke(channel: 'settings:all', request: Record<string, never>): Promise<Partial<Settings>>
  invoke<K extends IpcChannel>(channel: K, request: IpcRequest<K>): Promise<IpcResponse<K>>
  readonly onProgress: (
    listener: (payload: IpcEventPayload<'streams:progress'>) => void,
  ) => () => void
  /** The per-session loading state machine. */
  readonly onState: (listener: (state: IpcEventPayload<'streams:state'>) => void) => () => void
  /** The OS handed the app a file or link to open (`nw.App.argv` / `nw.App.on('open')`). */
  readonly onOpenFile: (listener: (target: string) => void) => () => void
  /** Auto-update progress, from the electron-updater events. */
  readonly onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void
  /** Electron's `webUtils.getPathForFile`; a dropped DOM `File` hides its own path. */
  readonly pathForFile: (file: unknown) => string
}
