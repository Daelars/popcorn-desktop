import { Schema } from 'effect'
import { ImdbId, TvdbId } from './ids'
import { TorrentsByQuality } from './torrent'

/** Legacy fields are `string | false`: providers use false for "not available". */
const MediaImage = Schema.Union(Schema.String, Schema.Literal(false))

const LocalisedText = Schema.Struct({
  title: Schema.optional(Schema.String),
  synopsis: Schema.optional(Schema.String),
  poster: Schema.optional(Schema.String),
  backdrop: Schema.optional(Schema.String),
})

/** A movie as normalised by the movie/YTS providers. */
export const Movie = Schema.Struct({
  type: Schema.Literal('movie'),
  imdb_id: ImdbId,
  tmdb_id: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
  title: Schema.String,
  year: Schema.Number,
  genre: Schema.Array(Schema.String),
  rating: Schema.Number,
  runtime: Schema.optional(Schema.Number),
  image: MediaImage,
  cover: MediaImage,
  backdrop: MediaImage,
  poster: MediaImage,
  poster_medium: MediaImage,
  synopsis: Schema.String,
  trailer: MediaImage,
  certification: Schema.optional(Schema.String),
  torrents: TorrentsByQuality,
  langs: Schema.Record({ key: Schema.String, value: TorrentsByQuality }),
  defaultAudio: Schema.String,
  locale: Schema.optional(Schema.NullOr(LocalisedText)),
})
export type Movie = Schema.Schema.Type<typeof Movie>

/** One episode of a show, as attached by TV/anime providers. */
export const Episode = Schema.Struct({
  season: Schema.Union(Schema.Number, Schema.String),
  episode: Schema.Union(Schema.Number, Schema.String),
  tvdb_id: TvdbId,
  title: Schema.optional(Schema.String),
  overview: Schema.optional(Schema.String),
  first_aired: Schema.optional(Schema.Number),
  torrents: TorrentsByQuality,
  locale: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.String),
      overview: Schema.optional(Schema.String),
    }),
  ),
})
export type Episode = Schema.Schema.Type<typeof Episode>

/** A show as returned by TV/anime providers. `rating` stays the raw `{ percentage }` object. */
export const Show = Schema.Struct({
  type: Schema.Literal('show'),
  imdb_id: ImdbId,
  tvdb_id: TvdbId,
  tmdb_id: Schema.optional(Schema.Number),
  title: Schema.String,
  slug: Schema.optional(Schema.String),
  year: Schema.Number,
  runtime: Schema.optional(Schema.Number),
  status: Schema.optional(Schema.String),
  country: Schema.optional(Schema.String),
  original_language: Schema.optional(Schema.String),
  genres: Schema.Array(Schema.String),
  rating: Schema.Struct({ percentage: Schema.Number }),
  synopsis: Schema.String,
  images: Schema.optional(
    Schema.Struct({
      poster: Schema.optional(Schema.String),
      banner: Schema.optional(Schema.String),
      fanart: Schema.optional(Schema.String),
    }),
  ),
  poster: Schema.optional(Schema.String),
  backdrop: Schema.optional(Schema.String),
  num_seasons: Schema.optional(Schema.Number),
  exist_translations: Schema.optional(Schema.Array(Schema.String)),
  contextLocale: Schema.optional(Schema.String),
  locale: Schema.optional(LocalisedText),
  episodes: Schema.Array(Episode),
})
export type Show = Schema.Schema.Type<typeof Show>

/** Anything a browse grid can render. */
export const MediaItem = Schema.Union(Movie, Show)
export type MediaItem = Schema.Schema.Type<typeof MediaItem>
