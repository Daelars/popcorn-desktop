import { mkdir } from 'node:fs/promises'
import { Cause, Chunk, Effect, Exit, Option, Schema, Stream } from 'effect'
import {
  DbError,
  PlaybackError,
  type ProviderError,
  type SettingsError,
  type SubtitleError,
  TorrentError,
} from '../shared/errors'
import {
  contracts,
  type IpcChannel,
  type IpcEnvelope,
  type IpcEvent,
  type IpcEventPayload,
  type IpcRequest,
  type IpcResponse,
  toIpcFailure,
} from '../shared/ipc'
import { CatalogService } from './catalog'
import { CollectionService } from './collection'
import { DatabaseService } from './database'
import { FilePickerService } from './file-picker'
import { LocalFiles } from './localfiles'
import { PlaybackTargets } from './playback-targets'
import { ProvidersService } from './providers/registry'
import { resolveItem } from './resolve'
import { SearchService } from './search'
import { SettingsService, tmdbApiKey } from './settings'
import { SettingsEffects } from './settings-effects'
import { StreamSession } from './stream-session'
import { SubtitlesService } from './subtitles/service'
import { UpdatesService } from './updates'
import { WindowService } from './window'

/** The Electron `ipcMain` surface we depend on — fakeable in tests. */
export interface IpcMainPort {
  readonly handle: (
    channel: string,
    listener: (event: unknown, payload: unknown) => Promise<unknown>,
  ) => void
}

/** External players found on disk and the launcher that starts them. */
export interface ExternalPlayersPort {
  readonly list: () => Effect.Effect<
    ReadonlyArray<{ readonly id: string; readonly type: string; readonly path: string }>
  >
  readonly play: (request: {
    readonly playerId: string
    readonly url: string
    readonly subtitle?: string | undefined
    readonly title?: string | undefined
    readonly fullscreen?: boolean | undefined
  }) => Effect.Effect<void>
}

/** Every service an IPC handler reads from the Effect context. */
export type IpcServiceTags =
  | SettingsService
  | SettingsEffects
  | DatabaseService
  | ProvidersService
  | CatalogService
  | WindowService
  | StreamSession
  | FilePickerService
  | PlaybackTargets
  | SearchService
  | LocalFiles
  | UpdatesService
  | SubtitlesService
  | CollectionService

/** The composition root satisfies this with the ManagedRuntime over the AppLayer. */
export interface EffectRunner<R, ER> {
  readonly runPromiseExit: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<Exit.Exit<A, E | ER>>
}

type IpcError =
  | SettingsError
  | DbError
  | ProviderError
  | TorrentError
  | SubtitleError
  | PlaybackError

/** webtorrent writes into the download path, so it has to exist before a torrent loads. */
function ensureDirectory(path: string): Effect.Effect<void, DbError> {
  return Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }).then(() => undefined),
    catch: (cause) => new DbError({ message: `cannot create ${path}`, operation: 'mkdir', cause }),
  })
}

/**
 * One entry per contract channel. Omitting a channel, or returning the wrong type for one,
 * is a compile error against this mapped type. `undefined` responses accept `void`, which is
 * what the void-returning service methods produce.
 */
export type Handlers = {
  readonly [K in IpcChannel]: (
    request: IpcRequest<K>,
  ) => Effect.Effect<
    IpcResponse<K> extends undefined ? void : IpcResponse<K>,
    IpcError,
    IpcServiceTags
  >
}

/**
 * The handler table. Each line delegates to the owning service; the only decoding happens
 * in `registerIpc`, and no business logic lives here.
 */
