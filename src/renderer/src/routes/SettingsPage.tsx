import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { SettingsKey } from '../../../shared/settings'
import { changeLanguage, languages } from '../i18n'
import { useSettings } from '../settings'
import { themes } from '../theme'

type Update = (key: SettingsKey, value: unknown) => void

interface Choice {
  readonly value: string
  readonly label: string
}

const START_SCREENS = ['Movies', 'TV Series', 'Anime', 'Favorites', 'Watched', 'Last Open'] as const

const POSTER_SIZES: readonly Choice[] = [
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

const MOVIE_TRANSPARENCY: readonly Choice[] = [
  { value: '1', label: 'Disabled' },
  { value: '0.90', label: 'Very Low' },
  { value: '0.75', label: 'Low' },
  { value: '0.65', label: 'Medium' },
  { value: '0.55', label: 'High' },
  { value: '0.40', label: 'Very High' },
]

const SERIES_TRANSPARENCY: readonly Choice[] = [
  { value: '', label: 'Disabled' },
  { value: 'vlow', label: 'Very Low' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'vhigh', label: 'Very High' },
]

const DEFAULT_FILTERS: readonly Choice[] = [
  { value: 'default', label: 'Default' },
  { value: 'custom', label: 'Custom' },
  { value: 'remember', label: 'Remember' },
]

const WATCHED_COVERS: readonly Choice[] = [
  { value: 'none', label: 'Show' },
  { value: 'fade', label: 'Fade' },
  { value: 'hide', label: 'Hide' },
]

const TV_DETAIL_JUMP: readonly Choice[] = [
  { value: 'next', label: 'Next episode' },
  { value: 'firstUnwatched', label: 'First unwatched episode' },
]

const TITLE_TRANSLATION: readonly Choice[] = [
  { value: 'origin', label: 'Original only' },
  { value: 'origin-translated', label: 'Original - Translated' },
  { value: 'translated-origin', label: 'Translated - Original' },
  { value: 'translated', label: 'Translated only' },
]

const SUBTITLE_DECORATION: readonly Choice[] = [
  { value: 'None', label: 'None' },
  { value: 'Outline', label: 'Outline' },
  { value: 'Opaque Background', label: 'Opaque Background' },
  { value: 'See-through Background', label: 'See-through Background' },
]

const SUBTITLE_FONTS: readonly Choice[] = [
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
].map((font) => ({ value: font, label: font }))

const SUBTITLE_SIZES: readonly Choice[] = Array.from({ length: 21 }, (_unused, index) => {
  const size = `${20 + index * 2}px`
  return { value: size, label: size }
})

const DEL_SEEDBOX_CACHE: readonly Choice[] = [
  { value: 'always', label: 'Always' },
  { value: 'never', label: 'Never' },
  { value: 'ask', label: 'Ask me every time' },
]

const LIMIT_MULTIPLIERS: readonly Choice[] = [
  { value: '1024', label: 'KB/s' },
  { value: '1048576', label: 'MB/s' },
]

const DEFAULT_QUALITIES: readonly Choice[] = [
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
]

const CHOSEN_PLAYERS: readonly Choice[] = [
  { value: 'local', label: 'Local player' },
  { value: 'extplayer', label: 'External player' },
]

const LANGUAGE_OPTIONS: readonly Choice[] = languages.map((code) => ({
  value: code,
  label: nativeLanguageName(code),
}))

const CONTENT_LANGUAGE_OPTIONS: readonly Choice[] = [
  { value: '', label: 'Same as Default Language' },
  ...LANGUAGE_OPTIONS,
]

/** Language codes render as their own native name, the way the legacy language list did. */
function nativeLanguageName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

/** Writes one setting, refreshes the shared snapshot, and flashes the legacy "Saved" alert. */
function useUpdate(): { update: Update; saved: boolean } {
  const client = useQueryClient()
  const [saved, setSaved] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const mutation = useMutation({
    mutationFn: async ({ key, value }: { key: SettingsKey; value: unknown }) => {
      const bridge = window.popcorn
      if (bridge === undefined) return
      await bridge.invoke('settings:set', { key, value })
    },
    onSuccess: () => {
      setSaved(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setSaved(false), 1500)
      void client.invalidateQueries({ queryKey: ['settings'] })
    },
  })
  return {
    update: (key, value) => mutation.mutate({ key, value }),
    saved,
  }
}

function Checkbox({
  settingKey,
  label,
  update,
  id,
  labelId,
}: {
  settingKey: SettingsKey
  label: string
  update: Update
  id?: string
  labelId?: string
}) {
  const { t } = useTranslation()
  const settings = useSettings().data
  const inputId = id ?? settingKey
  return (
    <>
      <input
        className="settings-checkbox"
        id={inputId}
        name={settingKey}
        type="checkbox"
        checked={settings?.[settingKey] === true}
        onChange={(event) => update(settingKey, event.target.checked)}
      />
      <label className="settings-label" id={labelId} htmlFor={inputId}>
        {t(label)}
      </label>
    </>
  )
}

/** The legacy select plus its arrow, without the label block. */
function Select({
  settingKey,
  options,
  update,
  numeric,
  label,
}: {
  settingKey: SettingsKey
  options: readonly Choice[]
  update: Update
  numeric?: boolean
  label?: string
}) {
  const { t } = useTranslation()
  const settings = useSettings().data
  const current = settings?.[settingKey]
  return (
    <>
      <select
        id={settingKey}
        name={settingKey}
        aria-label={label === undefined ? undefined : t(label)}
        value={typeof current === 'string' || typeof current === 'number' ? String(current) : ''}
        onChange={(event) =>
          update(settingKey, numeric === true ? Number(event.target.value) : event.target.value)
        }
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.label)}
          </option>
        ))}
      </select>
      <div className="dropdown-arrow" />
    </>
  )
}

