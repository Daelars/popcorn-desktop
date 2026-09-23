import { Context, Effect, Layer } from 'effect'
import type { FetchResult, Filters, ProviderFilters } from '../shared'
import { ProviderError } from '../shared/errors'
import { DatabaseService, type DatabaseServiceShape } from './database'
import { ProvidersService } from './providers/registry'

/**
 * Browse results double as the media cache Favorites and Watched read from. Kept with the
 * catalog, which owns the browse→cache behaviour, not with the database or the IPC layer.
 */
function cachePage(database: DatabaseServiceShape, page: FetchResult): Effect.Effect<void, never> {
  const writes = page.results.flatMap((item) => {
    const record = item as Record<string, unknown>
    const imdbId = typeof record.imdb_id === 'string' ? record.imdb_id : undefined
    if (imdbId === undefined) return []
    if (record.type === 'movie') return [database.media.putMovie(imdbId, item)]
    if (record.type === 'show') {
      const tvdbId = record.tvdb_id === undefined ? '' : String(record.tvdb_id)
      return [database.media.putShow(imdbId, tvdbId, item)]
    }
    return []
  })
  return Effect.forEach(writes, (write) => write, { discard: true }).pipe(Effect.ignore)
}

export interface CatalogShape {
  readonly fetch: (provider: string, filters: Filters) => Effect.Effect<FetchResult, ProviderError>
  readonly filters: (provider: string) => Effect.Effect<ProviderFilters, ProviderError>
}

export class CatalogService extends Context.Tag('CatalogService')<CatalogService, CatalogShape>() {}

/** The browsable sources: provider lookup, fetch/filters, and the media cache write. */
export const CatalogServiceLive = Layer.effect(
  CatalogService,
  Effect.gen(function* () {
    const entries = yield* ProvidersService
    const database = yield* DatabaseService
    const entryOf = (provider: string) =>
      entries.find((candidate) => candidate.descriptor.name === provider)

    return CatalogService.of({
      fetch: (provider, filters) =>
        Effect.gen(function* () {
          const entry = entryOf(provider)
          if (entry === undefined) {
            return yield* Effect.fail(
              new ProviderError({ provider, operation: 'fetch', message: 'unknown provider' }),
            )
          }
          const page = yield* Effect.tryPromise({
            try: () => entry.provider.fetch(filters) as Promise<FetchResult>,
            catch: (cause) =>
              cause instanceof ProviderError
                ? cause
                : new ProviderError({
                    provider,
                    operation: 'fetch',
                    message: 'provider request failed',
                    cause,
                  }),
          })
          yield* cachePage(database, page)
          return page
        }),
      filters: (provider) =>
        Effect.gen(function* () {
          const entry = entryOf(provider)
          if (entry === undefined) {
            return yield* Effect.fail(
              new ProviderError({ provider, operation: 'filters', message: 'unknown provider' }),
            )
          }
          return yield* Effect.tryPromise({
            try: () => entry.provider.formatFilters(),
            catch: (cause) =>
              cause instanceof ProviderError
                ? cause
                : new ProviderError({
                    provider,
                    operation: 'filters',
                    message: 'provider filters failed',
                    cause,
                  }),
          })
        }),
    })
  }),
)