const handlers = {
  'settings:get': ({ key }) => Effect.flatMap(SettingsService, (settings) => settings.read(key)),
  'settings:set': ({ key, value }) =>
    Effect.flatMap(SettingsEffects, (settings) => settings.set(key, value)),
  'settings:all': () => Effect.flatMap(SettingsService, (settings) => settings.snapshot),
  'bookmarks:list': ({ type }) =>
    Effect.flatMap(DatabaseService, (database) => database.bookmarks.list(type)),
  'bookmarks:add': ({ imdbId, type }) =>
    Effect.flatMap(DatabaseService, (database) => database.bookmarks.add(imdbId, type)),
  'bookmarks:remove': ({ imdbId }) =>
    Effect.flatMap(DatabaseService, (database) => database.bookmarks.remove(imdbId)),
  'watched:movies': () => Effect.flatMap(DatabaseService, (database) => database.watched.movies),
  'watched:markMovie': ({ imdbId }) =>
    Effect.flatMap(DatabaseService, (database) => database.watched.markMovie(imdbId)),
  'watched:unmarkMovie': ({ imdbId }) =>
    Effect.flatMap(DatabaseService, (database) => database.watched.unmarkMovie(imdbId)),
  'watched:episodes': ({ tvdbId }) =>
    Effect.flatMap(DatabaseService, (database) => database.watched.episodesFor(tvdbId)),
  'watched:markEpisode': (episode) =>
    Effect.flatMap(DatabaseService, (database) => database.watched.markEpisode(episode)),
  'watched:unmarkEpisode': (episode) =>
    Effect.flatMap(DatabaseService, (database) => database.watched.unmarkEpisode(episode)),
  'browse:providers': () =>
    Effect.flatMap(ProvidersService, (providers) => providers.entries).pipe(
      Effect.map((entries) => entries.map((entry) => entry.descriptor)),
    ),
  'browse:fetch': ({ tab, filters }) =>
    Effect.flatMap(CatalogService, (catalog) => catalog.fetch(tab, filters)),
  'browse:filters': ({ tab }) => Effect.flatMap(CatalogService, (catalog) => catalog.filters(tab)),
  'media:getMovie': ({ imdbId }) =>
    Effect.flatMap(DatabaseService, (database) => database.media.getMovie(imdbId)),
  'media:getShow': ({ imdbId }) =>
    Effect.flatMap(DatabaseService, (database) => database.media.getShow(imdbId)),
  'media:resolve': (request) =>
    Effect.flatMap(SettingsService, (settings) =>
      Effect.flatMap(tmdbApiKey(settings), (apiKey) => resolveItem(request, apiKey)),
    ),
  'window:minimize': () => Effect.flatMap(WindowService, (window) => window.minimize()),
  'window:maximize': () => Effect.flatMap(WindowService, (window) => window.maximize()),
  'window:close': () => Effect.flatMap(WindowService, (window) => window.close()),
  'window:setSize': ({ width, height }) =>
    Effect.flatMap(WindowService, (window) => window.setSize(width, height)),
  'local:serve': ({ path, origin }) =>
    Effect.flatMap(LocalFiles, (local) => local.serve(path, origin)),
  'local:stop': ({ port }) => Effect.flatMap(LocalFiles, (local) => local.stop(port)),
  'local:subtitle': ({ path, origin }) =>
    Effect.flatMap(LocalFiles, (local) => local.subtitle(path, origin)),
  'subtitles:list': ({ imdbId, season, episode }) =>
    Effect.flatMap(SubtitlesService, (subtitles) =>
      subtitles.list(imdbId, {
        ...(season === undefined ? {} : { season }),
        ...(episode === undefined ? {} : { episode }),
      }),
    ),
  'subtitles:fetch': ({ imdbId, lang, origin, season, episode }) =>
    Effect.flatMap(SubtitlesService, (subtitles) =>
      subtitles.fetch(imdbId, lang, origin, {
        ...(season === undefined ? {} : { season }),
        ...(episode === undefined ? {} : { episode }),
      }),
    ),
  'updates:check': ({ manual }) =>
    Effect.flatMap(UpdatesService, (updates) => updates.check(manual)),
  'updates:download': () => Effect.flatMap(UpdatesService, (updates) => updates.download()),
  'updates:install': () => Effect.flatMap(UpdatesService, (updates) => updates.install()),
  'stream:files': ({ torrentId }) =>
    Effect.flatMap(StreamSession, (sessions) =>
      Effect.gen(function* () {
        const settings = yield* SettingsService
        const downloadPath = yield* settings.get('tmpLocation')
        yield* ensureDirectory(downloadPath)
        const probe = yield* sessions.files(torrentId, downloadPath)
        // Only serialisable fields may cross the boundary; the probe keeps a live handle.
        return { infoHash: probe.infoHash, files: probe.files }
      }),
    ),
  'stream:start': (request) =>
    Effect.flatMap(StreamSession, (sessions) =>
      Effect.gen(function* () {
        const settings = yield* SettingsService
        const downloadPath = yield* settings.get('tmpLocation')
        yield* ensureDirectory(downloadPath)
        const { id } = yield* sessions.open({
          source: request.torrentId,
          downloadPath,
          origin: request.origin,
          ...(request.fileIndex === undefined ? {} : { fileIndex: request.fileIndex }),
          ...(request.fileHint === undefined ? {} : { fileHint: request.fileHint }),
          ...(request.season === undefined ? {} : { season: request.season }),
          ...(request.episode === undefined ? {} : { episode: request.episode }),
          ...(request.port === undefined ? {} : { port: request.port }),
        })
        // Wait for the session to reach `ready` (or fail) before answering the renderer.
        const done = yield* sessions.states(id).pipe(
          Stream.filter((state) => state.state === 'ready' || state.state === 'failed'),
          Stream.runHead,
          Effect.timeout('60 seconds'),
          Effect.map(Option.getOrUndefined),
          Effect.catchTag('TimeoutException', () => Effect.succeed(undefined)),
        )
        if (done === undefined || done.state === 'failed') {
          return yield* Effect.fail(
            new TorrentError({
              message: done?.message ?? 'stream did not start',
              infoHash: request.torrentId,
            }),
          )
        }
        return { id, infoHash: done.infoHash, port: done.port, url: done.url }
      }),
    ),
  'stream:stop': ({ id }) => Effect.flatMap(StreamSession, (sessions) => sessions.close(id)),
  'collection:list': () => Effect.flatMap(DatabaseService, (database) => database.collection.list),
  'collection:add': ({ name, source }) =>
    Effect.flatMap(DatabaseService, (database) => database.collection.add(name, source)),
  'collection:import': () => Effect.flatMap(CollectionService, (collection) => collection.import()),
  'search:torrents': ({ query, category }) =>
    Effect.flatMap(SearchService, (search) => search.search(query, category)),
  'playback:targets': () => Effect.flatMap(PlaybackTargets, (targets) => targets.list),
  'playback:play': ({ targetId, sessionId, title, subtitle, fullscreen }) =>
    Effect.flatMap(PlaybackTargets, (targets) =>
      Effect.gen(function* () {
        const target = (yield* targets.list).find((candidate) => candidate.id === targetId)
        if (target === undefined) {
          return yield* Effect.fail(
            new PlaybackError({
              message: `unknown playback target ${targetId}`,
              target: targetId,
              operation: 'play',
            }),
          )
        }
        yield* targets.play(target, sessionId, {
          ...(title === undefined ? {} : { title }),
          ...(subtitle === undefined ? {} : { subtitle }),
          ...(fullscreen === undefined ? {} : { fullscreen }),
        })
      }),
    ),
  'disclaimer:status': () =>
    Effect.map(
      Effect.flatMap(DatabaseService, (database) => database.meta.get('disclaimerAccepted')),
      (value) => ({ accepted: value === true }),
    ),
  'disclaimer:accept': () =>
    Effect.flatMap(DatabaseService, (database) => database.meta.set('disclaimerAccepted', true)),
  'files:openDirectory': ({ target }) =>
    Effect.flatMap(FilePickerService, (files) =>
      Effect.gen(function* () {
        const settings = yield* SettingsService
        const key =
          target === 'cache'
            ? 'tmpLocation'
            : target === 'downloads'
              ? 'downloadsLocation'
              : 'databaseLocation'
        const path = yield* settings.get(key)
        yield* files.openDirectory(path)
      }),
    ),
  'collection:remove': ({ id }) =>
    Effect.flatMap(DatabaseService, (database) => database.collection.remove(id)),
  'collection:rename': ({ id, name }) =>
    Effect.flatMap(DatabaseService, (database) => database.collection.rename(id, name)),
  'torrents:list': () => Effect.flatMap(StreamSession, (sessions) => sessions.list),
  'torrents:pause': ({ infoHash }) =>
    Effect.flatMap(StreamSession, (sessions) => sessions.pause(infoHash)),
  'torrents:resume': ({ infoHash }) =>
    Effect.flatMap(StreamSession, (sessions) => sessions.resume(infoHash)),
  'torrents:remove': ({ infoHash }) =>
    Effect.flatMap(StreamSession, (sessions) => sessions.closeAll(infoHash)),
} satisfies Handlers

