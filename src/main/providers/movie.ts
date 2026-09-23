import type { Filters, ImdbId, Movie } from '../../shared'
import { BaseProvider, type ProviderConfig, type ProviderFilters, type ProviderPage } from './base'

export const MOVIE_API_CONFIG: ProviderConfig = {
  name: 'MovieApi',
  uniqueId: 'imdb_id',
  tabName: 'Movies',
  type: 'movie',
  metadata: 'trakttv:movie-metadata',
  capabilities: { search: true, sort: [], quality: true, genres: true },
}

interface RawMovie {
  readonly imdb_id: string
  readonly tmdb_id?: string | number
  readonly title: string
  readonly year: number
  readonly genres: ReadonlyArray<string>
  readonly rating?: { readonly percentage?: number }
  readonly runtime?: number
  readonly images?: { poster?: string; poster_medium?: string; fanart?: string }
  readonly synopsis?: string
  readonly trailer?: string | null
  readonly certification?: string
  readonly torrents?: Record<string, Record<string, unknown>>
  readonly contextLocale?: string
  readonly locale?: Movie['locale']
}

/**
 * The movies API provider. Formatting mirrors the legacy `_formatForPopcorn`;
 * HTML sanitising is gone because React escapes text by default at render time.
 */
export class MovieApi extends BaseProvider<Movie> {
  formatFiltersFromServer(
    sorters: ReadonlyArray<string>,
    data: Record<string, { title: string; count: number }>,
  ): ProviderFilters {
    const genres: Record<string, string> = {}
    const all = data.all
    if (all !== undefined) genres.All = `${all.title} (${all.count})`
    for (const [key, value] of Object.entries(data)) {
      if (key === 'all') continue
      genres[key] = `${value.title} (${value.count})`
    }
    return {
      genres,
      sorters: Object.fromEntries(sorters.map((sorter) => [sorter, sorter])),
    }
  }

  async fetch(filters: Filters): Promise<ProviderPage<Movie>> {
    const params = new URLSearchParams({
      sort: 'seeds',
      limit: '50',
      locale: this.language,
      contentLocale: this.contentLanguage,
    })
    if (!this.contentLangOnly) params.set('showAll', '1')
    if (filters.keywords !== undefined) params.set('keywords', filters.keywords.trim())
    if (filters.genre !== undefined) params.set('genre', filters.genre)
    if (filters.order !== undefined) params.set('order', String(filters.order))
    if (filters.sorter !== undefined && filters.sorter !== 'popularity')
      params.set('sort', filters.sorter)

    const raw = (await this.get(
      0,
      `movies/${filters.page ?? 1}?${params.toString()}`,
    )) as ReadonlyArray<RawMovie>
    return this.formatForPopcorn(raw)
  }

  formatForPopcorn(movies: ReadonlyArray<RawMovie>): ProviderPage<Movie> {
    const results: Movie[] = []
    for (const movie of movies) {
      const torrents = movie.torrents
      const contextLocale = movie.contextLocale
      if (torrents === undefined || contextLocale === undefined) continue
      const images = movie.images
      results.push({
        type: 'movie',
        imdb_id: movie.imdb_id as ImdbId,
        ...(movie.tmdb_id === undefined ? {} : { tmdb_id: movie.tmdb_id }),
        title: movie.title,
        year: movie.year,
        genre: [...movie.genres],
        rating: Math.round(Number(movie.rating?.percentage ?? 0)) / 10,
        ...(movie.runtime === undefined ? {} : { runtime: movie.runtime }),
        image: images?.poster ?? false,
        cover: images?.poster ?? false,
        backdrop: images?.fanart ?? false,
        poster: images?.poster ?? false,
        poster_medium: images?.poster_medium ?? false,
        synopsis: movie.synopsis ?? '',
        trailer: movie.trailer ?? false,
        ...(movie.certification === undefined ? {} : { certification: movie.certification }),
        torrents: (torrents[contextLocale] ?? {}) as Movie['torrents'],
        // Raw torrents are validated against the shared schemas at the IPC boundary.
        langs: torrents as Movie['langs'],
        defaultAudio: contextLocale,
        locale: movie.locale ?? null,
      })
    }
    return { results, hasMore: true }
  }

  async formatFilters(): Promise<ProviderFilters> {
    const params = new URLSearchParams({ contentLocale: this.contentLanguage })
    if (!this.contentLangOnly) params.set('showAll', '1')
    try {
      const result = (await this.get(0, `movies/stat?${params.toString()}`)) as Record<
        string,
        { title: string; count: number }
      >
      return this.formatFiltersFromServer(
        ['trending', 'popularity', 'last added', 'year', 'title', 'rating'],
        result,
      )
    } catch {
      return this.formatFiltersFromServer(
        ['trending', 'popularity', 'last added', 'year', 'title', 'rating'],
        { all: { title: 'All', count: 0 } },
      )
    }
  }
}
