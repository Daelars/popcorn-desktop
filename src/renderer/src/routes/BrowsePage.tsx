import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Search, Server } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { Filters } from '../../../shared'
import { popcorn } from '../bridge'
import { useBrowse, useProviderFilters, useProviders } from '../browse'
import { FilterBar, tabs } from '../components/FilterBar'
import { POSTER_WIDTH_MAX, POSTER_WIDTH_MIN, PosterGrid } from '../components/PosterGrid'
import { useLibraryState, useToggleBookmark, useToggleWatchedMovie } from '../library'
import { useSetting, useSettings } from '../settings'

interface BrowsePageProps {
  readonly title: string
  readonly type: 'movie' | 'tvshow' | 'anime'
}

/** One keyboard step for Ctrl +/- and Alt+wheel poster resize. */
const POSTER_RESIZE_STEP = 10

/** The browse surface: filters, provider selection, infinite query, virtualised grid. */
export function BrowsePage({ title, type }: BrowsePageProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<Filters>({ order: -1 })
  const providers = useProviders()
  const provider = providers.data?.find((candidate) => candidate.type === type)
  // The tab, not the provider name, drives browse; the main process merges its providers.
  const providerFilters = useProviderFilters(type)
  const posterWidth = useSetting('postersWidth').data ?? 134
  const sizeRatio = useSetting('postersSizeRatio').data ?? 196 / 134
  const showRating = useSetting('coversShowRating').data ?? true
  const settings = useSettings()
  const library = useLibraryState()
  const toggleBookmark = useToggleBookmark()
  const toggleWatched = useToggleWatchedMovie()
  const browse = useBrowse(type, filters)
  // Stable identity: the grid rebuilds its intersection observer when this changes.
  const loadMore = useCallback(() => void browse.fetchNextPage(), [browse.fetchNextPage])

  // `list.js:increasePoster/decreasePoster`: resize stays within the poster width bounds.
  const resizePoster = useCallback(
    (direction: 1 | -1) => {
      const next = Math.min(
        POSTER_WIDTH_MAX,
        Math.max(POSTER_WIDTH_MIN, posterWidth + direction * POSTER_RESIZE_STEP),
      )
      if (next === posterWidth) return
      void popcorn()
        .invoke('settings:set', { key: 'postersWidth', value: next })
        .then(() => queryClient.invalidateQueries({ queryKey: ['settings'] }))
    },
    [posterWidth, queryClient],
  )

  // The browse keys `list.js:initKeyboardShortcuts` left outside the grid: tab switching,
  // favorites, about and focusing the search box.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      const combo = event.ctrlKey || event.metaKey
      if (combo && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault()
        document.getElementById('searchbox')?.focus()
        return
      }
      if (combo && /^[1-5]$/.test(event.key)) {
        const enabled = tabs.filter((tab) => settings.data?.[tab.setting] !== false)
        const tab = enabled[Number(event.key) - 1]
        if (tab !== undefined) {
          event.preventDefault()
          navigate(tab.path)
        }
        return
      }
      if (combo || event.altKey) return
      if (event.key === 'b' || event.key === '`') {
        event.preventDefault()
        navigate('/favorites')
        return
      }
      if (event.key === 'i') {
        event.preventDefault()
        navigate('/about')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, settings.data])

  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <FilterBar filters={filters} onChange={setFilters} options={providerFilters.data} />
      {providers.isPending || provider === undefined ? (
        <section className="grid place-items-center gap-1">
          <h2 className="text-lg text-Text3">{t(title)}</h2>
          <p className="text-xs text-Text4">{t('provider unavailable')}</p>
        </section>
      ) : browse.isPending ? (
        <p className="grid place-items-center text-Text3">{t('Loading...')}</p>
      ) : browse.isError ? (
        <div id="movie-error">
          <h2 className="error">{String((browse.error as Error).message)}</h2>
          <button
            type="button"
            className="button retry-button"
            onClick={() => void browse.refetch()}
          >
            <div className="button-text">
              <RefreshCw size={14} aria-hidden />
              &nbsp;&nbsp;{t('Retry')}
            </div>
          </button>
          <div className="button change-api">
            <div className="button-text">
              <Server size={14} aria-hidden />
              &nbsp;&nbsp;{t('Change API Server')}
            </div>
          </div>
          <div className="button online-search">
            <div className="button-text">
              <Search size={14} aria-hidden />
              &nbsp;&nbsp;{t('Search on {{0}}', { 0: t('Torrent Collection') })}
            </div>
          </div>
        </div>
      ) : (
        <PosterGrid
          items={(browse.data?.pages ?? []).flatMap((page) => page.results)}
          posterWidth={posterWidth}
          sizeRatio={sizeRatio}
          showRating={showRating}
          library={library.data ?? new Map()}
          hasMore={browse.hasNextPage}
          isLoadingMore={browse.isFetchingNextPage}
          onLoadMore={loadMore}
          onResizePoster={resizePoster}
          onToggleBookmark={(item) => toggleBookmark.mutate(item)}
          onToggleWatched={(item, watched) =>
            toggleWatched.mutate({ imdbId: item.imdb_id, watched })
          }
        />
      )}
    </div>
  )
}
