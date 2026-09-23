import { Schema } from 'effect'

/**
 * Quality key of a torrent map. Observed keys: '480p', '720p', '1080p', '2160p', '3D'
 * and '0' (the default). Movie qualities are unconstrained, so this stays a branded
 * string rather than a literal union.
 */
export const Quality = Schema.String.pipe(Schema.brand('Quality'))
export type Quality = Schema.Schema.Type<typeof Quality>

/** A streamable torrent attached to a movie or episode. */
export const Torrent = Schema.Struct({
  url: Schema.String,
  magnet: Schema.optional(Schema.String),
  magnetURI: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  provider: Schema.String,
  quality: Schema.optional(Quality),
  size: Schema.optional(Schema.Number),
  filesize: Schema.optional(Schema.String),
  seed: Schema.optional(Schema.Number),
  peer: Schema.optional(Schema.Number),
  seeds: Schema.optional(Schema.Number),
  peers: Schema.optional(Schema.Number),
  file: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
})
export type Torrent = Schema.Schema.Type<typeof Torrent>

/**
 * Quality-keyed torrent map, e.g. `{ "1080p": Torrent, "720p": Torrent }`.
 * Keys stay plain strings so they can be indexed directly with quality values.
 */
export const TorrentsByQuality = Schema.Record({ key: Schema.String, value: Torrent })
export type TorrentsByQuality = Schema.Schema.Type<typeof TorrentsByQuality>
