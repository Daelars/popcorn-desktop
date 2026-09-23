import type { Settings, SettingsKey } from './settings'

/**
 * The settings screen as data: section order, one descriptor per control, and the few
 * legacy-only combinations (tabs, transparency, speed, ratio, colour). Labels come from
 * `SETTINGS_METADATA`; this file owns layout, options and visibility so a key is described
 * once instead of inline in the route. The DOM and classes match `settings-container.tpl`
 * so the theme CSS keeps applying.
 */

export interface SettingOption {
  readonly value: string
  readonly label: string
}

/** Options that cannot be data (they come from the theme list or the i18n language list). */
export type OptionSource =
  | 'themes'
  | 'startScreens'
  | 'languages'
  | 'contentLanguages'
  | 'subtitleLanguages'

type Visibility = (settings: Partial<Settings> | undefined) => boolean

interface RowBase {
  readonly key: SettingsKey
  readonly visibleWhen?: Visibility
}

export interface CheckboxRow extends RowBase {
  readonly kind: 'checkbox'
  readonly label?: string
  readonly labelId?: string
  readonly hint?: string
  /** The legacy `nativeWindowFrame` flashed a restart notice when it changed. */
  readonly notifyRestart?: boolean
}

export interface SelectRow extends RowBase {
  readonly kind: 'select'
  readonly label?: string
  readonly className?: string
  readonly options: ReadonlyArray<SettingOption> | OptionSource
  readonly numeric?: boolean
  /** The language picker also switches the running i18n language. */
  readonly onChange?: 'language'
}

export interface TextRow extends RowBase {
  readonly kind: 'text'
  readonly label?: string
  readonly size?: number
  readonly placeholder?: string
  readonly readOnly?: boolean
  readonly folder?: 'cache' | 'downloads' | 'database'
}

export interface NumberRow extends RowBase {
  readonly kind: 'number'
  readonly label?: string
  readonly min?: number
  readonly max?: number
  readonly hint?: string
}

export interface ColourRow extends RowBase {
  readonly kind: 'colour'
  readonly label?: string
}

/** The five tab checkboxes share one `Tabs` block. */
export interface TabsRow {
  readonly kind: 'tabs'
}

/** Movies/Series transparency selects inside one `.UITransparency` block. */
export interface TransparencyRow {
  readonly kind: 'transparency'
}

/** `Max. Down / Up Speed`: two limit fields and the unit select. */
export interface SpeedRow {
  readonly kind: 'speed'
}

/** Read-only overall ratio, computed from the downloaded/uploaded totals. */
export interface RatioRow {
  readonly kind: 'ratio'
}

/** `playNextEpisodeAuto` plus the preload-minutes field it reveals. */
export interface PreloadRow {
  readonly kind: 'preload'
}

/** `contentLanguage` plus the `contentLangOnly` checkbox, as the legacy kept them together. */
export interface ContentLanguageRow {
  readonly kind: 'contentLanguage'
}

export type SettingRow =
  | CheckboxRow
  | SelectRow
  | TextRow
  | NumberRow
  | ColourRow
  | TabsRow
  | TransparencyRow
  | SpeedRow
  | RatioRow
  | PreloadRow
  | ContentLanguageRow

export interface SettingSectionSpec {
  readonly id: string
  readonly title: string
  readonly rows: ReadonlyArray<SettingRow>
  /** A section-level `<em>` note, e.g. the translation or API-server caveat. */
  readonly hint?: string
  /** The legacy id for the hint element, kept so the theme CSS still targets it. */
  readonly hintId?: string
}

export const POSTER_SIZES: ReadonlyArray<SettingOption> = [
  { value: '134', label: '100%' },
  { value: '154', label: '113%' },
  { value: '174', label: '125%' },
  { value: '194', label: '138%' },
  { value: '214', label: '150%' },
  { value: '234', label: '163%' },
  { value: '254', label: '175%' },
  { value: '274', label: '188%' },
  { value: '294', label: '200%' },
]

export const MOVIE_TRANSPARENCY: ReadonlyArray<SettingOption> = [
  { value: '1', label: 'Disabled' },
  { value: '0.90', label: 'Very Low' },
  { value: '0.75', label: 'Low' },
  { value: '0.65', label: 'Medium' },
  { value: '0.55', label: 'High' },
  { value: '0.40', label: 'Very High' },
]

