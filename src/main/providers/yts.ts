import type { Filters, ImdbId, Movie } from '../../shared'
import { BaseProvider, type ProviderConfig, type ProviderFilters, type ProviderPage } from './base'

export const YTS_CONFIG: ProviderConfig = {
  name: 'YTSApi',
  uniqueId: 'imdb_id',
  tabName: 'Movies',
  type: 'movie',
  noShowAll: true,
  metadata: 'trakttv:movie-metadata',
  capabilities: { search: true, sort: [], quality: true, genres: true },
}

export const YTS_TYPES = ['All', '720p', '1080p', '2160p', '3D'] as const
export const YTS_RATINGS = ['All', 'r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3', 'r2', 'r1'] as const

interface RawYtsTorrent {
  readonly quality: string
  readonly url: string
  readonly hash: string
  readonly type: string
  readonly size_bytes: number
  readonly size: string
  readonly seeds: number
  readonly peers: number
}

interface RawYtsMovie {
  readonly imdb_code: string
  readonly title_english: string
  readonly year: number
  readonly genres: ReadonlyArray<string>
  readonly rating: number
  readonly runtime: number
  readonly large_cover_image: string
  readonly medium_cover_image: string
  readonly background_image_original: string
  readonly description_full: string
  readonly yt_trailer_code: string
  readonly mpa_rating: string
  readonly language: string
  readonly url: string
  readonly torrents: ReadonlyArray<RawYtsTorrent>
}

interface RawYtsResponse {
  readonly data?: {
    readonly movies?: ReadonlyArray<RawYtsMovie>
    readonly movie_count?: number
    readonly page_number?: number
    readonly limit?: number
  }
}

/** YTS is the second movies provider; its `hasMore` is computed rather than always true. */
export class YtsApi extends BaseProvider<Movie> {
  async fetch(filters: Filters): Promise<ProviderPage<Movie>> {
    const params = new URLSearchParams({ limit: '50', page: String(filters.page ?? 1) })
    params.set('sort_by', filters.sorter ?? 'seeds')
    params.set('order_by', filters.order === 1 ? 'asc' : 'desc')
    if (filters.keywords !== undefined) params.set('query_term', filters.keywords.trim())
    if (filters.genre !== undefined && filters.genre !== 'All') params.set('genre', filters.genre)
    if (filters.type !== undefined && filters.type !== 'All') params.set('quality', filters.type)
    if (filters.rating !== undefined && filters.rating !== 'All') {
      params.set('minimum_rating', filters.rating.replace('r', ''))
    }

    const response = (await this.get(
      0,
      `api/v2/list_movies.json?${params.toString()}`,
    )) as RawYtsResponse
    const data = response.data
    const movies = data?.movies ?? []
    const hasMore =
      data?.movie_count !== undefined && data.limit !== undefined && data.page_number !== undefined
        ? data.movie_count > data.page_number * data.limit
        : false
    return { results: movies.map((movie) => this.formatMovie(movie)), hasMore }
  }

  formatMovie(movie: RawYtsMovie): Movie {
    const torrents: Record<string, Movie['torrents'][string]> = {}
    for (const torrent of movie.torrents) {
      torrents[torrent.quality] = {
        url: torrent.url,
        magnet: `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title_english)}.${torrent.quality}`,
        source: movie.url,
        provider: 'Yts',
        size: torrent.size_bytes,
        filesize: torrent.size,
        seed: torrent.seeds,
        peer: torrent.peers,
      }
    }

    return {
      type: 'movie',
      imdb_id: movie.imdb_code as ImdbId,
      title: movie.title_english,
      year: movie.year,
      genre: [...movie.genres],
      rating: movie.rating,
      runtime: movie.runtime,
      image: movie.large_cover_image,
      cover: movie.large_cover_image,
      backdrop: movie.background_image_original,
      poster: movie.large_cover_image,
      poster_medium: movie.medium_cover_image,
      synopsis: movie.description_full,
      trailer:
        movie.yt_trailer_code === ''
          ? false
          : `https://www.youtube.com/watch?v=${movie.yt_trailer_code}`,
      certification: movie.mpa_rating,
      torrents,
      langs: { [movie.language]: torrents },
      defaultAudio: movie.language,
    }
  }

  async formatFilters(): Promise<ProviderFilters> {
    return {
      genres: Object.fromEntries(
        [
          'All',
          'Action',
          'Adventure',
          'Animation',
          'Biography',
          'Comedy',
          'Crime',
          'Documentary',
          'Drama',
          'Family',
          'Fantasy',
          'History',
          'Horror',
          'Music',
          'Mystery',
          'Romance',
          'Sci-Fi',
          'Sport',
          'Thriller',
          'War',
          'Western',
        ].map((genre) => [genre, genre]),
      ),
      sorters: Object.fromEntries(
        ['seeds', 'peers', 'year', 'rating', 'date_added', 'title'].map((sorter) => [
          sorter,
          sorter,
        ]),
      ),
      types: Object.fromEntries(YTS_TYPES.map((type) => [type, type])),
      ratings: Object.fromEntries(
        YTS_RATINGS.map((rating) => [rating, rating === 'All' ? 'All' : `${rating.slice(1)}+`]),
      ),
    }
  }
}
