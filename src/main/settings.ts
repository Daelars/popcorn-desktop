import { join } from 'node:path'
import { Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import { SettingsError } from '../shared/errors'
import { type Settings, SettingsFields, type SettingsKey } from '../shared/settings'
import { LegacyMigration } from './legacy-migration'

/** Everything the defaults need from the outside world, so tests can run without Electron. */
export interface SettingsEnvironment {
  readonly tempDir: string
  readonly dataDir: string
  readonly screen: { readonly width: number; readonly height: number }
  readonly windowFrame: boolean
  readonly arch: string
  readonly platform: string
  readonly appVersion: string
  readonly releaseName: string
  /** Credentials are never committed; they come from the environment until the rotation ticket lands. */
  readonly secrets?: {
    readonly traktClientId?: string | undefined
    readonly traktClientSecret?: string | undefined
    readonly fanartApiKey?: string | undefined
    readonly tvdbApiKey?: string | undefined
    readonly tmdbApiKey?: string | undefined
  }
}

const PROJECT_NAME = 'Popcorn Time'

/** The trackers the legacy app announced to; also the fallback when settings carry none. */
export const DEFAULT_TRACKERS: ReadonlyArray<string> = [
  'udp://tracker.opentrackr.org:1337',
  'udp://tracker.openbittorrent.com:1337',
  'udp://p4p.arenabg.com:1337',
  'udp://exodus.desync.com:6969',
  'udp://tracker.torrent.eu.org:451',
  'udp://tracker-udp.gbitt.info:80',
  'udp://open.stealth.si:80',
  'udp://tracker.dler.org:6969',
  'udp://explodie.org:6969',
  'udp://tracker.therarbg.to:6969',
  'udp://tracker.bittor.pw:1337',
  'udp://tr4ck3r.duckdns.org:6969',
  // HTTP(S) trackers work over TCP, so peer discovery survives networks that drop UDP.
  'https://tracker.gbitt.info:443/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'https://tracker.tamersunion.org:443/announce',
  'https://tracker2.ctix.cn:443/announce',
  'https://tracker1.520.jp:443/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'wss://tracker.openwebtorrent.com',
]

function osName(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'mac'
    case 'win32':
      return 'windows'
    case 'linux':
      return 'linux'
    default:
      return 'unknown'
  }
}