/** The table is homogeneous once decoded; the per-channel types were checked by `satisfies`. */
function handlerFor(
  channel: IpcChannel,
  request: unknown,
): Effect.Effect<unknown, IpcError, IpcServiceTags> {
  const handler = handlers[channel] as (
    request: unknown,
  ) => Effect.Effect<unknown, IpcError, IpcServiceTags>
  return handler(request)
}

/**
 * The only place `runPromise` is allowed to appear: every handler decodes its payload against
 * the shared contract, runs the table entry from the context, and returns a result envelope.
 * Failures cross as tagged data, never as thrown strings.
 */
export function registerIpc<R, ER>(
  port: IpcMainPort,
  runner: EffectRunner<R & IpcServiceTags, ER>,
): void {
  for (const channel of Object.keys(contracts) as IpcChannel[]) {
    port.handle(channel, async (_event: unknown, payload: unknown): Promise<IpcEnvelope> => {
      try {
        const request = Schema.decodeUnknownSync(
          contracts[channel].request as Schema.Schema<unknown>,
        )(payload)
        const exit = await runner.runPromiseExit(handlerFor(channel, request))
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

/** Publishes push events to the renderer; the renderer subscribes. The only send path. */
export function createEventPublisher(send: (channel: IpcEvent, payload: unknown) => void) {
  return {
    publish: <K extends IpcEvent>(channel: K, payload: IpcEventPayload<K>) => {
      send(channel, payload)
    },
  }
}