export const SERIES_TRANSPARENCY: ReadonlyArray<SettingOption> = [
  { value: '', label: 'Disabled' },
  { value: 'vlow', label: 'Very Low' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'vhigh', label: 'Very High' },
]

export const DEFAULT_FILTERS: ReadonlyArray<SettingOption> = [
  { value: 'default', label: 'Default' },
  { value: 'custom', label: 'Custom' },
  { value: 'remember', label: 'Remember' },
]

export const WATCHED_COVERS: ReadonlyArray<SettingOption> = [
  { value: 'none', label: 'Show' },
  { value: 'fade', label: 'Fade' },
  { value: 'hide', label: 'Hide' },
]

export const TV_DETAIL_JUMP: ReadonlyArray<SettingOption> = [
  { value: 'next', label: 'Next episode' },
  { value: 'firstUnwatched', label: 'First unwatched episode' },
]

export const TITLE_TRANSLATION: ReadonlyArray<SettingOption> = [
  { value: 'origin', label: 'Original only' },
  { value: 'origin-translated', label: 'Original - Translated' },
  { value: 'translated-origin', label: 'Translated - Original' },
  { value: 'translated', label: 'Translated only' },
]

export const SUBTITLE_DECORATION: ReadonlyArray<SettingOption> = [
  { value: 'None', label: 'None' },
  { value: 'Outline', label: 'Outline' },
  { value: 'Opaque Background', label: 'Opaque Background' },
  { value: 'See-through Background', label: 'See-through Background' },
]

const SUBTITLE_FONT_NAMES = [
  'Arial',
  'Open Sans',
  'Roboto',
  'Tahoma',
  'Verdana',
  'Georgia',
  'Trebuchet MS',
  'Comic Sans MS',
  'Helvetica',
  'Lato',
  'Montserrat',
  'Ubuntu',
  'PT Sans',
  'OpenDyslexic',
  'Deja Vu Sans',
  'Droid Sans',
  'Geneva',
  'AljazeeraMedExtOf',
  'Khalid Art',
]

export const SUBTITLE_FONTS: ReadonlyArray<SettingOption> = SUBTITLE_FONT_NAMES.map((font) => ({
  value: font,
  label: font,
}))

export const SUBTITLE_SIZES: ReadonlyArray<SettingOption> = Array.from(
  { length: 21 },
  (_unused, index) => {
    const size = `${20 + index * 2}px`
    return { value: size, label: size }
  },
)

export const DEL_SEEDBOX_CACHE: ReadonlyArray<SettingOption> = [
  { value: 'always', label: 'Always' },
  { value: 'never', label: 'Never' },
  { value: 'ask', label: 'Ask me every time' },
]

export const LIMIT_MULTIPLIERS: ReadonlyArray<SettingOption> = [
  { value: '1024', label: 'KB/s' },
  { value: '1048576', label: 'MB/s' },
]

export const DEFAULT_QUALITIES: ReadonlyArray<SettingOption> = [
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
]

export const CHOSEN_PLAYERS: ReadonlyArray<SettingOption> = [
  { value: 'local', label: 'Local player' },
  { value: 'extplayer', label: 'External player' },
]

export const TAB_CHECKBOXES: ReadonlyArray<CheckboxRow> = [
  { kind: 'checkbox', key: 'moviesTabEnable', label: 'Movies' },
  { kind: 'checkbox', key: 'seriesTabEnable', label: 'Series' },
  { kind: 'checkbox', key: 'animeTabEnable', label: 'Anime' },
  { kind: 'checkbox', key: 'favoritesTabEnable', label: 'Favorites' },
  { kind: 'checkbox', key: 'watchedTabEnable', label: 'Watched' },
]

const seedbox: Visibility = (settings) => settings?.activateSeedbox === true

