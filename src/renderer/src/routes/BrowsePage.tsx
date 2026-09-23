import { RefreshCw, Search, Server } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Filters } from '../../../shared'
import { useBrowse, useProviderFilters, useProviders } from '../browse'
import { FilterBar } from '../components/FilterBar'
import { PosterGrid } from '../components/PosterGrid'
import { useLibraryState } from '../library'
import { useSetting } from '../settings'

interface BrowsePageProps {
  readonly title: string
  readonly type: 'movie' | 'tvshow' | 'anime'
}

/** The browse surface: filters, provider selection, infinite query, virtualised grid. */
export function BrowsePage({ title, type }: BrowsePageProps) {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<Filters>({ order: -1 })
  const providers = useProviders()
  const provider = providers.data?.find((candidate) => candidate.type === type)
  const providerFilters = useProviderFilters(provider?.name)
  const posterWidth = useSetting('postersWidth').data ?? 134
  const sizeRatio = useSetting('postersSizeRatio').data ?? 196 / 134
  const showRating = useSetting('coversShowRating').data ?? true
  const library = useLibraryState()
  const browse = useBrowse(provider?.name ?? '', filters)
  // Stable identity: the grid rebuilds its intersection observer when this changes.
  const loadMore = useCallback(() => void browse.fetchNextPage(), [browse.fetchNextPage])

  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        options={providerFilters.data}
        supportsQualityFilters={provider?.name === 'YTSApi'}
      />
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
        />
      )}
    </div>
  )
}
