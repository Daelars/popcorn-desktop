import { copyFile, mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Cause, Chunk, Effect, Exit, Schema } from 'effect'
import {
  DbError,
  ProviderError,
  type SettingsError,
  type SubtitleError,
  type TorrentError,
} from '../shared/errors'
import {
  contracts,
  type IpcChannel,
  type IpcEnvelope,
  type IpcEventPayload,
  toIpcFailure,
} from '../shared/ipc'
import type { DatabaseServiceShape } from './database'
import type { LocalFilesShape } from './localfiles'
import type { ProviderEntry } from './providers/registry'
import { resolveItem } from './resolve'
import type { SearchOutcome } from './search'
import type { SettingsServiceShape } from './settings'
import type { StreamManagerShape } from './streams'
import { fetchSubtitle, searchSubtitles } from './subtitles/opensubtitles'
import type { UpdatesShape } from './updates'

/** The Electron `ipcMain` surface we depend on — fakeable in tests. */
export interface IpcMainPort {
  readonly handle: (
    channel: string,
    listener: (event: unknown, payload: unknown) => Promise<unknown>,
  ) => void
}

export interface IpcServices {
  readonly settings: SettingsServiceShape
  readonly database: DatabaseServiceShape
  readonly providers: ReadonlyArray<ProviderEntry>
  readonly window: WindowControls
  readonly stream: StreamManagerShape
  readonly files: FilePickerPort
  readonly players: ExternalPlayersPort
  readonly search: SearchPort
  readonly local: LocalFilesShape
  readonly updates: UpdatesShape
}

/** Online torrent search across the reachable providers. */
export interface SearchPort {
  readonly search: (query: string, category: string) => Effect.Effect<SearchOutcome>
}

/** External players found on disk and the launcher that starts them. */
export interface ExternalPlayersPort {
  readonly list: () => Effect.Effect<
    ReadonlyArray<{ readonly id: string; readonly type: string; readonly path: string }>
  >
  readonly play: (request: {
    readonly playerId: string
    readonly url: string
    readonly subtitle?: string
    readonly title?: string
    readonly fullscreen?: boolean
  }) => Effect.Effect<void>
}

/** Native file pickers and shell actions; faked in tests so the flows run headless. */
export interface FilePickerPort {
  /** Returns the chosen `.torrent` file, or undefined when the user cancels. */
  readonly pickTorrent: () => Effect.Effect<string | undefined>
  readonly openDirectory: (path: string) => Effect.Effect<void>
}

/** Window chrome actions the renderer's titlebar drives. */
export interface WindowControls {
  readonly minimize: () => Effect.Effect<void>
  readonly maximize: () => Effect.Effect<void>
  readonly close: () => Effect.Effect<void>
  /** UI scaling, in percent; the legacy mapped it onto a 1.2-step zoom level. */
  readonly setZoom: (percent: number) => Effect.Effect<void>
  /** `scaleWindow` from player.js: the window resized to the video size times a factor. */
  readonly setSize: (width: number, height: number) => Effect.Effect<void>
}

/** The composition root satisfies this with a ManagedRuntime. */
export interface EffectRunner {
  readonly runPromiseExit: <A>(
    effect: Effect.Effect<
      A,
      SettingsError | DbError | ProviderError | TorrentError | SubtitleError,
      never
    >,
  ) => Promise<Exit.Exit<A, SettingsError | DbError | ProviderError | TorrentError | SubtitleError>>
}

type IpcError = SettingsError | DbError | ProviderError | TorrentError | SubtitleError

/** webtorrent writes into the download path, so it has to exist before a torrent loads. */
function ensureDirectory(path: string): Effect.Effect<void, DbError> {
  return Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }).then(() => undefined),
    catch: (cause) => new DbError({ message: `cannot create ${path}`, operation: 'mkdir', cause }),
  })
}

/** Settings values arrive decoded but untyped; the OpenSubtitles fields are strings. */
function readString(
  settings: SettingsServiceShape,
  key: string,
): Effect.Effect<string, SettingsError> {
  return settings.read(key).pipe(Effect.map((value) => (typeof value === 'string' ? value : '')))
}