function Dropdown({
  settingKey,
  label,
  options,
  update,
  className,
  numeric,
}: {
  settingKey: SettingsKey
  label: string
  options: readonly Choice[]
  update: Update
  className?: string
  numeric?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className={className === undefined ? 'dropdown' : `dropdown ${className}`}>
      <p>{t(label)}</p>
      <Select
        settingKey={settingKey}
        options={options}
        update={update}
        numeric={numeric === true}
        label={label}
      />
    </div>
  )
}

function TextField({
  settingKey,
  label,
  update,
  size,
  readOnly,
  placeholder,
}: {
  settingKey: SettingsKey
  label?: string
  update?: Update
  size?: number
  readOnly?: boolean
  placeholder?: string
}) {
  const { t } = useTranslation()
  const settings = useSettings().data
  const current = settings?.[settingKey]
  return (
    <>
      {label === undefined ? null : <p>{t(label)}</p>}
      <input
        id={settingKey}
        type="text"
        name={settingKey}
        size={size}
        aria-label={label === undefined ? undefined : t(label)}
        readOnly={readOnly}
        placeholder={placeholder === undefined ? undefined : t(placeholder)}
        value={typeof current === 'string' ? current : ''}
        onChange={
          update === undefined ? undefined : (event) => update(settingKey, event.target.value)
        }
      />
    </>
  )
}

function NumberField({
  settingKey,
  label,
  update,
  min,
  max,
}: {
  settingKey: SettingsKey
  label?: string
  update: Update
  min?: number
  max?: number
}) {
  const { t } = useTranslation()
  const settings = useSettings().data
  const current = settings?.[settingKey]
  return (
    <>
      {label === undefined ? null : <p>{t(label)}</p>}
      <input
        id={settingKey}
        type="number"
        name={settingKey}
        min={min}
        max={max}
        aria-label={label === undefined ? undefined : t(label)}
        value={typeof current === 'number' ? current : 0}
        onChange={(event) => update(settingKey, Number(event.target.value))}
      />
    </>
  )
}