/** The legacy `settings.js` defaults, with environment-derived values injected. */
export function settingsDefaults(environment: SettingsEnvironment): Settings {
  const secrets = environment.secrets ?? {}
  return {
    projectName: PROJECT_NAME,
    projectUrl: '',
    projectBlog: 'https://github.com/popcorn-official/popcorn-desktop/wiki',
    projectForum: 'https://www.reddit.com/r/PopcornTimeApp',
    statusUrl: 'https://status.popcorntime.app',
    changelogUrl: 'https://github.com/popcorn-official/popcorn-desktop/commits/master',
    issuesUrl: 'https://github.com/popcorn-official/popcorn-desktop/issues',
    sourceUrl: 'https://github.com/popcorn-official/popcorn-desktop/',
    commitUrl: 'https://github.com/popcorn-official/popcorn-desktop/commit',
    dht: '',
    dhtInfo: '',
    updateKey: '',
    opensubtitles: { useragent: 'Butter' },
    trakttv: {
      client_id: secrets.traktClientId ?? '',
      client_secret: secrets.traktClientSecret ?? '',
    },
    fanart: { api_key: secrets.fanartApiKey ?? 'ce4bba4b3cc473306c6cddb4e1cb0da4' },
    tvdb: { api_key: secrets.tvdbApiKey ?? '80A769280C71D83B' },
    // The key the original app shipped; the plan still wants this rotated eventually.
    tmdb: { api_key: secrets.tmdbApiKey ?? 'ac92176abc89a80e6f5df9510e326601' },
    providers: {
      movie: { order: 1, name: 'Movies', uri: [] },
      tvshow: { order: 2, name: 'Series', uri: [] },
      anime: { order: 3, name: 'Anime', uri: [] },
      subtitle: 'OpenSubtitles',
      metadata: 'Trakttv',
      torrentCache: 'TorrentCache',
    },
    trackers: {
      blacklisted: ['demonii'],
      forced: [...DEFAULT_TRACKERS],
    },
    theme: 'Official_-_Dark_theme',
    startScreen: 'Movies',
    lastTab: '',
    moviesTabEnable: true,
    seriesTabEnable: true,
    animeTabEnable: true,
    favoritesTabEnable: true,
    watchedTabEnable: true,
    coversShowRating: true,
    alwaysShowBookmarks: false,
    showSeedboxOnDlInit: true,
    expandedSearch: false,
    defaultFilters: 'default',
    watchedCovers: 'fade',
    tv_detail_jump_to: 'next',
    postersMinWidth: 134,
    postersMaxWidth: 294,
    postersMinFontSize: 0.8,
    postersMaxFontSize: 1.3,
    postersSizeRatio: 196 / 134,
    postersWidth: 134,
    postersJump: [134, 154, 174, 194, 214, 234, 254, 274, 294],
    bigPicture: 100,
    moviesUITransparency: '0.65',
    seriesUITransparency: 'medium',
    nativeWindowFrame: environment.windowFrame,
    alwaysOnTop: false,
    minimizeToTray: false,
    events: true,
    ratingStars: true,
    showAdvancedSettings: true,
    language: '',
    contentLanguage: '',
    contentLangOnly: false,
    translateTitle: 'translated',
    translateEpisodes: true,
    translateSynopsis: true,
    translatePosters: true,
    subtitle_language: 'none',
    subtitle_font: 'Arial',
    subtitle_decoration: 'Outline',
    subtitle_size: '38px',
    subtitle_color: '#ffffff',
    subtitles_bold: false,
    multipleExtSubtitles: false,
    opensubtitlesAuthenticated: false,
    opensubtitlesUsername: '',
    opensubtitlesPassword: '',
    playerSubPosition: '0px',
    lastWatchedTitle: '',
    lastWatchedTime: false,
    alwaysFullscreen: false,
    playNextEpisodeAuto: false,
    preloadNextEpisodeTime: 1,
    activateLoCtrl: false,
    chosenPlayer: 'local',
    shows_default_quality: '1080p',
    movies_default_quality: '1080p',
    playerVolume: '1',
    audioPassthrough: false,
    activateWatchlist: false,
    traktStatus: false,
    traktLastSync: false,
    traktLastActivities: false,
    traktSyncOnStart: true,
    traktPlayback: true,
    activateTorrentCollection: true,
    toggleSengines: false,
    enableThepiratebaySearch: true,
    enable1337xSearch: true,
    enableSolidTorrentsSearch: true,
    enableTgxtorrentSearch: false,
    enableNyaaSearch: true,
    activateSeedbox: true,
    activateTempf: true,
    httpApiEnabled: false,
    httpApiPort: 8008,
    httpApiUsername: 'popcorn',
    httpApiPassword: 'popcorn',
    customMoviesServer: '',
    customSeriesServer: '',
    customAnimeServer: '',
    dhtEnable: '',
    maxActiveTorrents: 5,
    connectionLimit: 55,
    maxUdpReqLimit: 16,
    downloadLimit: '',
    uploadLimit: '',
    maxLimitMult: 1024,
    totalDownloaded: 0,
    totalUploaded: 0,
    streamPort: 0,
    continueSeedingOnStart: false,
    protocolEncryption: false,
    proxyServer: '',
    tmpLocation: join(environment.tempDir, PROJECT_NAME),
    deleteTmpOnClose: true,
    delSeedboxCache: 'ask',
    separateDownloadsDir: false,
    downloadsLocation: join(environment.tempDir, PROJECT_NAME),
    databaseLocation: join(environment.dataDir, 'data'),
    updateNotification: '',
    version: environment.appVersion,
    dbversion: '0.1.0',
    font: 'tahoma',
    defaultWidth: Math.round(environment.screen.width * 0.8),
    defaultHeight: Math.round(environment.screen.height * 0.8),
    updateEndpoint: {
      url: 'https://butterproject.org/',
      index: 0,
      proxies: [
        { url: 'https://butterproject.org/', fingerprint: '' },
        { url: 'https://butterproject.github.io/', fingerprint: '' },
      ],
    },
    arch: environment.arch,
    os: osName(environment.platform),
    releaseName: environment.releaseName,
  }
}

