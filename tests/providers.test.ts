import { Schema } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MovieApi } from '../src/main/providers/movie'
import { NYAA_ANIME_CONFIG, NyaaAnimeApi } from '../src/main/providers/nyaa'
import { TpbBrowseApi } from '../src/main/providers/piratebay'
import { createRegistry } from '../src/main/providers/registry'
import { TmdbBrowseApi } from '../src/main/providers/tmdb'
import { YtsApi } from '../src/main/providers/yts'
import { Movie, SORT_KEYS } from '../src/shared'

const rawMovie = {
  imdb_id: 'tt0111161',
  tmdb_id: 278,
  title: 'The Shawshank Redemption',
  year: 1994,
  genres: ['Drama', 'Crime'],
  rating: { percentage: 87 },
  runtime: 142,
  images: { poster: 'https://example.test/poster.jpg', fanart: 'https://example.test/fanart.jpg' },
  synopsis: 'Two imprisoned men bond.',
  trailer: null,
  certification: 'R',
  torrents: {
    en: { '1080p': { url: 'magnet:?xt=urn:btih:abc', provider: 'movies', seed: 5, peer: 1 } },
  },
  contextLocale: 'en',
  locale: null,
}

const rawYts = {
  imdb_code: 'tt0111161',
  title_english: 'The Shawshank Redemption',
  year: 1994,
  genres: ['Drama'],
  rating: 8.7,
  runtime: 142,
  large_cover_image: 'https://example.test/large.jpg',
  medium_cover_image: 'https://example.test/medium.jpg',
  background_image_original: 'https://example.test/bg.jpg',
  description_full: 'Two imprisoned men bond.',
  yt_trailer_code: 'PLACEHOLDER',
  mpa_rating: 'R',
  language: 'en',
  url: 'https://yts.test/movies/shawshank',
  torrents: [
    {
      quality: '1080p',
      url: 'https://yts.test/torrent',
      hash: 'AABBCC',
      type: 'bluray',
      size_bytes: 2_400_000_000,
      size: '2.4 GB',
      seeds: 421,
      peers: 80,
    },
  ],
}

describe('MovieApi formatting', () => {
  it('produces a payload that decodes against the shared Movie schema', () => {
    const provider = new MovieApi(
      { name: 'MovieApi', uniqueId: 'imdb_id', tabName: 'Movies', type: 'movie' },
      { apiURL: 'https://api.test/' },
    )
    const page = provider.formatForPopcorn([rawMovie])
    expect(page.hasMore).toBe(true)
    const movie = Schema.decodeUnknownSync(Movie)(page.results[0])
    expect(movie.imdb_id).toBe('tt0111161')
    expect(movie.rating).toBe(8.7)
    expect(movie.trailer).toBe(false)
    expect(movie.torrents['1080p']?.seed).toBe(5)
  })

  it('drops entries without torrents or a context locale', () => {
    const provider = new MovieApi(
      { name: 'MovieApi', uniqueId: 'imdb_id', tabName: 'Movies', type: 'movie' },
      { apiURL: 'https://api.test/' },
    )
    const { torrents: _dropped, ...withoutTorrents } = rawMovie
    const page = provider.formatForPopcorn([withoutTorrents])
    expect(page.results).toHaveLength(0)
  })
})

describe('YtsApi formatting', () => {
  it('builds quality-keyed torrents and computes hasMore from the raw page', () => {
    const provider = new YtsApi(
      { name: 'YTSApi', uniqueId: 'imdb_id', tabName: 'Movies', type: 'movie', noShowAll: true },
      { apiURL: 'https://yts.test/' },
    )
    const movie = provider.formatMovie(rawYts)
    const decoded = Schema.decodeUnknownSync(Movie)(movie)
    expect(decoded.torrents['1080p']?.provider).toBe('Yts')
    expect(decoded.torrents['1080p']?.magnet).toContain('AABBCC')
    expect(decoded.defaultAudio).toBe('en')
  })
})

describe('registry', () => {
  it('registers the configured providers statically', () => {
    const entries = createRegistry({
      apiUrls: { movies: 'https://api.test/', yts: 'https://yts.test/' },
      language: 'en',
      contentLanguage: 'en',
      contentLangOnly: false,
    })
    // `tpbtv` and `anime` are the fallbacks that keep those tabs alive without their APIs.
    expect(entries.map((entry) => entry.id)).toEqual(['movies', 'yts', 'tpbtv', 'anime'])
    expect(entries[0]?.descriptor).toMatchObject({
      name: 'MovieApi',
      type: 'movie',
      uniqueId: 'imdb_id',
    })
    expect(entries[1]?.descriptor.noShowAll).toBe(true)
  })

  it('declares capabilities and only known sort keys', () => {
    const entries = createRegistry({
      apiUrls: {
        movies: 'https://api.test/',
        tv: 'https://tv.test/',
        anime: 'https://anime.test/',
      },
      tmdbKey: 'key',
      language: 'en',
      contentLanguage: 'en',
      contentLangOnly: false,
    })
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      const capabilities = entry.descriptor.capabilities
      expect(typeof capabilities.search).toBe('boolean')
      for (const key of capabilities.sort) expect(SORT_KEYS).toContain(key)
    }
  })

  it('omits providers without a configured URL', () => {
    const entries = createRegistry({
      apiUrls: { movies: 'https://api.test/' },
      language: 'en',
      contentLanguage: 'en',
      contentLangOnly: false,
    })
    expect(entries.map((entry) => entry.id)).toEqual(['movies', 'tpbtv', 'anime'])
  })
})

describe('provider adapters', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('declares only known sort keys and capabilities across every adapter', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      return {
        ok: true,
        json: async () =>
          url.includes('/genre/') ? { genres: [] } : { page: 1, total_pages: 1, results: [] },
      }
    })
    const tmdb = new TmdbBrowseApi(
      { name: 'TmdbMovies', uniqueId: 'imdb_id', tabName: 'Movies', type: 'movie' },
      { tmdbKey: 'key' },
    )
    const tpb = new TpbBrowseApi({
      name: 'TPBBrowse',
      uniqueId: 'imdb_id',
      tabName: 'Movies',
      type: 'movie',
    })
    const nyaa = new NyaaAnimeApi(NYAA_ANIME_CONFIG, {
      language: 'en',
      contentLanguage: 'en',
      contentLangOnly: false,
    })

    for (const provider of [tmdb, tpb, nyaa]) {
      const filters = await provider.formatFilters()
      expect(Object.keys(filters.sorters).length).toBeGreaterThan(0)
      for (const key of Object.keys(filters.sorters)) expect(SORT_KEYS).toContain(key)
      const capabilities = provider.toProvider().capabilities
      for (const key of capabilities.sort) expect(SORT_KEYS).toContain(key)
    }
  })
})
