import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { FetchResult, Filters, TabFilters } from '../../shared'
import { popcorn } from './bridge'
import { browseQueryKey } from './query'

export type BrowseItem = FetchResult['results'][number]

/** Filter options and capabilities the filter bar reads. */
export type ProviderFilterOptions = TabFilters

/** Providers the main process has registered, straight from the typed registry. */
export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: () => popcorn().invoke('browse:providers', {}),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** The merged filter options and capabilities for a tab, fetched once. */
export function useProviderFilters(tab: string | undefined) {
  return useQuery({
    queryKey: ['tab-filters', tab ?? ''],
    enabled: tab !== undefined,
    queryFn: async (): Promise<TabFilters> => {
      if (tab === undefined) throw new Error('no tab selected')
      return popcorn().invoke('browse:filters', { tab })
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * Infinite browse over a tab. The main process merges the tab's providers by `imdb_id`, and
 * the response is validated against the shared `FetchResult` schema at the bridge.
 */
export function useBrowse(tab: string, filters: Filters) {
  return useInfiniteQuery({
    queryKey: browseQueryKey(tab, filters),
    initialPageParam: filters.page ?? 1,
    enabled: tab !== '',
    queryFn: ({ pageParam }) =>
      popcorn().invoke('browse:fetch', { tab, filters: { ...filters, page: pageParam } }),
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.hasMore ? lastPageParam + 1 : undefined,
  })
}