/** The legacy folder button that opens a directory in the OS file manager. */
function OpenFolder({
  target,
  label,
}: {
  target: 'cache' | 'downloads' | 'database'
  label: string
}) {
  const icons = {
    cache: 'fa fa-box-archive open-tmp-folder',
    downloads: 'fa fa-box-archive open-downloads-folder',
    database: 'fa fa-database open-database-folder',
  } as const
  return (
    <button
      type="button"
      className={`open-folder ${icons[target]}`}
      aria-label={label}
      title={label}
      onClick={() => void window.popcorn?.invoke('files:openDirectory', { target })}
    />
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id}>
      <div className="title">{title}</div>
      <div className="content">{children}</div>
    </section>
  )
}

/** Port of the legacy settings container: left category column, one row per control. */
export function SettingsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { update, saved } = useUpdate()
  const settings = useSettings().data

  const seedbox = settings?.activateSeedbox === true
  const startScreens = START_SCREENS.filter((screen) => {
    switch (screen) {
      case 'Movies':
        return settings?.moviesTabEnable === true
      case 'TV Series':
        return settings?.seriesTabEnable === true
      case 'Anime':
        return settings?.animeTabEnable === true
      case 'Favorites':
        return settings?.favoritesTabEnable === true
      case 'Watched':
        return settings?.watchedTabEnable === true
      default:
        return true
    }
  }).map((screen) => ({ value: screen, label: screen }))

  const downloaded = settings?.totalDownloaded ?? 0
  const uploaded = settings?.totalUploaded ?? 0
  const ratio = downloaded > 0 ? (uploaded / downloaded).toFixed(2) : t('None')

  return (
    <div className="settings-container-contain">
      <div className="settings-container">
        <button
          type="button"
          className="fa fa-times close-icon"
          aria-label={t('Close')}
          onClick={() => navigate(-1)}
        />
        {saved ? (
          <div className="success_alert">
            {t('Saved')}&nbsp;
            <span id="checkmark-notify">
              <div id="stem-notify" />
              <div id="kick-notify" />
            </span>
          </div>
        ) : null}

        <Section id="title" title={t('Settings')}>
          <span>
            <button
              type="button"
              className="far fa-keyboard keyboard"
              aria-label={t('Keyboard Shortcuts')}
              title={t('Keyboard Shortcuts')}
              onClick={() => navigate('/keyboard')}
            />
            <button
              type="button"
              className="fa fa-info-circle about"
              aria-label={t('About')}
              title={t('About')}
              onClick={() => navigate('/about')}
            />
            <a
              className="fa fa-question-circle help"
              href={settings?.issuesUrl}
              target="_blank"
              rel="noreferrer"
              title={t('FAQ')}
            >
              <span className="sr-only">{t('FAQ')}</span>
            </a>
          </span>
        </Section>

        <Section id="user-interface" title={t('User Interface')}>
          <span>
            <Dropdown
              settingKey="theme"
              label="Theme"
              className="pct-theme"
              options={themes.map((theme) => ({
                value: theme,
                label: theme.replace(/_theme$/, '').replace(/_/g, ' '),
              }))}
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="startScreen"
              label="Start Screen"
              className="start-screen"
              options={startScreens}
              update={update}
            />
          </span>
          <span className="settings-tabs">
            <p>{t('Tabs')}</p>
            <Checkbox settingKey="moviesTabEnable" label="Movies" update={update} />
            <Checkbox settingKey="seriesTabEnable" label="Series" update={update} />
            <Checkbox settingKey="animeTabEnable" label="Anime" update={update} />
            <Checkbox settingKey="favoritesTabEnable" label="Favorites" update={update} />
            <Checkbox settingKey="watchedTabEnable" label="Watched" update={update} />
          </span>
          <span>
            <Checkbox
              settingKey="coversShowRating"
              label="Show rating over covers"
              update={update}
            />
          </span>
          <span>
            <Checkbox
              settingKey="alwaysShowBookmarks"
              label="Always show bookmark over covers"
              update={update}
            />
          </span>
          {seedbox ? (
            <span>
              <Checkbox
                settingKey="showSeedboxOnDlInit"
                label="Show the Seedbox when a new download is added"
                update={update}
              />
            </span>
          ) : null}
          <span>
            <Checkbox
              settingKey="expandedSearch"
              label="Search field always expanded"
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="defaultFilters"
              label="Default Filters"
              className="defaultFilters"
              options={DEFAULT_FILTERS}
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="watchedCovers"
              label="Watched Items"
              className="watchedCovers"
              options={WATCHED_COVERS}
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="tv_detail_jump_to"
              label="Series detail opens to"
              className="tv_detail_jump_to"
              options={TV_DETAIL_JUMP}
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="postersWidth"
              label="Poster Size"
              className="poster_size"
              options={POSTER_SIZES}
              numeric
              update={update}
            />
          </span>
          <span>
            <NumberField
              settingKey="bigPicture"
              label="UI Scaling"
              min={25}
              max={400}
              update={update}
            />
            <em>&nbsp;%&nbsp;&nbsp;&nbsp;25% - 400%</em>
          </span>
          <span>
            <div className="dropdown UITransparency">
              <p>{t('UI Transparency')}</p>
              <label htmlFor="moviesUITransparency">{t('Movies')}</label>
              <Select
                settingKey="moviesUITransparency"
                options={MOVIE_TRANSPARENCY}
                update={update}
              />
              <label htmlFor="seriesUITransparency">{t('Series')}</label>
              <Select
                settingKey="seriesUITransparency"
                options={SERIES_TRANSPARENCY}
                update={update}
              />
            </div>
          </span>
          <span>
            <Checkbox settingKey="nativeWindowFrame" label="Native window frame" update={update} />
          </span>
          <span>
            <Checkbox settingKey="alwaysOnTop" label="Always On Top" update={update} />
          </span>
          <span>
            <Checkbox settingKey="minimizeToTray" label="Minimize to Tray" update={update} />
          </span>
          <span>
            <Checkbox settingKey="events" label="Celebrate various events" update={update} />
          </span>
        </Section>

        <Section id="localisation" title={t('Language')}>
          <span>
            <Dropdown
              settingKey="language"
              label="Default Language"
              className="subtitles-language"
              options={LANGUAGE_OPTIONS}
              update={(key, value) => {
                update(key, value)
                if (typeof value === 'string' && value !== '') void changeLanguage(value)
              }}
            />
          </span>
          <span>
            <Dropdown
              settingKey="contentLanguage"
              label="Default Content Language"
              className="subtitles-language"
              options={CONTENT_LANGUAGE_OPTIONS}
              update={update}
            />
            <Checkbox
              settingKey="contentLangOnly"
              label="Only show content available in this language"
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="translateTitle"
              label="Title translation"
              className="translateTitle"
              options={TITLE_TRANSLATION}
              update={update}
            />
          </span>
          <span>
            <Checkbox
              settingKey="translateEpisodes"
              label="Translate Episode Titles"
              update={update}
            />
          </span>
          <span>
            <Checkbox settingKey="translateSynopsis" label="Translate Synopsis" update={update} />
          </span>
          <span>
            <Checkbox settingKey="translatePosters" label="Translate Posters" update={update} />
          </span>
          <span id="translation_info">
            <em>
              *{' '}
              {t(
                'Translations depend on availability. Some options also might not be supported by all API servers',
              )}
            </em>
          </span>
        </Section>

        <Section id="subtitles" title={t('Subtitles')}>
          <span>
            <Dropdown
              settingKey="subtitle_language"
              label="Default Subtitle"
              className="subtitles-language-default"
              options={[{ value: 'none', label: 'Disabled' }, ...LANGUAGE_OPTIONS]}
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="subtitle_font"
              label="Font"
              className="subtitles-font"
              options={SUBTITLE_FONTS}
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="subtitle_decoration"
              label="Decoration"
              className="subtitles-decoration"
              options={SUBTITLE_DECORATION}
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="subtitle_size"
              label="Size"
              className="subtitles-size"
              options={SUBTITLE_SIZES}
              update={update}
            />
          </span>
          <span>
            <div className="subtitles-custom">
              <p>{t('Color')}</p>
              <input
                className="colorsub"
                id="subtitles_color"
                type="color"
                name="subtitle_color"
                list="subs_colors"
                value={settings?.subtitle_color ?? '#ffffff'}
                onChange={(event) => update('subtitle_color', event.target.value)}
              />
              <datalist id="subs_colors">
                <option>#ffffff</option>
                <option>#ffff00</option>
                <option>#ff0000</option>
                <option>#ff00ff</option>
                <option>#00ffff</option>
                <option>#00ff00</option>
              </datalist>
            </div>
          </span>
          <span>
            <Checkbox settingKey="subtitles_bold" label="Bold" update={update} id="subsbold" />
          </span>
          <span>
            <Checkbox
              settingKey="multipleExtSubtitles"
              label="Show all available subtitles for default language in flag menu"
              update={update}
            />
          </span>
        </Section>

        <Section id="playback" title={t('Playback')}>
          <span>
            <Checkbox
              settingKey="alwaysFullscreen"
              label="Always start playing in fullscreen"
              update={update}
            />
          </span>
          <span>
            <Checkbox
              settingKey="playNextEpisodeAuto"
              label="Play next episode automatically"
              update={update}
            />
            {settings?.playNextEpisodeAuto === true ? (
              <>
                <NumberField
                  settingKey="preloadNextEpisodeTime"
                  min={0}
                  max={99999}
                  update={update}
                />
                <em>
                  {t('minute(s) remaining before preloading next episode')},&nbsp;&nbsp;&nbsp;
                  {t('0 = Disable preloading')}
                </em>
              </>
            ) : null}
          </span>
          <span>
            <Checkbox
              settingKey="audioPassthrough"
              label="Allow Audio Passthrough"
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="movies_default_quality"
              label="Movies default quality"
              options={DEFAULT_QUALITIES}
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="shows_default_quality"
              label="Series default quality"
              options={DEFAULT_QUALITIES}
              update={update}
            />
          </span>
          <span>
            <Dropdown
              settingKey="chosenPlayer"
              label="Player"
              options={CHOSEN_PLAYERS}
              update={update}
            />
          </span>
        </Section>

        <Section id="features" title={t('Features')}>
          <span>
            <Checkbox settingKey="activateWatchlist" label="Watchlist" update={update} />
          </span>
          <span>
            <Checkbox
              settingKey="activateTorrentCollection"
              label="Torrent Collection"
              update={update}
            />
          </span>
          <span>
            <Checkbox settingKey="activateSeedbox" label="Seedbox" update={update} />
          </span>
          <span>
            <Checkbox settingKey="activateTempf" label="Cache Folder Button" update={update} />
          </span>
        </Section>

        <Section id="remote-control" title={t('Remote Control')}>
          <span>
            <Checkbox settingKey="httpApiEnabled" label="Enable remote control" update={update} />
          </span>
          {settings?.httpApiEnabled === true ? (
            <>
              <span>
                <NumberField settingKey="httpApiPort" label="HTTP API Port" update={update} />
              </span>
              <span>
                <TextField settingKey="httpApiUsername" label="HTTP API Username" update={update} />
              </span>
              <span>
                <TextField settingKey="httpApiPassword" label="HTTP API Password" update={update} />
              </span>
            </>
          ) : null}
        </Section>

        <Section id="apiserver" title={t('API Server(s)')}>
          <span>
            <TextField
              settingKey="customMoviesServer"
              label="Movies API Server(s)"
              size={61}
              update={update}
            />
          </span>
          <span>
            <TextField
              settingKey="customSeriesServer"
              label="Series API Server(s)"
              size={61}
              update={update}
            />
          </span>
          <span>
            <TextField
              settingKey="customAnimeServer"
              label="Anime API Server(s)"
              size={61}
              update={update}
            />
          </span>
          <span id="apiserver_info">
            <em>
              *{' '}
              {t(
                'You can add multiple API Servers separated with a , from which it will select randomly (*for load balancing) until it finds the first available',
              )}
            </em>
          </span>
        </Section>

        <Section id="connection" title={t('Connection')}>
          {seedbox ? (
            <span>
              <NumberField
                settingKey="maxActiveTorrents"
                label="Active Torrents Limit"
                update={update}
              />
            </span>
          ) : null}
          <span>
            <NumberField settingKey="connectionLimit" label="Connection Limit" update={update} />
          </span>
          <span>
            <NumberField
              settingKey="maxUdpReqLimit"
              label="DHT UDP Requests Limit"
              update={update}
            />
          </span>
          <span>
            <p>{t('Max. Down / Up Speed')}</p>
            <TextField settingKey="downloadLimit" placeholder="Unlimited" update={update} />
            <TextField settingKey="uploadLimit" placeholder="Unlimited" update={update} />
            <Select settingKey="maxLimitMult" options={LIMIT_MULTIPLIERS} numeric update={update} />
          </span>
          <span id="overallRatio">
            <p>{t('Overall Ratio')}</p>
            <input type="text" name="overallRatio" size={20} readOnly value={ratio} />
            <em>
              {formatSize(downloaded)}
              <i className="fa fa-arrow-circle-down" />
              {formatSize(uploaded)}
              <i className="fa fa-arrow-circle-up" />
            </em>
          </span>
          <span>
            <NumberField settingKey="streamPort" label="Port to stream on" update={update} />
            <em>&nbsp;&nbsp;&nbsp;{t('0 = Random')}</em>
          </span>
          {seedbox &&
          (settings?.deleteTmpOnClose !== true || settings?.separateDownloadsDir === true) ? (
            <span>
              <Checkbox
                settingKey="continueSeedingOnStart"
                label="Resume seeding after restarting the app?"
                update={update}
              />
            </span>
          ) : null}
          <span>
            <Checkbox
              settingKey="protocolEncryption"
              label="Enable Protocol Encryption"
              labelId="protocolEnc"
              update={update}
            />
            <em>
              <i className="fas fa-exclamation-circle">&nbsp;&nbsp;</i>
              {t(
                'Allows connecting to peers that use PE/MSE. Will in most cases increase the number of connectable peers but might also result in increased CPU usage',
              )}
            </em>
          </span>
          <span>
            <TextField
              settingKey="proxyServer"
              label="Proxy Server"
              size={50}
              placeholder="host:port (127.0.0.1:9050 or 127.0.0.1:4447)"
              update={update}
            />
          </span>
        </Section>

        <Section id="cache" title={t('Cache')}>
          <span>
            <TextField settingKey="tmpLocation" label="Cache Directory" size={61} readOnly />
            <OpenFolder target="cache" label={t('Open Cache Directory')} />
          </span>
          <span>
            <Checkbox
              settingKey="deleteTmpOnClose"
              label="Clear Cache Folder after closing the app?"
              update={update}
            />
          </span>
          {seedbox ? (
            <span>
              <Dropdown
                settingKey="delSeedboxCache"
                label="Delete related cache when removing from Seedbox"
                className="del-seedbox-cache"
                options={DEL_SEEDBOX_CACHE}
                update={update}
              />
            </span>
          ) : null}
          {seedbox ? (
            <span>
              <Checkbox
                settingKey="separateDownloadsDir"
                label="Separate directory for Downloads"
                labelId="downloadsDir"
                update={update}
              />
              <em>
                <i className="fas fa-exclamation-circle">&nbsp;&nbsp;</i>
                {t(
                  'Enabling will prevent the sharing of cache between the Watch Now and Download functions',
                )}
              </em>
            </span>
          ) : null}
          {seedbox && settings?.separateDownloadsDir === true ? (
            <span>
              <TextField
                settingKey="downloadsLocation"
                label="Downloads Directory"
                size={61}
                readOnly
              />
              <OpenFolder target="downloads" label={t('Open Downloads Directory')} />
            </span>
          ) : null}
        </Section>

        <Section id="database" title={t('Database')}>
          <span>
            <TextField
              settingKey="databaseLocation"
              label="Database Directory"
              size={61}
              readOnly
            />
            <OpenFolder target="database" label={t('Open Database Directory')} />
          </span>
        </Section>
      </div>
    </div>
  )
}
