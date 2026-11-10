import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useMatch } from 'react-router'
import type { Filters } from '../../../shared'
import type { SettingsKey } from '../../../shared/settings'
import { popcorn } from '../bridge'
import type { ProviderFilterOptions } from '../browse'
import { useSetting } from '../settings'

interface Tab {
  readonly path: string
  readonly label: string
  readonly setting: SettingsKey
  /** `filter_bar.js:setActive` matched on these legacy classes. */
  readonly className?: string
  readonly id?: string
}

export const tabs: ReadonlyArray<Tab> = [
  { path: '/movies', label: 'Movies', setting: 'moviesTabEnable', className: 'movieTabShow' },
  { path: '/series', label: 'Series', setting: 'seriesTabEnable', className: 'tvshowTabShow' },
  { path: '/anime', label: 'Anime', setting: 'animeTabEnable', className: 'animeTabShow' },
  {
    path: '/favorites',
    label: 'Favorites',
    setting: 'favoritesTabEnable',
    id: 'filterbar-favorites',
  },
  { path: '/watched', label: 'Watched', setting: 'watchedTabEnable', id: 'filterbar-watched' },
]

function SourceTab({ tab }: { tab: Tab }) {
  const { t } = useTranslation()
  const enabled = useSetting(tab.setting).data
  // The legacy stylesheet underlines `li.source.active`, not the anchor inside it.
  const active = useMatch(tab.path) !== null
  if (enabled === false) return null
  return (
    <li
      {...(tab.id === undefined ? {} : { id: tab.id })}
      className={`source providerinfo${tab.className === undefined ? '' : ` ${tab.className}`}${active ? ' active' : ''}`}
    >
      <NavLink to={tab.path}>{t(tab.label)}</NavLink>
    </li>
  )
}

interface DropdownProps {
  readonly className: string
  readonly label: string
  readonly value: string
  readonly entries: Record<string, string>
  readonly onSelect: (value: string) => void
}

/** One `li.dropdown.filter` exactly as the legacy filter bar renders it. */
function FilterDropdown({ className, label, value, entries, onSelect }: DropdownProps) {
  const [open, setOpen] = useState(false)
  return (
    <li className={`dropdown filter ${className}${open ? ' open' : ''}`}>
      <button
        type="button"
        className="dropdown-toggle"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
        <span className="value">{entries[value] ?? value}</span>
        <ChevronDown className="caret" size={12} aria-hidden />
      </button>
      <ul className="dropdown-menu">
        {Object.entries(entries).map(([key, text]) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => {
                onSelect(key)
                setOpen(false)
              }}
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </li>
  )
}

interface FilterBarProps {
  readonly filters?: Filters
  readonly onChange?: (filters: Filters) => void
  readonly options?: ProviderFilterOptions | undefined
  /** YTS adds quality and rating filters on top of the common set. */
  readonly supportsQualityFilters?: boolean
}

/** The legacy filter bar: source tabs on the left, filters in the middle, search and icons right. */
export function FilterBar({
  filters,
  onChange,
  options,
  supportsQualityFilters = false,
}: FilterBarProps) {
  const { t } = useTranslation()
  const genres = options?.genres ?? { All: t('All') }
  const sorters = options?.sorters ?? {}
  const cacheButton = useSetting('activateTempf').data ?? true
  const expandedSearch = useSetting('expandedSearch').data ?? false
  const searchInput = useRef<HTMLInputElement>(null)
  const [searchText, setSearchText] = useState(filters?.keywords ?? '')

  // Another view can clear the search (e.g. switching tabs); keep the box in step.
  useEffect(() => {
    setSearchText(filters?.keywords ?? '')
  }, [filters?.keywords])

  return (
    <div className="filter-bar">
      <ul className="nav nav-hor left">
        {tabs.map((tab) => (
          <SourceTab key={tab.path} tab={tab} />
        ))}
      </ul>

      {filters !== undefined && onChange !== undefined ? (
        <ul id="nav-filters" className="nav nav-hor filters">
          {supportsQualityFilters && options?.types !== undefined ? (
            <FilterDropdown
              className="types"
              label={t('Type')}
              value={filters.type ?? 'All'}
              entries={options.types}
              onSelect={(type) => onChange({ ...filters, type })}
            />
          ) : null}
          {supportsQualityFilters && options?.ratings !== undefined ? (
            <FilterDropdown
              className="ratings"
              label={t('Rating')}
              value={filters.rating ?? 'All'}
              entries={options.ratings}
              onSelect={(rating) => onChange({ ...filters, rating })}
            />
          ) : null}
          <FilterDropdown
            className="genres"
            label={t('Genre')}
            value={filters.genre ?? 'All'}
            entries={genres}
            onSelect={(genre) => onChange({ ...filters, genre })}
          />
          {Object.keys(sorters).length > 0 ? (
            <FilterDropdown
              className="sorters"
              label={t('Sort by')}
              value={filters.sorter ?? Object.keys(sorters)[0] ?? ''}
              entries={sorters}
              onSelect={(sorter) => onChange({ ...filters, sorter })}
            />
          ) : null}
        </ul>
      ) : null}

      <ul className="nav nav-hor right">
        <li>
          <div className="right search" onClick={() => searchInput.current?.focus()}>
            <form
              className={searchText === '' ? undefined : 'edited'}
              onSubmit={(event) => {
                event.preventDefault()
                // `filter_bar.js:search` applied the keywords on submit and reset the genre.
                onChange?.({ ...(filters ?? {}), keywords: searchText, genre: '' })
                searchInput.current?.blur()
              }}
            >
              <input
                id="searchbox"
                ref={searchInput}
                className={expandedSearch ? 'expanded' : undefined}
                type="text"
                placeholder={t('Search')}
                autoComplete="off"
                aria-label={t('Search')}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                // `filter_bar.js` also focused the input on hover.
                onMouseEnter={() => searchInput.current?.focus()}
              />
              {/* `filter-bar.tpl` uses an FA div here; it only shows once the form is `edited`. */}
              <div
                className="clear fa fa-times"
                onClick={() => {
                  setSearchText('')
                  onChange?.({ ...(filters ?? {}), keywords: '', genre: '' })
                  searchInput.current?.focus()
                }}
              />
            </form>
          </div>
        </li>
        <li>
          <NavLink
            id="filterbar-torrent-collection"
            to="/torrent-collection"
            aria-label={t('Torrent Collection')}
            title={t('Torrent Collection')}
          >
            <i className="fa fa-bars-staggered torrent-collection" />
          </NavLink>
        </li>
        <li>
          <NavLink
            id="filterbar-seedbox"
            to="/seedbox"
            aria-label={t('Seedbox')}
            title={t('Seedbox')}
          >
            <i className="fa fa-download about" />
          </NavLink>
        </li>
        {cacheButton ? (
          <li>
            <button
              type="button"
              id="filterbar-tempf"
              aria-label={t('Cache Folder')}
              title={t('Cache Folder')}
              onClick={() => void popcorn().invoke('files:openDirectory', { target: 'cache' })}
            >
              <i className="fa fa-box-archive about" />
            </button>
          </li>
        ) : null}
        <li>
          <NavLink
            id="filterbar-settings"
            to="/settings"
            aria-label={t('Settings')}
            title={t('Settings')}
          >
            <i className="fa fa-cog settings" />
          </NavLink>
        </li>
      </ul>
    </div>
  )
}
