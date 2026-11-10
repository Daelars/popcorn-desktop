import type { Movie, Show } from '../../shared'

/**
 * One TMDB metadata module for the torrent providers: apibay and nyaa carry no artwork, so
 * the resolver fills in the poster, backdrop, genres, synopsis and the real TVDB id here.
 */
export interface TmdbMovie {
  readonly poster_path?: string | null
  readonly backdrop_path?: string | null
  readonly overview?: string
  readonly runtime?: number
  readonly vote_average?: number
  readonly release_date?: string
  readonly genres?: ReadonlyArray<{ readonly name?: string }>
  readonly imdb_id?: string
}

export interface TmdbShow {
  readonly id?: number
  readonly name?: string
  readonly poster_path?: string | null
  readonly backdrop_path?: string | null
  readonly overview?: string
  readonly vote_average?: number
  readonly first_air_date?: string
  readonly genres?: ReadonlyArray<{ readonly name?: string }>
  readonly external_ids?: { readonly tvdb_id?: number | null }
}

const IMAGE_BASE = 'https://image.tmdb.org/t/p'

/** Artwork is stable per title, so one lookup per id lasts the process. */
const metadataCache = new Map<string, TmdbMovie | undefined>()
const showMetadataCache = new Map<string, TmdbShow | undefined>()

/** TMDB fills in the artwork and synopsis apibay does not have; the key is the app's own. */
export async function tmdbMetadata(imdbId: string, apiKey: string): Promise<TmdbMovie | undefined> {
  const cached = metadataCache.get(imdbId)
  if (cached !== undefined) return cached
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/movie/${imdbId}?api_key=${apiKey}&language=en`,
    )
    if (!response.ok) {
      metadataCache.set(imdbId, undefined)
      return undefined
    }
    const meta = (await response.json()) as TmdbMovie
    metadataCache.set(imdbId, meta)
    return meta
  } catch {
    return undefined
  }
}

/**
 * Shows need two TMDB calls: `/find` resolves the IMDb id to a TMDB id, and the details call
 * carries the artwork plus the real TVDB id (`external_ids`), which the watched bookkeeping
 * needs.
 */
export async function tmdbShowMetadata(
  imdbId: string,
  apiKey: string,
): Promise<TmdbShow | undefined> {
  const cached = showMetadataCache.get(imdbId)
  if (cached !== undefined) return cached
  try {
    const found = (await (
      await fetch(
        `https://api.themoviedb.org/3/find/${imdbId}?api_key=${apiKey}&external_source=imdb_id`,
      )
    ).json()) as { tv_results?: ReadonlyArray<{ id?: number }> }
    const id = found.tv_results?.[0]?.id
    if (id === undefined) {
      showMetadataCache.set(imdbId, undefined)
      return undefined
    }
    const response = await fetch(
      `https://api.themoviedb.org/3/tv/${id}?api_key=${apiKey}&language=en&append_to_response=external_ids`,
    )
    if (!response.ok) {
      showMetadataCache.set(imdbId, undefined)
      return undefined
    }
    const meta = (await response.json()) as TmdbShow
    showMetadataCache.set(imdbId, meta)
    return meta
  } catch {
    return undefined
  }
}

export function withTmdb(movie: Movie, meta: TmdbMovie): Movie {
  const poster = meta.poster_path == null ? undefined : `${IMAGE_BASE}/w300${meta.poster_path}`
  const backdrop =
    meta.backdrop_path == null ? undefined : `${IMAGE_BASE}/w1280${meta.backdrop_path}`
  const year = meta.release_date === undefined ? undefined : Number(meta.release_date.slice(0, 4))
  return {
    ...movie,
    title: movie.title,
    year: Number.isFinite(year) ? (year as number) : movie.year,
    genre: (meta.genres ?? []).flatMap((genre) => (genre.name === undefined ? [] : [genre.name])),
    rating: meta.vote_average ?? movie.rating,
    ...(meta.runtime === undefined ? {} : { runtime: meta.runtime }),
    synopsis: meta.overview ?? movie.synopsis,
    ...(poster === undefined ? {} : { poster, image: poster, poster_medium: poster }),
    ...(backdrop === undefined ? {} : { backdrop }),
  }
}

export function withTmdbShow(show: Show, meta: TmdbShow): Show {
  const poster = meta.poster_path == null ? undefined : `${IMAGE_BASE}/w300${meta.poster_path}`
  const backdrop =
    meta.backdrop_path == null ? undefined : `${IMAGE_BASE}/w1280${meta.backdrop_path}`
  const year =
    meta.first_air_date === undefined ? undefined : Number(meta.first_air_date.slice(0, 4))
  const tvdb = meta.external_ids?.tvdb_id ?? undefined
  return {
    ...show,
    title: meta.name ?? show.title,
    year: Number.isFinite(year) ? (year as number) : show.year,
    genres: (meta.genres ?? []).flatMap((genre) => (genre.name === undefined ? [] : [genre.name])),
    rating: { percentage: (meta.vote_average ?? 0) * 10 },
    synopsis: meta.overview ?? show.synopsis,
    ...(poster === undefined ? {} : { poster, images: { poster } }),
    ...(backdrop === undefined ? {} : { backdrop }),
    // The apibay id is not a TVDB id; a real one is only there when TMDB knows the show.
    ...(tvdb === undefined ? {} : { tvdb_id: tvdb as Show['tvdb_id'] }),
  }
}
