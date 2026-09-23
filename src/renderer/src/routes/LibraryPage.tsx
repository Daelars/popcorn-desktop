import { useTranslation } from 'react-i18next'
import { FilterBar } from '../components/FilterBar'
import { PosterGrid } from '../components/PosterGrid'
import { useFavoriteItems, useLibraryState, useToggleBookmark, useWatchedItems } from '../library'
import { useSetting } from '../settings'

interface LibraryPageProps {
  readonly kind: 'favorites' | 'watched'
  readonly title: string
}

/** Favorites and Watched, hydrated from the media cache the browse path fills. */
export function LibraryPage({ kind, title }: LibraryPageProps) {
  const { t } = useTranslation()
  const favorites = useFavoriteItems()
  const watched = useWatchedItems()
  const query = kind === 'favorites' ? favorites : watched
  const library = useLibraryState()
  const toggleBookmark = useToggleBookmark()
  const posterWidth = useSetting('postersWidth').data ?? 134
  const sizeRatio = useSetting('postersSizeRatio').data ?? 196 / 134
  const showRating = useSetting('coversShowRating').data ?? true

  if (query.isPending) {
    return <p className="grid place-items-center text-Text3">{t('Loading...')}</p>
  }
  if (query.isError) {
    return (
      <p role="alert" className="grid place-items-center text-TextError">
        {String((query.error as Error).message)}
      </p>
    )
  }

  const items = query.data ?? []

  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <FilterBar />
      {items.length === 0 ? (
        <section className="grid place-items-center gap-1">
          <h2 className="text-lg text-Text3">{t(title)}</h2>
          <p className="text-xs text-Text4">{t('No results')}</p>
        </section>
      ) : (
        <PosterGrid
          items={items}
          posterWidth={posterWidth}
          sizeRatio={sizeRatio}
          showRating={showRating}
          library={library.data ?? new Map()}
          hasMore={false}
          isLoadingMore={false}
          onLoadMore={() => undefined}
          onToggleBookmark={(item) => toggleBookmark.mutate(item)}
        />
      )}
    </div>
  )
}
