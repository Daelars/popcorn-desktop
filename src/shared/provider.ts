import { Schema } from 'effect'
import { MediaItem } from './media'

/** The closed set of sort keys a provider may declare; an unknown key is a type error. */
export const SortKey = Schema.Literal('popularity', 'rating', 'year', 'seeds', 'size', 'added')
export type SortKey = Schema.Schema.Type<typeof SortKey>

export const SORT_KEYS: ReadonlyArray<SortKey> = [
  'popularity',
  'rating',
  'year',
  'seeds',
  'size',
  'added',
]

/** What a provider can do, so the UI stops guessing from its display name. */
export const Capabilities = Schema.Struct({
  search: Schema.Boolean,
  sort: Schema.Array(SortKey),
  quality: Schema.Boolean,
  genres: Schema.Boolean,
})
export type Capabilities = Schema.Schema.Type<typeof Capabilities>

/** Descriptor for a registered provider — the typed replacement for `Provider#config`. */
export const Provider = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal('movie', 'tvshow', 'anime'),
  uniqueId: Schema.Literal('imdb_id', 'tvdb_id'),
  tabName: Schema.String,
  metadata: Schema.optional(Schema.String),
  noShowAll: Schema.optional(Schema.Boolean),
  capabilities: Capabilities,
})
export type Provider = Schema.Schema.Type<typeof Provider>

/** Filters accepted by `Provider#fetch`. Every key is optional; providers branch on what they get. */
export const Filters = Schema.Struct({
  keywords: Schema.optional(Schema.String),
  genre: Schema.optional(Schema.String),
  sorter: Schema.optional(Schema.String),
  order: Schema.optional(Schema.Union(Schema.Literal(1), Schema.Literal(-1))),
  page: Schema.optional(Schema.Number),
  type: Schema.optional(Schema.String),
  rating: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.String),
})
export type Filters = Schema.Schema.Type<typeof Filters>

/** One page of browse results, as returned by `Provider#fetch`. */
export const FetchResult = Schema.Struct({
  results: Schema.Array(MediaItem),
  hasMore: Schema.Boolean,
})
export type FetchResult = Schema.Schema.Type<typeof FetchResult>

/** Genre/sorter/type options and capabilities a tab reports for the filter bar. */
export const TabFilters = Schema.Struct({
  genres: Schema.Record({ key: Schema.String, value: Schema.String }),
  sorters: Schema.Record({ key: Schema.String, value: Schema.String }),
  kinds: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  types: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  ratings: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  capabilities: Capabilities,
})
export type TabFilters = Schema.Schema.Type<typeof TabFilters>
