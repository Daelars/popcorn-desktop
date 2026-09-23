import type { Filters, Movie, Provider, Show } from '../../shared'
import { BaseProvider, type ProviderConfig, type ProviderPage } from './base'

/**
 * The browse source for all three tabs. The legacy browse APIs are gone, so this reads
 * TMDB's `discover` endpoints: they page indefinitely, carry posters and metadata, and
 * cover movies, series and anime. Torrents are not part of TMDB — the resolver attaches
 * them on demand from the torrent providers when a title is opened.
 */
export const TMDB_MOVIE_CONFIG: ProviderConfig = {
  name: 'TmdbMovies',
  uniqueId: 'imdb_id',
  tabName: 'Movies',
  type: 'movie',
}

export const TMDB_SERIES_CONFIG: ProviderConfig = {
  name: 'TmdbSeries',
  uniqueId: 'imdb_id',
  tabName: 'Series',
  type: 'tvshow',
}

export const TMDB_ANIME_CONFIG: ProviderConfig = {
  name: 'TmdbAnime',
  uniqueId: 'imdb_id',
  tabName: 'Anime',
  type: 'anime',
}

const API = 'https://api.themoviedb.org/3'
const IMAGE_BASE = 'https://image.tmdb.org/t/p'

interface TmdbItem {
  readonly id?: number
  readonly title?: string
  readonly name?: string
  readonly original_title?: string
  readonly original_name?: string
  readonly overview?: string
  readonly poster_path?: string | null
  readonly backdrop_path?: string | null
  readonly vote_average?: number
  readonly release_date?: string
  readonly first_air_date?: string
  readonly genre_ids?: ReadonlyArray<number>
  readonly number_of_seasons?: number
}

interface TmdbPage {
  readonly page?: number
  readonly total_pages?: number
  readonly results?: ReadonlyArray<TmdbItem>
}

const genreCache = new Map<string, Map<number, string>>()
const externalIdCache = new Map<string, { imdb?: string; tvdb?: number } | undefined>()

async function tmdbJson<T>(
  path: string,
  apiKey: string,
  params: Record<string, string> = {},
): Promise<T> {
  const query = new URLSearchParams({ api_key: apiKey, language: 'en', ...params })
  const response = await fetch(`${API}${path}?${query.toString()}`)
  if (!response.ok) throw new Error(`TMDB ${path} failed (${response.status})`)
  return (await response.json()) as T
}

/** `discover` carries genre ids; the filter bar and the items want names. */
async function genresFor(kind: 'movie' | 'tv', apiKey: string): Promise<Map<number, string>> {
  const cached = genreCache.get(kind)
  if (cached !== undefined) return cached
  const response = await tmdbJson<{ genres?: ReadonlyArray<{ id?: number; name?: string }> }>(
    `/genre/${kind}/list`,
    apiKey,
  )
  const map = new Map<number, string>()
  for (const genre of response.genres ?? []) {
    if (genre.id !== undefined && genre.name !== undefined) map.set(genre.id, genre.name)
  }
  genreCache.set(kind, map)
  return map
}

/** Real IMDb/TVDB ids, so subtitles, watched state and the detail route keep working. */
async function externalIds(
  kind: 'movie' | 'tv',
  id: number,
  apiKey: string,
): Promise<{ imdb?: string; tvdb?: number } | undefined> {
  const key = `${kind}:${id}`
  const cached = externalIdCache.get(key)
  if (cached !== undefined || externalIdCache.has(key)) return cached
  try {
    const response = await tmdbJson<{ imdb_id?: string | null; tvdb_id?: number | null }>(
      `/${kind}/${id}/external_ids`,
      apiKey,
    )
    const value = {
      ...(response.imdb_id == null ? {} : { imdb: response.imdb_id }),
      ...(response.tvdb_id == null ? {} : { tvdb: response.tvdb_id }),
    }
    externalIdCache.set(key, value)
    return value
  } catch {
    externalIdCache.set(key, undefined)
    return undefined
  }
}

function yearOf(value: string | undefined): number {
  return value === undefined || value.length < 4
    ? new Date().getFullYear()
    : Number(value.slice(0, 4))
}

function posterOf(path: string | null | undefined, size: 'w300' | 'w1280'): string | undefined {
  return path == null ? undefined : `${IMAGE_BASE}/${size}${path}`
}

export class TmdbBrowseApi extends BaseProvider<Movie> {
  private readonly tmdbKey: string
  private readonly kind: 'movie' | 'tv'

  constructor(config: ProviderConfig, args: { tmdbKey: string }) {
    super(config, { language: 'en', contentLanguage: 'en', contentLangOnly: false })
    this.tmdbKey = args.tmdbKey
    this.kind = config.type === 'movie' ? 'movie' : 'tv'
  }