function effectFor(
  channel: IpcChannel,
  services: IpcServices,
  payload: unknown,
): Effect.Effect<unknown, IpcError> {
  switch (channel) {
    case 'settings:get': {
      const { key } = Schema.decodeUnknownSync(contracts['settings:get'].request)(payload)
      return services.settings.read(key)
    }
    case 'settings:set': {
      const { key, value } = Schema.decodeUnknownSync(contracts['settings:set'].request)(payload)
      return Effect.gen(function* () {
        yield* services.settings.set(key, value)
        if (key === 'bigPicture' && typeof value === 'number') {
          yield* services.window.setZoom(value)
        }
      })
    }
    case 'settings:all':
      return services.settings.snapshot
    case 'bookmarks:list': {
      const { type } = Schema.decodeUnknownSync(contracts['bookmarks:list'].request)(payload)
      return services.database.bookmarks.list(type)
    }
    case 'bookmarks:add': {
      const { imdbId, type } = Schema.decodeUnknownSync(contracts['bookmarks:add'].request)(payload)
      return services.database.bookmarks.add(imdbId, type)
    }
    case 'bookmarks:remove': {
      const { imdbId } = Schema.decodeUnknownSync(contracts['bookmarks:remove'].request)(payload)
      return services.database.bookmarks.remove(imdbId)
    }
    case 'watched:movies':
      return services.database.watched.movies
    case 'watched:markMovie': {
      const { imdbId } = Schema.decodeUnknownSync(contracts['watched:markMovie'].request)(payload)
      return services.database.watched.markMovie(imdbId)
    }
    case 'watched:unmarkMovie': {
      const { imdbId } = Schema.decodeUnknownSync(contracts['watched:unmarkMovie'].request)(payload)
      return services.database.watched.unmarkMovie(imdbId)
    }
    case 'watched:episodes': {
      const { tvdbId } = Schema.decodeUnknownSync(contracts['watched:episodes'].request)(payload)
      return services.database.watched.episodesFor(tvdbId)
    }
    case 'watched:markEpisode': {
      const episode = Schema.decodeUnknownSync(contracts['watched:markEpisode'].request)(payload)
      return services.database.watched.markEpisode(episode)
    }
    case 'watched:unmarkEpisode': {
      const episode = Schema.decodeUnknownSync(contracts['watched:unmarkEpisode'].request)(payload)
      return services.database.watched.unmarkEpisode(episode)
    }
    case 'browse:providers':
      return Effect.succeed(services.providers.map((entry) => entry.descriptor))
    case 'browse:fetch': {
      const { provider, filters } = Schema.decodeUnknownSync(contracts['browse:fetch'].request)(
        payload,
      )
      const entry = services.providers.find((candidate) => candidate.descriptor.name === provider)
      if (entry === undefined) {
        return Effect.fail(
          new ProviderError({ provider, operation: 'fetch', message: 'unknown provider' }),
        )
      }
      // Providers are heterogeneous; the page is validated against shared schemas at the renderer.
      const fetchPage = async (): Promise<unknown> => entry.provider.fetch(filters)
      return Effect.tryPromise(fetchPage).pipe(
        Effect.mapError((cause) =>
          cause instanceof ProviderError
            ? cause
            : new ProviderError({
                provider,
                operation: 'fetch',
                message: 'provider request failed',
                cause,
              }),
        ),
        Effect.tap((page) => cachePage(services.database, page)),
      )
    }
    case 'browse:filters': {
      const { provider } = Schema.decodeUnknownSync(contracts['browse:filters'].request)(payload)
      const entry = services.providers.find((candidate) => candidate.descriptor.name === provider)
      if (entry === undefined) {
        return Effect.fail(
          new ProviderError({ provider, operation: 'filters', message: 'unknown provider' }),
        )
      }
      const fetchFilters = async (): Promise<unknown> => entry.provider.formatFilters()
      return Effect.tryPromise(fetchFilters).pipe(
        Effect.mapError((cause) =>
          cause instanceof ProviderError
            ? cause
            : new ProviderError({
                provider,
                operation: 'filters',
                message: 'provider filters failed',
                cause,
              }),
        ),
      )
    }
    case 'media:getMovie': {
      const { imdbId } = Schema.decodeUnknownSync(contracts['media:getMovie'].request)(payload)
      return services.database.media.getMovie(imdbId)
    }
    case 'media:getShow': {
      const { imdbId } = Schema.decodeUnknownSync(contracts['media:getShow'].request)(payload)
      return services.database.media.getShow(imdbId)
    }
    case 'media:resolve': {
      const request = Schema.decodeUnknownSync(contracts['media:resolve'].request)(payload)
      return Effect.gen(function* () {
        const tmdb = yield* services.settings.read('tmdb')
        const apiKey =
          typeof tmdb === 'object' &&
          tmdb !== null &&
          'api_key' in tmdb &&
          typeof (tmdb as { api_key: unknown }).api_key === 'string'
            ? (tmdb as { api_key: string }).api_key
            : ''
        return yield* resolveItem(request, apiKey)
      })
    }
    case 'window:minimize':
      return services.window.minimize()
    case 'window:maximize':
      return services.window.maximize()
    case 'window:close':
      return services.window.close()
    case 'window:setSize': {
      const { width, height } = Schema.decodeUnknownSync(contracts['window:setSize'].request)(
        payload,
      )
      return services.window.setSize(width, height)
    }
    case 'local:serve': {
      const { path, origin } = Schema.decodeUnknownSync(contracts['local:serve'].request)(payload)
      return services.local.serve(path, origin)
    }
    case 'local:stop': {
      const { port } = Schema.decodeUnknownSync(contracts['local:stop'].request)(payload)
      return services.local.stop(port)
    }
    case 'local:subtitle': {
      const { path, origin } = Schema.decodeUnknownSync(contracts['local:subtitle'].request)(
        payload,
      )
      return services.local.subtitle(path, origin)
    }
    case 'subtitles:list': {
      const { imdbId } = Schema.decodeUnknownSync(contracts['subtitles:list'].request)(payload)
      return Effect.gen(function* () {
        const username = yield* readString(services.settings, 'opensubtitlesUsername')
        const password = yield* readString(services.settings, 'opensubtitlesPassword')
        const subtitles = yield* searchSubtitles({ imdbId, username, password })
        return { subtitles }
      })
    }
    case 'subtitles:fetch': {
      const { imdbId, lang, origin } = Schema.decodeUnknownSync(
        contracts['subtitles:fetch'].request,
      )(payload)
      return Effect.gen(function* () {
        const username = yield* readString(services.settings, 'opensubtitlesUsername')
        const password = yield* readString(services.settings, 'opensubtitlesPassword')
        const vtt = yield* fetchSubtitle({ imdbId, lang, username, password })
        return yield* services.local.serveVtt(vtt, origin)
      })
    }
    case 'updates:check': {
      const { manual } = Schema.decodeUnknownSync(contracts['updates:check'].request)(payload)
      return services.updates.check(manual)
    }
    case 'updates:download':
      return services.updates.download()
    case 'updates:install':
      return services.updates.install()
    case 'stream:files': {
      const { torrentId } = Schema.decodeUnknownSync(contracts['stream:files'].request)(payload)
      return Effect.gen(function* () {
        const downloadPath = yield* services.settings.get('tmpLocation')
        yield* ensureDirectory(downloadPath)
        const probe = yield* services.stream.files(torrentId, downloadPath)
        // Only serialisable fields may cross the boundary; the probe keeps a live handle.
        return { infoHash: probe.infoHash, files: probe.files }
      })
    }
    case 'stream:start': {
      const request = Schema.decodeUnknownSync(contracts['stream:start'].request)(payload)
      return Effect.gen(function* () {
        const downloadPath = yield* services.settings.get('tmpLocation')
        yield* ensureDirectory(downloadPath)
        return yield* services.stream.start({
          torrentId: request.torrentId,
          fileIndex: request.fileIndex,
          downloadPath,
          origin: request.origin,
          ...(request.port === undefined ? {} : { port: request.port }),
        })
      })
    }
    case 'stream:stop': {
      const { port } = Schema.decodeUnknownSync(contracts['stream:stop'].request)(payload)
      return services.stream.stopSession(port)
    }
    case 'collection:list':
      return services.database.collection.list
    case 'collection:add': {
      const { name, source } = Schema.decodeUnknownSync(contracts['collection:add'].request)(
        payload,
      )
      return services.database.collection.add(name, source)
    }
    case 'collection:import':
      return Effect.gen(function* () {
        const picked = yield* services.files.pickTorrent()
        if (picked === undefined) return
        const dataDir = yield* services.settings.get('databaseLocation')
        const name = basename(picked, '.torrent')
        const target = join(dataDir, 'TorrentCollection', `${name}.torrent`)
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(dirname(target), { recursive: true })
            await copyFile(picked, target)
          },
          catch: (cause) =>
            new DbError({
              message: `cannot import torrent file ${picked}`,
              operation: 'collection.import',
              cause,
            }),
        })
        yield* services.database.collection.add(name, `file:${target}`)
      })
    case 'search:torrents': {
      const { query, category } = Schema.decodeUnknownSync(contracts['search:torrents'].request)(
        payload,
      )
      return services.search.search(query, category)
    }
    case 'players:list':
      return services.players.list()
    case 'players:play': {
      const request = Schema.decodeUnknownSync(contracts['players:play'].request)(payload)
      return services.players.play({
        playerId: request.playerId,
        url: request.url,
        ...(request.subtitle === undefined ? {} : { subtitle: request.subtitle }),
        ...(request.title === undefined ? {} : { title: request.title }),
        ...(request.fullscreen === undefined ? {} : { fullscreen: request.fullscreen }),
      })
    }
    case 'disclaimer:status':
      return Effect.map(services.database.meta.get('disclaimerAccepted'), (value) => ({
        accepted: value === true,
      }))
    case 'disclaimer:accept':
      return services.database.meta.set('disclaimerAccepted', true)
    case 'files:openDirectory': {
      const { target } = Schema.decodeUnknownSync(contracts['files:openDirectory'].request)(payload)
      const key =
        target === 'cache'
          ? 'tmpLocation'
          : target === 'downloads'
            ? 'downloadsLocation'
            : 'databaseLocation'
      return Effect.gen(function* () {
        const path = yield* services.settings.get(key)
        yield* services.files.openDirectory(path)
      })
    }
    case 'collection:remove': {
      const { id } = Schema.decodeUnknownSync(contracts['collection:remove'].request)(payload)
      return services.database.collection.remove(id)
    }
    case 'collection:rename': {
      const { id, name } = Schema.decodeUnknownSync(contracts['collection:rename'].request)(payload)
      return services.database.collection.rename(id, name)
    }
    case 'torrents:list':
      return services.stream.list
    case 'torrents:pause': {
      const { infoHash } = Schema.decodeUnknownSync(contracts['torrents:pause'].request)(payload)
      return services.stream.pause(infoHash)
    }
    case 'torrents:resume': {
      const { infoHash } = Schema.decodeUnknownSync(contracts['torrents:resume'].request)(payload)
      return services.stream.resume(infoHash)
    }
    case 'torrents:remove': {
      const { infoHash } = Schema.decodeUnknownSync(contracts['torrents:remove'].request)(payload)
      return services.stream.stop(infoHash)
    }
  }
}

