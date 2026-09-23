import { Schema } from 'effect'

/** IMDb identifier, e.g. "tt0111161". Anime providers also carry MAL ids in this field. */
export const ImdbId = Schema.String.pipe(Schema.brand('ImdbId'))
export type ImdbId = Schema.Schema.Type<typeof ImdbId>

/** TheTVDB identifier — the show primary key (`config.uniqueId` for TV and anime). */
export const TvdbId = Schema.Number.pipe(Schema.brand('TvdbId'))
export type TvdbId = Schema.Schema.Type<typeof TvdbId>
