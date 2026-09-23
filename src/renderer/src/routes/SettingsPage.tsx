import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Fragment, type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { SettingsKey } from '../../../shared/settings'
import {
  type CheckboxRow,
  LIMIT_MULTIPLIERS,
  MOVIE_TRANSPARENCY,
  type NumberRow,
  type OptionSource,
  SERIES_TRANSPARENCY,
  SETTINGS_LAYOUT,
  type SelectRow,
  type SettingOption,
  type SettingRow,
  TAB_CHECKBOXES,
  type TextRow,
} from '../../../shared/settings-layout'
import { SETTINGS_METADATA } from '../../../shared/settings-metadata'
import { popcorn } from '../bridge'
import { changeLanguage, languages } from '../i18n'
import { notify } from '../notify'
import { useSettings } from '../settings'
import { themes } from '../theme'

type Update = (key: SettingsKey, value: unknown) => void

const LANGUAGE_OPTIONS: ReadonlyArray<SettingOption> = languages.map((code) => ({
  value: code,
  label: nativeLanguageName(code),
}))

const CONTENT_LANGUAGE_OPTIONS: ReadonlyArray<SettingOption> = [
  { value: '', label: 'Same as Default Language' },
  ...LANGUAGE_OPTIONS,
]

const SUBTITLE_LANGUAGE_OPTIONS: ReadonlyArray<SettingOption> = [
  { value: 'none', label: 'Disabled' },
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
      const bridge = popcorn()
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

/** The label comes from the metadata; a row may override it for a legacy wording. */
function labelFor(key: SettingsKey, override: string | undefined): string {
  return override ?? SETTINGS_METADATA[key].label
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
  id?: string | undefined
  labelId?: string | undefined
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
  options: readonly SettingOption[]
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
  options: readonly SettingOption[]
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
      onClick={() => void popcorn().invoke('files:openDirectory', { target })}
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

/** A generic `<span>` row: control(s), an optional hint, and the legacy restart note. */
function Row({
  hint,
  restart,
  children,
}: {
  hint?: string | undefined
  restart?: boolean | undefined
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <span>
      {children}
      {hint === undefined ? null : (
        <em>
          <i className="fas fa-exclamation-circle">&nbsp;&nbsp;</i>
          {t(hint)}
        </em>
      )}
      {restart === true ? <em>{t('Please restart your application')}</em> : null}
    </span>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { update, saved } = useUpdate()
  const settings = useSettings().data

  const START_SCREEN_NAMES: Record<string, string> = {
    moviesTabEnable: 'Movies',
    seriesTabEnable: 'TV Series',
    animeTabEnable: 'Anime',
    favoritesTabEnable: 'Favorites',
    watchedTabEnable: 'Watched',
  }
  const startScreens: ReadonlyArray<SettingOption> = [
    ...TAB_CHECKBOXES.filter((tab) => {
      switch (tab.key) {
        case 'moviesTabEnable':
          return settings?.moviesTabEnable === true
        case 'seriesTabEnable':
          return settings?.seriesTabEnable === true
        case 'animeTabEnable':
          return settings?.animeTabEnable === true
        case 'favoritesTabEnable':
          return settings?.favoritesTabEnable === true
        case 'watchedTabEnable':
          return settings?.watchedTabEnable === true
        default:
          return true
      }
    }).map((tab) => {
      const name = START_SCREEN_NAMES[tab.key] ?? tab.key
      return { value: name, label: name }
    }),
    { value: 'Last Open', label: 'Last Open' },
  ]

  const downloaded = settings?.totalDownloaded ?? 0
  const uploaded = settings?.totalUploaded ?? 0
  const ratio = downloaded > 0 ? (uploaded / downloaded).toFixed(2) : t('None')

  const resolveOptions = (source: SelectRow['options']): ReadonlyArray<SettingOption> => {
    if (Array.isArray(source)) return source
    switch (source as OptionSource) {
      case 'themes':
        return themes.map((theme) => ({
          value: theme,
          label: theme.replace(/_theme$/, '').replace(/_/g, ' '),
        }))
      case 'startScreens':
        return startScreens
      case 'languages':
        return LANGUAGE_OPTIONS
      case 'contentLanguages':
        return CONTENT_LANGUAGE_OPTIONS
      default:
        return SUBTITLE_LANGUAGE_OPTIONS
    }
  }

  const renderCheckbox = (row: CheckboxRow) => (
    <Row hint={row.hint} restart={SETTINGS_METADATA[row.key].apply === 'restart'}>
      <Checkbox
        settingKey={row.key}
        label={labelFor(row.key, row.label)}
        labelId={row.labelId}
        update={
          row.notifyRestart === true
            ? (key, value) => {
                update(key, value)
                notify(t('Restart required'))
              }
            : update
        }
      />
    </Row>
  )

  const renderSelect = (row: SelectRow) => {
    const label = labelFor(row.key, row.label)
    return (
      <Row restart={SETTINGS_METADATA[row.key].apply === 'restart'}>
        <Dropdown
          settingKey={row.key}
          label={label}
          options={resolveOptions(row.options)}
          update={
            row.onChange === 'language'
              ? (key, value) => {
                  update(key, value)
                  if (typeof value === 'string' && value !== '') void changeLanguage(value)
                }
              : update
          }
          {...(row.className === undefined ? {} : { className: row.className })}
          {...(row.numeric === true ? { numeric: true } : {})}
        />
      </Row>
    )
  }

  const renderText = (row: TextRow) => (
    <Row restart={SETTINGS_METADATA[row.key].apply === 'restart'}>
      <TextField
        settingKey={row.key}
        label={labelFor(row.key, row.label)}
        update={update}
        {...(row.size === undefined ? {} : { size: row.size })}
        {...(row.readOnly === true ? { readOnly: true } : {})}
        {...(row.placeholder === undefined ? {} : { placeholder: row.placeholder })}
      />
      {row.folder === undefined ? null : (
        <OpenFolder
          target={row.folder}
          label={t(
            row.folder === 'cache'
              ? 'Open Cache Directory'
              : row.folder === 'downloads'
                ? 'Open Downloads Directory'
                : 'Open Database Directory',
          )}
        />
      )}
    </Row>
  )

  const renderNumber = (row: NumberRow) => (
    <Row restart={SETTINGS_METADATA[row.key].apply === 'restart'}>
      <NumberField
        settingKey={row.key}
        label={labelFor(row.key, row.label)}
        update={update}
        {...(row.min === undefined ? {} : { min: row.min })}
        {...(row.max === undefined ? {} : { max: row.max })}
      />
      {row.hint === 'percent' ? (
        <em>&nbsp;%&nbsp;&nbsp;&nbsp;25% - 400%</em>
      ) : row.hint === undefined ? null : (
        <em>&nbsp;&nbsp;&nbsp;{t(row.hint)}</em>
      )}
    </Row>
  )

  const renderRow = (row: SettingRow) => {
    switch (row.kind) {
      case 'checkbox':
        return renderCheckbox(row)
      case 'select':
        return renderSelect(row)
      case 'text':
        return renderText(row)
      case 'number':
        return renderNumber(row)
      case 'colour':
        return (
          <Row>
            <div className="subtitles-custom">
              <p>{t('Color')}</p>
              <input
                className="coloursub"
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
          </Row>
        )
      case 'tabs':
        return (
          <span className="settings-tabs">
            <p>{t('Tabs')}</p>
            {TAB_CHECKBOXES.map((tab) => (
              <Checkbox
                key={tab.key}
                settingKey={tab.key}
                label={tab.label ?? tab.key}
                update={update}
              />
            ))}
          </span>
        )
      case 'transparency':
        return (
          <Row>
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
          </Row>
        )
      case 'speed':
        return (
          <Row>
            <p>{t('Max. Down / Up Speed')}</p>
            <TextField settingKey="downloadLimit" placeholder="Unlimited" update={update} />
            <TextField settingKey="uploadLimit" placeholder="Unlimited" update={update} />
            <Select settingKey="maxLimitMult" options={LIMIT_MULTIPLIERS} numeric update={update} />
          </Row>
        )
      case 'ratio':
        return (
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
        )
      case 'preload':
        return (
          <Row>
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
          </Row>
        )
      case 'contentLanguage':
        return (
          <Row>
            <Dropdown
              settingKey="contentLanguage"
              label={t('Default Content Language')}
              className="subtitles-language"
              options={CONTENT_LANGUAGE_OPTIONS}
              update={update}
            />
            <Checkbox
              settingKey="contentLangOnly"
              label="Only show content available in this language"
              update={update}
            />
          </Row>
        )
    }
  }

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

        {SETTINGS_LAYOUT.map((section) => {
          const visible = section.rows.filter(
            (row) =>
              !('visibleWhen' in row) || row.visibleWhen === undefined || row.visibleWhen(settings),
          )
          return (
            <Section key={section.id} id={section.id} title={t(section.title)}>
              {visible.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the layout is static
                <Fragment key={index}>{renderRow(row)}</Fragment>
              ))}
              {section.hint === undefined ? null : (
                <span id={section.hintId}>
                  <em>* {t(section.hint)}</em>
                </span>
              )}
            </Section>
          )
        })}
      </div>
    </div>
  )
}
