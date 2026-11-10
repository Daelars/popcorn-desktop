import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BrowseItem } from '../browse'
import { FilterBar } from '../components/FilterBar'
import { PosterGrid } from '../components/PosterGrid'
import {
  defaultLibrarySorter,
  isLibrarySorter,
  type LibrarySorter,
  librarySorterLabels,
  librarySorters,
  sortLibraryItems,
  useFavoriteItems,
  useLibraryState,
  useToggleBookmark,
  useWatchedItems,
} from '../library'
import { notify, notifyAction } from '../notify'
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
  const [sorter, setSorter] = useState<LibrarySorter>(defaultLibrarySorter)

  // The legacy `watched items` sorter groups by the watched state the library map carries.
  const watchedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [imdbId, state] of library.data ?? []) {
      if (state.watched) ids.add(imdbId)
    }
    return ids
  }, [library.data])

  const items = useMemo(
    () => sortLibraryItems(query.data ?? [], sorter, watchedIds),
    [query.data, sorter, watchedIds],
  )

  const onToggleBookmark = (item: BrowseItem) => {
    const wasBookmarked = library.data?.get(item.imdb_id)?.bookmarked ?? false
    toggleBookmark.mutate(item, {
      onSuccess: () => {
        // `item.js:toggleFavorite` offered an Undo action when a bookmark was removed.
        if (!wasBookmarked) return
        notifyAction(`${item.title} (${item.year}) ${t('was removed from bookmarks')}`, [
          {
            label: t('Undo'),
            onClick: () => {
              toggleBookmark.mutate(item)
              notify(t('Bookmark restored'))
            },
          },
        ])
      },
    })
  }

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

  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <FilterBar
        filters={{ sorter, order: -1 }}
        onChange={(next) => {
          if (isLibrarySorter(next.sorter)) setSorter(next.sorter)
        }}
        options={{
          genres: {},
          sorters: Object.fromEntries(
            librarySorters.map((key): [LibrarySorter, string] => [
              key,
              t(librarySorterLabels[key]),
            ]),
          ),
          capabilities: {
            // The library keeps its search box but only offers sorters in this slice.
            search: true,
            // FilterBar gates the sort control on `capabilities.sort`; year and rating are the
            // two library sorters that double as provider sort keys. `sorters` carries the rest.
            sort: ['rating', 'year'],
            quality: false,
            genres: false,
          },
        }}
      />
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
          onToggleBookmark={onToggleBookmark}
        />
      )}
    </div>
  )
}