/** Persistence port; the database ticket supplies the SQLite implementation. */
export interface SettingsStoreShape {
  readonly read: Effect.Effect<Record<string, unknown>, SettingsError>
  readonly write: (key: string, value: unknown) => Effect.Effect<void, SettingsError>
}

export class SettingsStore extends Context.Tag('SettingsStore')<
  SettingsStore,
  SettingsStoreShape
>() {}

export interface SettingsServiceShape {
  readonly get: <K extends SettingsKey>(key: K) => Effect.Effect<Settings[K]>
  /** String-keyed read for the IPC boundary; unknown keys fail with SettingsError. */
  readonly read: (key: string) => Effect.Effect<unknown, SettingsError>
  readonly set: (key: string, value: unknown) => Effect.Effect<void, SettingsError>
  readonly snapshot: Effect.Effect<Settings>
}

export class SettingsService extends Context.Tag('SettingsService')<
  SettingsService,
  SettingsServiceShape
>() {}

function fieldSchema(key: string): Schema.Schema<unknown> | undefined {
  return (SettingsFields as Record<string, Schema.Schema<unknown>>)[key]
}

/**
 * Persisted values are validated per key; a bad row falls back to its default rather
 * than bricking startup. The cast is contained: every surviving entry was decoded by
 * its own field schema.
 */
function withPersisted(defaults: Settings, persisted: Record<string, unknown>): Settings {
  const merged: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(persisted)) {
    const field = fieldSchema(key)
    if (!field) continue
    const decoded = Schema.decodeUnknownOption(field)(value)
    if (Option.isSome(decoded)) {
      merged[key] = decoded.value
    }
  }
  return merged as Settings
}

export function SettingsServiceLive(environment: SettingsEnvironment) {
  return Layer.effect(
    SettingsService,
    Effect.gen(function* () {
      // Migration depends here, so the Layer graph runs it before any setting is read.
      yield* LegacyMigration
      const store = yield* SettingsStore
      const persisted = yield* store.read
      const state = yield* Ref.make(withPersisted(settingsDefaults(environment), persisted))

      const get: SettingsServiceShape['get'] = (key) =>
        Effect.map(Ref.get(state), (settings) => settings[key])

      const read: SettingsServiceShape['read'] = (key) =>
        Effect.gen(function* () {
          if (fieldSchema(key) === undefined) {
            return yield* Effect.fail(new SettingsError({ message: 'unknown settings key', key }))
          }
          return yield* get(key as SettingsKey)
        })

      const set: SettingsServiceShape['set'] = (key, value) =>
        Effect.gen(function* () {
          const field = fieldSchema(key)
          if (!field) {
            return yield* Effect.fail(new SettingsError({ message: 'unknown settings key', key }))
          }
          const decoded = yield* Schema.decodeUnknown(field)(value).pipe(
            Effect.mapError(
              (cause) => new SettingsError({ message: `invalid value for "${key}"`, key, cause }),
            ),
          )
          yield* store.write(key, decoded)
          yield* Ref.update(state, (settings) => ({ ...settings, [key]: decoded }) as Settings)
        })

      return SettingsService.of({ get, read, set, snapshot: Ref.get(state) })
    }),
  )
}