  async fetch(filters: Filters): Promise<ProviderPage<Movie>> {
    const params: Record<string, string> = {
      page: String(Math.max(1, filters.page ?? 1)),
      sort_by: this.sorter(filters.sorter),
    }
    if (this.config.type === 'anime') {
      params.with_genres = '16'
      params.with_origin_country = 'JP'
    } else if (filters.genre !== undefined && filters.genre !== '' && filters.genre !== 'All') {
      params.with_genres = filters.genre
    }
    const page = await tmdbJson<TmdbPage>(`/discover/${this.kind}`, this.tmdbKey, params)
    const genres = await genresFor(this.kind, this.tmdbKey)
    const results = page.results ?? []

    // Ids and artwork are per item; batch them like the apibay provider does.
    const mapped: Movie[] = []
    const batch = 8
    for (let index = 0; index < results.length; index += batch) {
      const group = results.slice(index, index + batch)
      const items = await Promise.all(group.map((item) => this.toItem(item, genres)))
      mapped.push(...items.filter((item): item is Movie => item !== undefined))
    }

    return {
      results: mapped,
      // TMDB tells us how many pages exist, so the grid can keep loading.
      hasMore: (page.page ?? 1) < (page.total_pages ?? 1),
    }
  }

  private sorter(sorter: string | undefined): string {
    if (this.kind === 'movie') {
      if (sorter === 'rating') return 'vote_average.desc'
      if (sorter === 'year') return 'primary_release_date.desc'
      return 'popularity.desc'
    }
    if (sorter === 'rating') return 'vote_average.desc'
    if (sorter === 'year') return 'first_air_date.desc'
    return 'popularity.desc'
  }

  private async toItem(item: TmdbItem, genres: Map<number, string>): Promise<Movie | undefined> {
    if (item.id === undefined) return undefined
    const ids = await externalIds(this.kind, item.id, this.tmdbKey)
    // A title without an IMDb id cannot be resolved for torrents or subtitles.
    if (ids?.imdb === undefined) return undefined
    const title = item.title ?? item.name ?? item.original_title ?? item.original_name ?? ''
    const poster = posterOf(item.poster_path, 'w300')
    const backdrop = posterOf(item.backdrop_path, 'w1280')
    const genreNames = (item.genre_ids ?? []).flatMap((id) => {
      const name = genres.get(id)
      return name === undefined ? [] : [name]
    })

    if (this.kind === 'movie') {
      const movie: Movie = {
        type: 'movie',
        imdb_id: ids.imdb as Movie['imdb_id'],
        tmdb_id: item.id,
        title,
        year: yearOf(item.release_date),
        genre: genreNames,
        rating: item.vote_average ?? 0,
        image: poster ?? false,
        cover: poster ?? false,
        backdrop: backdrop ?? false,
        poster: poster ?? false,
        poster_medium: poster ?? false,
        synopsis: item.overview ?? '',
        trailer: false,
        // Torrents arrive from the resolver when the detail page opens.
        torrents: {},
        langs: {},
        defaultAudio: 'en',
      }
      return movie
    }

    const show: Show = {
      type: 'show',
      imdb_id: ids.imdb as Show['imdb_id'],
      tvdb_id: (ids.tvdb ?? item.id) as Show['tvdb_id'],
      tmdb_id: item.id,
      title,
      year: yearOf(item.first_air_date),
      genres: genreNames,
      rating: { percentage: (item.vote_average ?? 0) * 10 },
      synopsis: item.overview ?? '',
      images: {
        ...(poster === undefined ? {} : { poster }),
        ...(backdrop === undefined ? {} : { fanart: backdrop }),
      },
      ...(poster === undefined ? {} : { poster }),
      ...(backdrop === undefined ? {} : { backdrop }),
      ...(item.number_of_seasons === undefined ? {} : { num_seasons: item.number_of_seasons }),
      episodes: [],
    }
    return show as unknown as Movie
  }

  async formatFilters(): Promise<{
    genres: Record<string, string>
    sorters: Record<string, string>
  }> {
    const genres = await genresFor(this.kind, this.tmdbKey)
    return {
      genres: {
        All: 'All',
        ...Object.fromEntries([...genres].map(([id, name]) => [String(id), name])),
      },
      sorters: { Trending: 'popularity', Rating: 'rating', Newest: 'year' },
    }
  }
}

export function createTmdbProviders(tmdbKey: string): ReadonlyArray<{
  readonly provider: TmdbBrowseApi
  readonly descriptor: Provider
}> {
  return ([TMDB_MOVIE_CONFIG, TMDB_SERIES_CONFIG, TMDB_ANIME_CONFIG] as const).map((config) => {
    const provider = new TmdbBrowseApi(config, { tmdbKey })
    return { provider, descriptor: provider.toProvider() }
  })
}

export type { TmdbItem }
/** Exported for the resolver, which needs the same TMDB plumbing. */
export { externalIds, genresFor, IMAGE_BASE, posterOf, tmdbJson, yearOf }