export const SETTINGS_LAYOUT: ReadonlyArray<SettingSectionSpec> = [
  {
    id: 'user-interface',
    title: 'User Interface',
    rows: [
      { kind: 'select', key: 'theme', label: 'Theme', className: 'pct-theme', options: 'themes' },
      {
        kind: 'select',
        key: 'startScreen',
        label: 'Start Screen',
        className: 'start-screen',
        options: 'startScreens',
      },
      { kind: 'tabs' },
      { kind: 'checkbox', key: 'coversShowRating', label: 'Show rating over covers' },
      {
        kind: 'checkbox',
        key: 'alwaysShowBookmarks',
        label: 'Always show bookmark over covers',
      },
      {
        kind: 'checkbox',
        key: 'showSeedboxOnDlInit',
        label: 'Show the Seedbox when a new download is added',
        visibleWhen: seedbox,
      },
      { kind: 'checkbox', key: 'expandedSearch', label: 'Search field always expanded' },
      {
        kind: 'select',
        key: 'defaultFilters',
        label: 'Default Filters',
        className: 'defaultFilters',
        options: DEFAULT_FILTERS,
      },
      {
        kind: 'select',
        key: 'watchedCovers',
        label: 'Watched Items',
        className: 'watchedCovers',
        options: WATCHED_COVERS,
      },
      {
        kind: 'select',
        key: 'tv_detail_jump_to',
        label: 'Series detail opens to',
        className: 'tv_detail_jump_to',
        options: TV_DETAIL_JUMP,
      },
      {
        kind: 'select',
        key: 'postersWidth',
        label: 'Poster Size',
        className: 'poster_size',
        options: POSTER_SIZES,
        numeric: true,
      },
      {
        kind: 'number',
        key: 'bigPicture',
        label: 'UI Scaling',
        min: 25,
        max: 400,
        hint: 'percent',
      },
      { kind: 'transparency' },
      {
        kind: 'checkbox',
        key: 'nativeWindowFrame',
        label: 'Native window frame',
        notifyRestart: true,
      },
      { kind: 'checkbox', key: 'alwaysOnTop', label: 'Always On Top' },
      { kind: 'checkbox', key: 'minimizeToTray', label: 'Minimize to Tray' },
      { kind: 'checkbox', key: 'events', label: 'Celebrate various events' },
    ],
  },
  {
    id: 'localisation',
    title: 'Language',
    rows: [
      {
        kind: 'select',
        key: 'language',
        label: 'Default Language',
        className: 'subtitles-language',
        options: 'languages',
        onChange: 'language',
      },
      { kind: 'contentLanguage' },
      {
        kind: 'select',
        key: 'translateTitle',
        label: 'Title translation',
        className: 'translateTitle',
        options: TITLE_TRANSLATION,
      },
      { kind: 'checkbox', key: 'translateEpisodes', label: 'Translate Episode Titles' },
      { kind: 'checkbox', key: 'translateSynopsis', label: 'Translate Synopsis' },
      { kind: 'checkbox', key: 'translatePosters', label: 'Translate Posters' },
    ],
    hint: 'Translations depend on availability. Some options also might not be supported by all API servers',
    hintId: 'translation_info',
  },
  {
    id: 'subtitles',
    title: 'Subtitles',
    rows: [
      {
        kind: 'select',
        key: 'subtitle_language',
        label: 'Default Subtitle',
        className: 'subtitles-language-default',
        options: 'subtitleLanguages',
      },
      {
        kind: 'select',
        key: 'subtitle_font',
        label: 'Font',
        className: 'subtitles-font',
        options: SUBTITLE_FONTS,
      },
      {
        kind: 'select',
        key: 'subtitle_decoration',
        label: 'Decoration',
        className: 'subtitles-decoration',
        options: SUBTITLE_DECORATION,
      },
      {
        kind: 'select',
        key: 'subtitle_size',
        label: 'Size',
        className: 'subtitles-size',
        options: SUBTITLE_SIZES,
      },
      { kind: 'colour', key: 'subtitle_color', label: 'Color' },
      { kind: 'checkbox', key: 'subtitles_bold', label: 'Bold', labelId: 'subsbold' },
      {
        kind: 'checkbox',
        key: 'multipleExtSubtitles',
        label: 'Show all available subtitles for default language in flag menu',
      },
    ],
  },
  {
    id: 'playback',
    title: 'Playback',
    rows: [
      { kind: 'checkbox', key: 'alwaysFullscreen', label: 'Always start playing in fullscreen' },
      { kind: 'preload' },
      { kind: 'checkbox', key: 'audioPassthrough', label: 'Allow Audio Passthrough' },
      {
        kind: 'select',
        key: 'movies_default_quality',
        label: 'Movies default quality',
        options: DEFAULT_QUALITIES,
      },
      {
        kind: 'select',
        key: 'shows_default_quality',
        label: 'Series default quality',
        options: DEFAULT_QUALITIES,
      },
      { kind: 'select', key: 'chosenPlayer', label: 'Player', options: CHOSEN_PLAYERS },
    ],
  },
  {
    id: 'features',
    title: 'Features',
    rows: [
      { kind: 'checkbox', key: 'activateWatchlist', label: 'Watchlist' },
      { kind: 'checkbox', key: 'activateTorrentCollection', label: 'Torrent Collection' },
      { kind: 'checkbox', key: 'activateSeedbox', label: 'Seedbox' },
      { kind: 'checkbox', key: 'activateTempf', label: 'Cache Folder Button' },
    ],
  },
  {
    id: 'remote-control',
    title: 'Remote Control',
    rows: [
      { kind: 'checkbox', key: 'httpApiEnabled', label: 'Enable remote control' },
      {
        kind: 'number',
        key: 'httpApiPort',
        label: 'HTTP API Port',
        visibleWhen: (s) => s?.httpApiEnabled === true,
      },
      {
        kind: 'text',
        key: 'httpApiUsername',
        label: 'HTTP API Username',
        visibleWhen: (s) => s?.httpApiEnabled === true,
      },
      {
        kind: 'text',
        key: 'httpApiPassword',
        label: 'HTTP API Password',
        visibleWhen: (s) => s?.httpApiEnabled === true,
      },
    ],
  },
  {
    id: 'apiserver',
    title: 'API Server(s)',
    rows: [
      { kind: 'text', key: 'customMoviesServer', label: 'Movies API Server(s)', size: 61 },
      { kind: 'text', key: 'customSeriesServer', label: 'Series API Server(s)', size: 61 },
      { kind: 'text', key: 'customAnimeServer', label: 'Anime API Server(s)', size: 61 },
    ],
    hint: 'You can add multiple API Servers separated with a , from which it will select randomly (*for load balancing) until it finds the first available',
    hintId: 'apiserver_info',
  },
  {
    id: 'connection',
    title: 'Connection',
    rows: [
      {
        kind: 'number',
        key: 'maxActiveTorrents',
        label: 'Active Torrents Limit',
        visibleWhen: seedbox,
      },
      { kind: 'number', key: 'connectionLimit', label: 'Connection Limit' },
      { kind: 'number', key: 'maxUdpReqLimit', label: 'DHT UDP Requests Limit' },
      { kind: 'speed' },
      { kind: 'ratio' },
      { kind: 'number', key: 'streamPort', label: 'Port to stream on', hint: '0 = Random' },
      {
        kind: 'checkbox',
        key: 'continueSeedingOnStart',
        label: 'Resume seeding after restarting the app?',
        visibleWhen: (s) =>
          seedbox(s) && (s?.deleteTmpOnClose !== true || s?.separateDownloadsDir === true),
      },
      {
        kind: 'checkbox',
        key: 'protocolEncryption',
        label: 'Enable Protocol Encryption',
        labelId: 'protocolEnc',
        hint: 'Allows connecting to peers that use PE/MSE. Will in most cases increase the number of connectable peers but might also result in increased CPU usage',
      },
      {
        kind: 'text',
        key: 'proxyServer',
        label: 'Proxy Server',
        size: 50,
        placeholder: 'host:port (127.0.0.1:9050 or 127.0.0.1:4447)',
      },
    ],
  },
  {
    id: 'cache',
    title: 'Cache',
    rows: [
      {
        kind: 'text',
        key: 'tmpLocation',
        label: 'Cache Directory',
        size: 61,
        readOnly: true,
        folder: 'cache',
      },
      {
        kind: 'checkbox',
        key: 'deleteTmpOnClose',
        label: 'Clear Cache Folder after closing the app?',
      },
      {
        kind: 'select',
        key: 'delSeedboxCache',
        label: 'Delete related cache when removing from Seedbox',
        className: 'del-seedbox-cache',
        options: DEL_SEEDBOX_CACHE,
        visibleWhen: seedbox,
      },
      {
        kind: 'checkbox',
        key: 'separateDownloadsDir',
        label: 'Separate directory for Downloads',
        labelId: 'downloadsDir',
        hint: 'Enabling will prevent the sharing of cache between the Watch Now and Download functions',
        visibleWhen: seedbox,
      },
      {
        kind: 'text',
        key: 'downloadsLocation',
        label: 'Downloads Directory',
        size: 61,
        readOnly: true,
        folder: 'downloads',
        visibleWhen: (s) => seedbox(s) && s?.separateDownloadsDir === true,
      },
    ],
  },
  {
    id: 'database',
    title: 'Database',
    rows: [
      {
        kind: 'text',
        key: 'databaseLocation',
        label: 'Database Directory',
        size: 61,
        readOnly: true,
        folder: 'database',
      },
    ],
  },
]
