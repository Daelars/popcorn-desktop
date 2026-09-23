import { SettingsFields, type SettingsKey } from './settings'

/**
 * Where a setting is edited and how it is applied. Metadata lives next to the schema so the
 * renderer can import it; a new key with no entry fails pnpm typecheck.
 */
export type SettingControl = 'checkbox' | 'select' | 'text' | 'number' | 'password' | 'path'

export type SettingSection =
  | 'about'
  | 'interface'
  | 'language'
  | 'playback'
  | 'subtitles'
  | 'torrents'
  | 'providers'
  | 'metadata'
  | 'updates'
  | 'trakt'
  | 'httpApi'
  | 'system'

export interface SettingMetadata {
  readonly label: string
  readonly control: SettingControl
  readonly section: SettingSection
  readonly options?: ReadonlyArray<string>
  /** A setting that needs a restart is applied at the next launch, as the legacy app did. */
  readonly apply?: 'live' | 'restart'
  /** Modules that read this key. Empty means inert, and then inertReason explains why. */
  readonly consumers: ReadonlyArray<string>
  readonly inertReason?: string
}

interface MetaInput {
  readonly label: string
  readonly control: SettingControl
  readonly section: SettingSection
  readonly options?: ReadonlyArray<string>
  readonly apply?: 'live' | 'restart'
  readonly consumers: ReadonlyArray<string>
  readonly inertReason?: string
}

function meta(input: MetaInput): SettingMetadata {
  return {
    label: input.label,
    control: input.control,
    section: input.section,
    ...(input.options === undefined ? {} : { options: input.options }),
    ...(input.apply === undefined ? {} : { apply: input.apply }),
    consumers: input.consumers,
    ...(input.inertReason === undefined ? {} : { inertReason: input.inertReason }),
  }
}

