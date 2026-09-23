import type { Filters, Movie, Provider } from '../../shared'
import { fetchText, parseNyaa } from '../search'
import { BaseProvider, type ProviderConfig, type ProviderFilters, type ProviderPage } from './base'
import { imdbIdFromMagnet, qualityOf, yearOf } from './release'

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
  capabilities: { search: true, sort: ['seeds'], quality: false, genres: false },
}

/** `1_2` is nyaa's Anime / English-translated category. */
const ANIME_CATEGORY = '1_2'

export class NyaaAnimeApi extends BaseProvider<Movie> {
  async fetch(filters: Filters): Promise<ProviderPage<Movie>> {
    const page = Math.max(1, filters.page ?? 1)
    const query = filters.keywords?.trim() ?? ''
    const url = `https://nyaa.si/?f=0&c=${ANIME_CATEGORY}&q=${encodeURIComponent(query)}&s=seeders&o=desc&page=${page}`
    const results = parseNyaa(await fetchText(url))
    const items: Movie[] = results.map((result) => {
      const quality = qualityOf(result.title)
      return {
        type: 'movie',
        imdb_id: imdbIdFromMagnet(result.magnet) as Movie['imdb_id'],
        title: result.title,
        year: yearOf(result.title),
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

  async formatFilters(): Promise<ProviderFilters> {
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
