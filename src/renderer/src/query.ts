import { QueryClient } from '@tanstack/react-query'
import type { Filters } from '../../shared'

/**
 * One cache for the whole renderer. The legacy app had four (memoizee, localStorage
 * watchlist caches, torrent_cache, a 24h database TTL); none of them exist here.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: (failureCount, error) => {
          // Tagged failures from the main process are terminal unless they are transient.
          const tag = (error as { tag?: string }).tag
          if (tag === 'ProviderError') return false
          return failureCount < 2
        },
        refetchOnWindowFocus: false,
      },
    },
  })
}

/** Stable, typed keys: provider + filters decide the cache entry. */
export function browseQueryKey(provider: string, filters: Filters) {
  return [
    'browse',
    provider,
    {
      keywords: filters.keywords ?? '',
      genre: filters.genre ?? '',
      sorter: filters.sorter ?? '',
      order: filters.order ?? -1,
      type: filters.type ?? '',
      rating: filters.rating ?? '',
      kind: filters.kind ?? '',
    },
  ] as const
}
