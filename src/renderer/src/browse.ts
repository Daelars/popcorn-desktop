import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { FetchResult, Filters, ProviderFilters } from '../../shared'
import { popcorn } from './bridge'
import { browseQueryKey } from './query'

export type BrowseItem = FetchResult['results'][number]

/** Filter options the filter bar reads; the shared `ProviderFilters` schema. */
export type ProviderFilterOptions = ProviderFilters

/** Providers the main process has registered, straight from the typed registry. */
export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: () => popcorn().invoke('browse:providers', {}),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Provider filter options, fetched once per provider. */
export function useProviderFilters(provider: string | undefined) {
  return useQuery({
    queryKey: ['provider-filters', provider ?? ''],
    enabled: provider !== undefined,
    queryFn: async (): Promise<ProviderFilters> => {
      if (provider === undefined) throw new Error('no provider selected')
      return popcorn().invoke('browse:filters', { provider })
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * Infinite browse over the provider IPC channel. The response is validated against the shared
 * `FetchResult` schema at the bridge, so a malformed provider payload fails the query instead
 * of rendering an empty grid.
 */
export function useBrowse(provider: string, filters: Filters) {
  return useInfiniteQuery({
    queryKey: browseQueryKey(provider, filters),
    initialPageParam: filters.page ?? 1,
    // Providers load asynchronously; an empty name would fail with "unknown provider".
    enabled: provider !== '',
    queryFn: ({ pageParam }) =>
      popcorn().invoke('browse:fetch', { provider, filters: { ...filters, page: pageParam } }),
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.hasMore ? lastPageParam + 1 : undefined,
  })
}
