import { Context, Effect, Layer } from 'effect'
import type { Capabilities, FetchResult, Filters, Provider, TabFilters } from '../shared'
import { SORT_KEYS } from '../shared'
import { ProviderError } from '../shared/errors'
import { DatabaseService, type DatabaseServiceShape } from './database'
import { type ProviderEntry, ProvidersService } from './providers/registry'

/**
 * Browse results double as the media cache Favorites and Watched read from. Kept with the
 * catalog, which owns the browse→cache behaviour, not with the database or the IPC layer.
 */
function cachePage(
  database: DatabaseServiceShape,
  results: FetchResult['results'],
): Effect.Effect<void, never> {
  const writes = results.flatMap((item) => {
    const record = item as Record<string, unknown>
    const imdbId = typeof record.imdb_id === 'string' ? record.imdb_id : undefined
    // Stand-in providers mint `tt<infohash>` ids; only cache real IMDb ids so a fake one is
    // never persisted (Library owns the standalone bookmarks, #52).
    if (imdbId === undefined || !/^tt\d+$/.test(imdbId)) return []
    if (record.type === 'movie') return [database.media.putMovie(imdbId, item)]
    if (record.type === 'show') {
      const tvdbId = record.tvdb_id === undefined ? '' : String(record.tvdb_id)
      return [database.media.putShow(imdbId, tvdbId, item)]
    }
    return []
  })
  return Effect.forEach(writes, (write) => write, { discard: true }).pipe(Effect.ignore)
}

function mergeCapabilities(entries: ReadonlyArray<ProviderEntry>): Capabilities {
  const sorts = new Set(entries.flatMap((entry) => entry.descriptor.capabilities.sort))
  return {
    search: entries.some((entry) => entry.descriptor.capabilities.search),
    sort: SORT_KEYS.filter((key) => sorts.has(key)),
    quality: entries.some((entry) => entry.descriptor.capabilities.quality),
    genres: entries.some((entry) => entry.descriptor.capabilities.genres),
  }
}

export interface CatalogShape {
  /** Fetch one tab, merging every registered provider for it by the unique id. */
  readonly fetch: (tab: string, filters: Filters) => Effect.Effect<FetchResult, ProviderError>
  /** The merged filter options and capabilities for a tab. */
  readonly filters: (tab: string) => Effect.Effect<TabFilters, ProviderError>
  readonly descriptors: (tab: string) => Effect.Effect<ReadonlyArray<Provider>, ProviderError>
}

export class CatalogService extends Context.Tag('CatalogService')<CatalogService, CatalogShape>() {}

/**
 * The browsable sources. It reads the live provider registry per call, so a `custom*Server`
 * change registers the legacy adapter without a restart, and it merges providers per tab by
 * their unique id, as the legacy app did.
 */
export const CatalogServiceLive = Layer.effect(
  CatalogService,
  Effect.gen(function* () {
    const providers = yield* ProvidersService
    const database = yield* DatabaseService

    const forTab = (
      tab: string,
      entries: ReadonlyArray<ProviderEntry>,
    ): ReadonlyArray<ProviderEntry> => entries.filter((entry) => entry.descriptor.type === tab)

    return CatalogService.of({
      fetch: (tab, filters) =>
        Effect.gen(function* () {
          const entries = forTab(tab, yield* providers.entries)
          if (entries.length === 0) {
            return yield* Effect.fail(
              new ProviderError({ provider: tab, operation: 'fetch', message: 'unknown tab' }),
            )
          }
          const pages = yield* Effect.forEach(
            entries,
            (entry) =>
              Effect.tryPromise({
                try: () => entry.provider.fetch(filters) as Promise<FetchResult>,
                catch: (cause) =>
                  new ProviderError({
                    provider: entry.descriptor.name,
                    operation: 'fetch',
                    message: 'provider request failed',
                    cause,
                  }),
              }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
            { concurrency: 'unbounded' },
          )
          const seen = new Map<string, FetchResult['results'][number]>()
          let hasMore = false
          for (const page of pages) {
            if (page === undefined) continue
            hasMore = hasMore || page.hasMore
            for (const item of page.results) {
              const id = String((item as { imdb_id?: unknown }).imdb_id ?? '')
              if (id !== '' && !seen.has(id)) seen.set(id, item)
            }
          }
          const results = [...seen.values()]
          yield* cachePage(database, results)
          return { results, hasMore }
        }),
      filters: (tab) =>
        Effect.gen(function* () {
          const entries = forTab(tab, yield* providers.entries)
          if (entries.length === 0) {
            return yield* Effect.fail(
              new ProviderError({ provider: tab, operation: 'filters', message: 'unknown tab' }),
            )
          }
          const options = yield* Effect.forEach(
            entries,
            (entry) =>
              Effect.tryPromise({
                try: () => entry.provider.formatFilters(),
                catch: (cause) =>
                  new ProviderError({
                    provider: entry.descriptor.name,
                    operation: 'filters',
                    message: 'provider filters failed',
                    cause,
                  }),
              }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
            { concurrency: 'unbounded' },
          )
          const genres: Record<string, string> = {}
          const sorters: Record<string, string> = {}
          const types: Record<string, string> = {}
          const ratings: Record<string, string> = {}
          entries.forEach((entry, index) => {
            const option = options[index]
            if (option === undefined) return
            if (entry.descriptor.capabilities.genres) Object.assign(genres, option.genres)
            if (entry.descriptor.capabilities.sort.length > 0) {
              Object.assign(sorters, option.sorters)
            }
            Object.assign(types, option.types ?? {})
            Object.assign(ratings, option.ratings ?? {})
          })
          return {
            genres,
            sorters,
            ...(Object.keys(types).length === 0 ? {} : { types }),
            ...(Object.keys(ratings).length === 0 ? {} : { ratings }),
            capabilities: mergeCapabilities(entries),
          }
        }),
      descriptors: (tab) =>
        Effect.map(providers.entries, (entries) =>
          forTab(tab, entries).map((entry) => entry.descriptor),
        ),
    })
  }),
)
