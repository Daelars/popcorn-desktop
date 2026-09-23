import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Schema } from 'effect'
import { type Filters, MediaItem } from '../../shared'
import { browseQueryKey } from './query'

const Page = Schema.Struct({ results: Schema.Array(MediaItem), hasMore: Schema.Boolean })
export type BrowseItem = Schema.Schema.Type<typeof Page>['results'][number]

/** Providers the main process has registered, straight from the typed registry. */
export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: async () => {
      const bridge = window.popcorn
      if (bridge === undefined) {
        throw new Error('IPC bridge unavailable')
      }
      return bridge.invoke('browse:providers', {})
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Genre/sorter/type options a provider reports for the filter bar. */
export interface ProviderFilterOptions {
  readonly genres: Record<string, string>
  readonly sorters: Record<string, string>
  readonly types?: Record<string, string>
  readonly ratings?: Record<string, string>
}

/** Provider filter options, fetched once per provider. */
export function useProviderFilters(provider: string | undefined) {
  return useQuery({
    queryKey: ['provider-filters', provider ?? ''],
    enabled: provider !== undefined,
    queryFn: async (): Promise<ProviderFilterOptions> => {
      const bridge = window.popcorn
      if (bridge === undefined || provider === undefined) {
        throw new Error('IPC bridge unavailable')
      }
      const raw = await bridge.invoke('browse:filters', { provider })
      const filters = raw as ProviderFilterOptions
      return { ...filters, genres: filters.genres ?? {}, sorters: filters.sorters ?? {} }
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * Infinite browse over the provider IPC channel. Results are decoded against the
 * shared schemas, so a malformed provider payload fails the query instead of
 * rendering an empty grid.
 */
export function useBrowse(provider: string, filters: Filters) {
  return useInfiniteQuery({
    queryKey: browseQueryKey(provider, filters),
    initialPageParam: filters.page ?? 1,
    // Providers load asynchronously; an empty name would fail with "unknown provider".
    enabled: provider !== '',
    queryFn: async ({ pageParam }) => {
      const bridge = window.popcorn
      if (bridge === undefined) {
        throw new Error('IPC bridge unavailable')
      }
      const raw = await bridge.invoke('browse:fetch', {
        provider,
        filters: { ...filters, page: pageParam },
      })
      return Schema.decodeUnknownSync(Page)(raw)
    },
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.hasMore ? lastPageParam + 1 : undefined,
  })
}
