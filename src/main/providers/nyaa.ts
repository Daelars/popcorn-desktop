import type { Filters, Movie, Provider } from '../../shared'
import { fetchText, parseNyaa } from '../search'
import { BaseProvider, type ProviderConfig, type ProviderPage } from './base'

/**
 * The anime tab's browse source. The legacy anime API is gone, so this reads nyaa.si's
 * anime category instead: it is reachable, pages for real (`?page=N`) and every row carries
 * a magnet. Each release is mapped as a movie, because nyaa has no episode structure — the
 * grid, the detail page and playback all work with that shape.
 */
export const NYAA_ANIME_CONFIG: ProviderConfig = {
  name: 'NyaaAnime',
  uniqueId: 'imdb_id',
  tabName: 'Anime',
  type: 'anime',
}

/** `1_2` is nyaa's Anime / English-translated category. */
const ANIME_CATEGORY = '1_2'
const QUALITY = /\b(2160p|1440p|1080p|720p|480p|360p)\b/i
const YEAR = /\b(19\d{2}|20\d{2})\b/

/** nyaa has no IMDb ids; the info hash keeps the cache key and the detail route stable. */
function imdbIdOf(magnet: string): string {
  const hash = /btih:([0-9a-z]+)/i.exec(magnet)?.[1]?.toLowerCase() ?? magnet
  return `tt${hash.slice(0, 7)}`
}

export class NyaaAnimeApi extends BaseProvider<Movie> {
  async fetch(filters: Filters): Promise<ProviderPage<Movie>> {
    const page = Math.max(1, filters.page ?? 1)
    const query = filters.keywords?.trim() ?? ''
    const url = `https://nyaa.si/?f=0&c=${ANIME_CATEGORY}&q=${encodeURIComponent(query)}&s=seeders&o=desc&page=${page}`
    const results = parseNyaa(await fetchText(url))
    const items: Movie[] = results.map((result) => {
      const quality = (QUALITY.exec(result.title)?.[1] ?? '1080p').toLowerCase()
      return {
        type: 'movie',
        imdb_id: imdbIdOf(result.magnet) as Movie['imdb_id'],
        title: result.title,
        year: Number(YEAR.exec(result.title)?.[1] ?? new Date().getFullYear()),
        genre: [],
        rating: 0,
        image: false,
        cover: false,
        backdrop: false,
        poster: false,
        poster_medium: false,
        synopsis: '',
        trailer: false,
        torrents: {
          [quality]: {
            url: result.magnet,
            provider: 'nyaa.si',
            quality: quality as Movie['torrents'][string]['quality'],
            filesize: result.size,
            seed: result.seeds,
            peer: result.peers,
            title: result.title,
          },
        },
        langs: {},
        defaultAudio: 'en',
      }
    })
    // A short page means nyaa has nothing more; a full one keeps the load-more row alive.
    return { results: items, hasMore: items.length > 0 }
  }

  async formatFilters(): Promise<{
    genres: Record<string, string>
    sorters: Record<string, string>
  }> {
    return { genres: { All: 'All' }, sorters: { seeds: 'Trending' } }
  }
}

export function createNyaaAnimeProvider(): {
  readonly provider: NyaaAnimeApi
  readonly descriptor: Provider
} {
  const provider = new NyaaAnimeApi(NYAA_ANIME_CONFIG, {
    language: 'en',
    contentLanguage: 'en',
    contentLangOnly: false,
  })
  return { provider, descriptor: provider.toProvider() }
}