/** A key with no metadata is a compile error. */
export const SETTINGS_METADATA: { readonly [K in SettingsKey]: SettingMetadata } = {
  projectName: meta({
    label: 'Project Name',
    control: 'text',
    section: 'about',
    consumers: ['renderer:AboutPage'],
  }),
  projectUrl: meta({
    label: 'Project Url',
    control: 'text',
    section: 'about',
    consumers: ['renderer:AboutPage'],
  }),
  projectBlog: meta({
    label: 'Project Blog',
    control: 'text',
    section: 'about',
    consumers: ['renderer:AboutPage'],
  }),
  projectForum: meta({
    label: 'Project Forum',
    control: 'text',
    section: 'about',
    consumers: ['renderer:AboutPage'],
  }),
  statusUrl: meta({
    label: 'Status Url',
    control: 'text',
    section: 'about',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  changelogUrl: meta({
    label: 'Changelog Url',
    control: 'text',
    section: 'about',
    consumers: ['renderer:AboutPage'],
  }),
  issuesUrl: meta({
    label: 'Issues Url',
    control: 'text',
    section: 'about',
    consumers: ['renderer:AboutPage'],
  }),
  sourceUrl: meta({
    label: 'Source Url',
    control: 'text',
    section: 'about',
    consumers: ['renderer:AboutPage'],
  }),
  commitUrl: meta({
    label: 'Commit Url',
    control: 'text',
    section: 'about',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  dht: meta({
    label: 'Dht',
    control: 'text',
    section: 'torrents',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  dhtInfo: meta({
    label: 'Dht Info',
    control: 'text',
    section: 'torrents',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  updateKey: meta({
    label: 'Update Key',
    control: 'text',
    section: 'updates',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  opensubtitles: meta({
    label: 'Opensubtitles',
    control: 'text',
    section: 'subtitles',
    consumers: ['main:SubtitlesService'],
  }),
  trakttv: meta({
    label: 'Trakttv',
    control: 'text',
    section: 'metadata',
    consumers: ['main:providers'],
  }),
  fanart: meta({
    label: 'Fanart',
    control: 'text',
    section: 'metadata',
    consumers: ['main:providers'],
  }),
  tvdb: meta({
    label: 'Tvdb',
    control: 'text',
    section: 'metadata',
    consumers: ['main:providers'],
  }),
  tmdb: meta({
    label: 'Tmdb',
    control: 'text',
    section: 'metadata',
    consumers: ['main:ProvidersService'],
  }),
  providers: meta({
    label: 'Providers',
    control: 'text',
    section: 'metadata',
    consumers: ['main:ProvidersService'],
  }),
  trackers: meta({
    label: 'Trackers',
    control: 'text',
    section: 'torrents',
    consumers: ['main:WebTorrentEngineLive'],
  }),
  theme: meta({
    label: 'Theme',
    control: 'text',
    section: 'interface',
    options: ['Official_-_Dark_theme', 'Official_-_Light_theme'],
    consumers: ['renderer:App'],
  }),
  startScreen: meta({
    label: 'Start Screen',
    control: 'text',
    section: 'interface',
    options: ['Movies', 'Series', 'Anime', 'Favorites', 'Watched'],
    consumers: ['renderer:StartScreen'],
  }),
  lastTab: meta({
    label: 'Last Tab',
    control: 'text',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  moviesTabEnable: meta({
    label: 'Movies Tab Enable',
    control: 'checkbox',
    section: 'interface',
    consumers: ['renderer:FilterBar'],
  }),
  seriesTabEnable: meta({
    label: 'Series Tab Enable',
    control: 'checkbox',
    section: 'interface',
    consumers: ['renderer:FilterBar'],
  }),
  animeTabEnable: meta({
    label: 'Anime Tab Enable',
    control: 'checkbox',
    section: 'interface',
    consumers: ['renderer:FilterBar'],
  }),
  favoritesTabEnable: meta({
    label: 'Favorites Tab Enable',
    control: 'checkbox',
    section: 'interface',
    consumers: ['renderer:FilterBar'],
  }),
  watchedTabEnable: meta({
    label: 'Watched Tab Enable',
    control: 'checkbox',
    section: 'interface',
    consumers: ['renderer:FilterBar'],
  }),
  coversShowRating: meta({
    label: 'Covers Show Rating',
    control: 'checkbox',
    section: 'interface',
    consumers: ['renderer:PosterGrid'],
  }),
  alwaysShowBookmarks: meta({
    label: 'Always Show Bookmarks',
    control: 'checkbox',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  showSeedboxOnDlInit: meta({
    label: 'Show Seedbox On Dl Init',
    control: 'checkbox',
    section: 'system',
    consumers: ['renderer:ShowDetail', 'renderer:MovieDetail'],
  }),
  expandedSearch: meta({
    label: 'Expanded Search',
    control: 'checkbox',
    section: 'interface',
    consumers: ['renderer:FilterBar'],
  }),
  defaultFilters: meta({
    label: 'Default Filters',
    control: 'text',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  watchedCovers: meta({
    label: 'Watched Covers',
    control: 'text',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  tv_detail_jump_to: meta({
    label: 'Tv detail jump to',
    control: 'text',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  postersMinWidth: meta({
    label: 'Posters Min Width',
    control: 'number',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  postersMaxWidth: meta({
    label: 'Posters Max Width',
    control: 'number',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  postersMinFontSize: meta({
    label: 'Posters Min Font Size',
    control: 'number',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  postersMaxFontSize: meta({
    label: 'Posters Max Font Size',
    control: 'number',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  postersSizeRatio: meta({
    label: 'Posters Size Ratio',
    control: 'number',
    section: 'interface',
    consumers: ['renderer:PosterGrid'],
  }),
  postersWidth: meta({
    label: 'Posters Width',
    control: 'number',
    section: 'interface',
    consumers: ['renderer:PosterGrid'],
  }),
  postersJump: meta({
    label: 'Posters Jump',
    control: 'number',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  bigPicture: meta({
    label: 'Big Picture',
    control: 'number',
    section: 'interface',
    consumers: ['renderer:App', 'main:SettingsEffects'],
  }),
  moviesUITransparency: meta({
    label: 'Movies U I Transparency',
    control: 'text',
    section: 'interface',
    consumers: ['renderer:BrowsePage'],
  }),
  seriesUITransparency: meta({
    label: 'Series U I Transparency',
    control: 'text',
    section: 'interface',
    consumers: ['renderer:BrowsePage'],
  }),
  nativeWindowFrame: meta({
    label: 'Native Window Frame',
    control: 'checkbox',
    section: 'interface',
    apply: 'restart',
    consumers: ['main:index', 'renderer:App'],
  }),
  alwaysOnTop: meta({
    label: 'Always On Top',
    control: 'checkbox',
    section: 'interface',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  minimizeToTray: meta({
    label: 'Minimize To Tray',
    control: 'checkbox',
    section: 'interface',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  events: meta({
    label: 'Events',
    control: 'checkbox',
    section: 'interface',
    consumers: ['renderer:App'],
  }),
  ratingStars: meta({
    label: 'Rating Stars',
    control: 'checkbox',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  showAdvancedSettings: meta({
    label: 'Show Advanced Settings',
    control: 'checkbox',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  language: meta({
    label: 'Language',
    control: 'text',
    section: 'language',
    consumers: ['main:ProvidersService', 'renderer:i18n'],
  }),
  contentLanguage: meta({
    label: 'Content Language',
    control: 'text',
    section: 'language',
    consumers: ['main:ProvidersService'],
  }),
  contentLangOnly: meta({
    label: 'Content Lang Only',
    control: 'checkbox',
    section: 'language',
    consumers: ['main:ProvidersService'],
  }),
  translateTitle: meta({
    label: 'Translate Title',
    control: 'text',
    section: 'language',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  translateEpisodes: meta({
    label: 'Translate Episodes',
    control: 'checkbox',
    section: 'language',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  translateSynopsis: meta({
    label: 'Translate Synopsis',
    control: 'checkbox',
    section: 'language',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  translatePosters: meta({
    label: 'Translate Posters',
    control: 'checkbox',
    section: 'language',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  subtitle_language: meta({
    label: 'Subtitle language',
    control: 'text',
    section: 'subtitles',
    consumers: ['renderer:Player'],
  }),
  subtitle_font: meta({
    label: 'Subtitle font',
    control: 'text',
    section: 'subtitles',
    consumers: ['renderer:Player'],
  }),
  subtitle_decoration: meta({
    label: 'Subtitle decoration',
    control: 'text',
    section: 'subtitles',
    consumers: ['renderer:Player'],
  }),
  subtitle_size: meta({
    label: 'Subtitle size',
    control: 'text',
    section: 'subtitles',
    options: ['30px', '34px', '38px', '42px', '46px'],
    consumers: ['renderer:Player'],
  }),
  subtitle_color: meta({
    label: 'Subtitle color',
    control: 'text',
    section: 'subtitles',
    consumers: ['renderer:Player'],
  }),
  subtitles_bold: meta({
    label: 'Subtitles bold',
    control: 'checkbox',
    section: 'subtitles',
    consumers: ['renderer:Player'],
  }),
  multipleExtSubtitles: meta({
    label: 'Multiple Ext Subtitles',
    control: 'checkbox',
    section: 'subtitles',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  opensubtitlesAuthenticated: meta({
    label: 'Opensubtitles Authenticated',
    control: 'checkbox',
    section: 'subtitles',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  opensubtitlesUsername: meta({
    label: 'Opensubtitles Username',
    control: 'text',
    section: 'subtitles',
    consumers: ['main:SubtitlesService'],
  }),
  opensubtitlesPassword: meta({
    label: 'Opensubtitles Password',
    control: 'text',
    section: 'subtitles',
    consumers: ['main:SubtitlesService'],
  }),
  playerSubPosition: meta({
    label: 'Player Sub Position',
    control: 'text',
    section: 'subtitles',
    consumers: ['renderer:Player'],
  }),
  lastWatchedTitle: meta({
    label: 'Last Watched Title',
    control: 'text',
    section: 'playback',
    consumers: ['renderer:Player'],
  }),
  lastWatchedTime: meta({
    label: 'Last Watched Time',
    control: 'number',
    section: 'playback',
    consumers: ['renderer:Player'],
  }),
  alwaysFullscreen: meta({
    label: 'Always Fullscreen',
    control: 'checkbox',
    section: 'playback',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  playNextEpisodeAuto: meta({
    label: 'Play Next Episode Auto',
    control: 'checkbox',
    section: 'playback',
    consumers: ['renderer:Player'],
  }),
  preloadNextEpisodeTime: meta({
    label: 'Preload Next Episode Time',
    control: 'number',
    section: 'playback',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  activateLoCtrl: meta({
    label: 'Activate Lo Ctrl',
    control: 'checkbox',
    section: 'playback',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  chosenPlayer: meta({
    label: 'Chosen Player',
    control: 'text',
    section: 'playback',
    consumers: ['renderer:PlayerChooser', 'renderer:PlayerPage'],
  }),
  shows_default_quality: meta({
    label: 'Shows default quality',
    control: 'text',
    section: 'playback',
    consumers: ['renderer:QualitySelector'],
  }),
  movies_default_quality: meta({
    label: 'Movies default quality',
    control: 'text',
    section: 'playback',
    consumers: ['renderer:QualitySelector'],
  }),
  playerVolume: meta({
    label: 'Player Volume',
    control: 'text',
    section: 'playback',
    consumers: ['renderer:Player'],
  }),
  audioPassthrough: meta({
    label: 'Audio Passthrough',
    control: 'checkbox',
    section: 'playback',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  activateWatchlist: meta({
    label: 'Activate Watchlist',
    control: 'checkbox',
    section: 'trakt',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  traktStatus: meta({
    label: 'Trakt Status',
    control: 'checkbox',
    section: 'trakt',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  traktLastSync: meta({
    label: 'Trakt Last Sync',
    control: 'checkbox',
    section: 'trakt',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  traktLastActivities: meta({
    label: 'Trakt Last Activities',
    control: 'checkbox',
    section: 'trakt',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  traktSyncOnStart: meta({
    label: 'Trakt Sync On Start',
    control: 'checkbox',
    section: 'trakt',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  traktPlayback: meta({
    label: 'Trakt Playback',
    control: 'checkbox',
    section: 'trakt',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  activateTorrentCollection: meta({
    label: 'Activate Torrent Collection',
    control: 'checkbox',
    section: 'providers',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  toggleSengines: meta({
    label: 'Toggle Sengines',
    control: 'checkbox',
    section: 'providers',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  enableThepiratebaySearch: meta({
    label: 'Enable Thepiratebay Search',
    control: 'checkbox',
    section: 'torrents',
    consumers: ['main:SearchService'],
  }),
  enable1337xSearch: meta({
    label: 'Enable1337x Search',
    control: 'checkbox',
    section: 'torrents',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  enableSolidTorrentsSearch: meta({
    label: 'Enable Solid Torrents Search',
    control: 'checkbox',
    section: 'torrents',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  enableTgxtorrentSearch: meta({
    label: 'Enable Tgxtorrent Search',
    control: 'checkbox',
    section: 'torrents',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  enableNyaaSearch: meta({
    label: 'Enable Nyaa Search',
    control: 'checkbox',
    section: 'torrents',
    consumers: ['main:SearchService'],
  }),
  activateSeedbox: meta({
    label: 'Activate Seedbox',
    control: 'checkbox',
    section: 'torrents',
    consumers: ['renderer:ShowDetail', 'renderer:MovieDetail'],
  }),
  activateTempf: meta({
    label: 'Activate Tempf',
    control: 'checkbox',
    section: 'providers',
    consumers: ['renderer:FilterBar'],
  }),
  httpApiEnabled: meta({
    label: 'Http Api Enabled',
    control: 'checkbox',
    section: 'httpApi',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  httpApiPort: meta({
    label: 'Http Api Port',
    control: 'number',
    section: 'httpApi',
    apply: 'restart',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  httpApiUsername: meta({
    label: 'Http Api Username',
    control: 'text',
    section: 'httpApi',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  httpApiPassword: meta({
    label: 'Http Api Password',
    control: 'text',
    section: 'httpApi',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  customMoviesServer: meta({
    label: 'Custom Movies Server',
    control: 'text',
    section: 'providers',
    consumers: ['main:ProvidersService'],
  }),
  customSeriesServer: meta({
    label: 'Custom Series Server',
    control: 'text',
    section: 'providers',
    consumers: ['main:ProvidersService'],
  }),
  customAnimeServer: meta({
    label: 'Custom Anime Server',
    control: 'text',
    section: 'providers',
    consumers: ['main:ProvidersService'],
  }),
  dhtEnable: meta({
    label: 'Dht Enable',
    control: 'text',
    section: 'torrents',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  maxActiveTorrents: meta({
    label: 'Max Active Torrents',
    control: 'number',
    section: 'torrents',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  connectionLimit: meta({
    label: 'Connection Limit',
    control: 'number',
    section: 'torrents',
    consumers: ['main:WebTorrentEngineLive'],
  }),
  maxUdpReqLimit: meta({
    label: 'Max Udp Req Limit',
    control: 'number',
    section: 'torrents',
    consumers: ['main:WebTorrentEngineLive'],
  }),
  downloadLimit: meta({
    label: 'Download Limit',
    control: 'text',
    section: 'torrents',
    consumers: ['main:WebTorrentEngineLive'],
  }),
  uploadLimit: meta({
    label: 'Upload Limit',
    control: 'text',
    section: 'torrents',
    consumers: ['main:WebTorrentEngineLive'],
  }),
  maxLimitMult: meta({
    label: 'Max Limit Mult',
    control: 'number',
    section: 'torrents',
    consumers: ['main:WebTorrentEngineLive'],
  }),
  totalDownloaded: meta({
    label: 'Total Downloaded',
    control: 'number',
    section: 'torrents',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  totalUploaded: meta({
    label: 'Total Uploaded',
    control: 'number',
    section: 'torrents',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  streamPort: meta({
    label: 'Stream Port',
    control: 'number',
    section: 'torrents',
    apply: 'restart',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  continueSeedingOnStart: meta({
    label: 'Continue Seeding On Start',
    control: 'checkbox',
    section: 'torrents',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  protocolEncryption: meta({
    label: 'Protocol Encryption',
    control: 'checkbox',
    section: 'torrents',
    consumers: ['main:WebTorrentEngineLive'],
  }),
  proxyServer: meta({
    label: 'Proxy Server',
    control: 'text',
    section: 'torrents',
    apply: 'restart',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  tmpLocation: meta({
    label: 'Tmp Location',
    control: 'text',
    section: 'torrents',
    apply: 'restart',
    consumers: ['main:ipc', 'renderer:PlayerPage'],
  }),
  deleteTmpOnClose: meta({
    label: 'Delete Tmp On Close',
    control: 'checkbox',
    section: 'torrents',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  delSeedboxCache: meta({
    label: 'Del Seedbox Cache',
    control: 'text',
    section: 'torrents',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  separateDownloadsDir: meta({
    label: 'Separate Downloads Dir',
    control: 'checkbox',
    section: 'torrents',
    consumers: [],
    inertReason: 'no consumer in the port yet (legacy-only or runtime-derived)',
  }),
  downloadsLocation: meta({
    label: 'Downloads Location',
    control: 'text',
    section: 'torrents',
    apply: 'restart',
    consumers: ['main:ipc'],
  }),
  databaseLocation: meta({
    label: 'Database Location',
    control: 'text',
    section: 'torrents',
    apply: 'restart',
    consumers: ['main:ipc', 'main:CollectionService'],
  }),
  updateNotification: meta({
    label: 'Update Notification',
    control: 'text',
    section: 'updates',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  version: meta({
    label: 'Version',
    control: 'checkbox',
    section: 'about',
    consumers: ['main:settingsDefaults'],
  }),
  dbversion: meta({
    label: 'Dbversion',
    control: 'text',
    section: 'about',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  font: meta({
    label: 'Font',
    control: 'text',
    section: 'interface',
    options: ['tahoma', 'Arial', 'Helvetica'],
    consumers: ['renderer:App'],
  }),
  defaultWidth: meta({
    label: 'Default Width',
    control: 'number',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  defaultHeight: meta({
    label: 'Default Height',
    control: 'number',
    section: 'interface',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  updateEndpoint: meta({
    label: 'Update Endpoint',
    control: 'text',
    section: 'updates',
    consumers: [],
    inertReason: 'no reader in the port yet (tracked in port-plan §5)',
  }),
  arch: meta({
    label: 'Arch',
    control: 'text',
    section: 'about',
    consumers: ['main:settingsDefaults'],
  }),
  os: meta({
    label: 'Os',
    control: 'text',
    section: 'about',
    consumers: ['main:settingsDefaults'],
  }),
  releaseName: meta({
    label: 'Release Name',
    control: 'text',
    section: 'about',
    consumers: ['main:settingsDefaults'],
  }),
}

/** The keys the port never reads; each carries its inertReason in the metadata. */
export const INERT_SETTINGS: ReadonlyArray<SettingsKey> = (
  Object.keys(SettingsFields) as SettingsKey[]
).filter((key) => SETTINGS_METADATA[key].consumers.length === 0)

/** The keys that need a restart to take effect. */
export const RESTART_SETTINGS: ReadonlyArray<SettingsKey> = (
  Object.keys(SettingsFields) as SettingsKey[]
).filter((key) => SETTINGS_METADATA[key].apply === 'restart')
