import { Schema } from 'effect'
import { MediaItem } from './media'

/** Descriptor for a registered provider — the typed replacement for `Provider#config`. */
export const Provider = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal('movie', 'tvshow', 'anime'),
  uniqueId: Schema.Literal('imdb_id', 'tvdb_id'),
  tabName: Schema.String,
  metadata: Schema.optional(Schema.String),
  noShowAll: Schema.optional(Schema.Boolean),
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