/** Browse results double as the media cache that Favorites and Watched read from. */
function cachePage(database: DatabaseServiceShape, page: unknown): Effect.Effect<void, never> {
  const results =
    page !== null && typeof page === 'object' && 'results' in page
      ? (page as { results?: unknown }).results
      : undefined
  if (!Array.isArray(results)) return Effect.void
  const writes = results.flatMap((item) => {
    if (item === null || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const imdbId = typeof record.imdb_id === 'string' ? record.imdb_id : undefined
    if (imdbId === undefined) return []
    if (record.type === 'movie') return [database.media.putMovie(imdbId, item)]
    if (record.type === 'show') {
      const tvdbId = record.tvdb_id === undefined ? '' : String(record.tvdb_id)
      return [database.media.putShow(imdbId, tvdbId, item)]
    }
    return []
  })
  return Effect.forEach(writes, (write) => write, { discard: true }).pipe(Effect.ignore)
}

/**
 * The only place `runPromise` is allowed to appear: every handler decodes its payload
 * against the shared contract, runs the service effect, and returns a result envelope.
 * Failures cross as tagged data, never as thrown strings.
 */
export function registerIpc(port: IpcMainPort, services: IpcServices, runner: EffectRunner): void {
  for (const channel of Object.keys(contracts) as IpcChannel[]) {
    port.handle(channel, async (_event: unknown, payload: unknown): Promise<IpcEnvelope> => {
      try {
        const exit = await runner.runPromiseExit(effectFor(channel, services, payload))
        if (Exit.isSuccess(exit)) {
          return { ok: true, value: exit.value }
        }
        const failure = Chunk.toReadonlyArray(Cause.failures(exit.cause))[0]
        const error = toIpcFailure(failure ?? Cause.squash(exit.cause))
        // Playback failures were invisible in the renderer; log them where they can be read.
        console.error(`[ipc] ${channel} failed:`, error.tag, error.message, error.context ?? '')
        return { ok: false, error }
      } catch (error) {
        // Payloads are decoded before the effect runs, so parse errors land here.
        return { ok: false, error: toIpcFailure(error) }
      }
    })
  }
}

/** Publishes push events (streaming progress) to a window; the renderer subscribes. */
export function createEventPublisher(send: (channel: string, payload: unknown) => void) {
  return {
    publishProgress: (payload: IpcEventPayload<'streams:progress'>) => {
      send('streams:progress', payload)
    },
  }
}
