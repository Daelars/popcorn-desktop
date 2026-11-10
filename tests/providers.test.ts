import { Schema } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MovieApi } from '../src/main/providers/movie'
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

describe('TmdbBrowseApi', () => {
  const config = {
    name: 'TmdbMovies',
    uniqueId: 'imdb_id',
    tabName: 'Movies',
    type: 'movie',
  } as const

  afterEach(() => vi.unstubAllGlobals())

  function stubFetch(): string[] {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      return {
        ok: true,
        json: async () =>
          url.includes('/genre/') ? { genres: [] } : { page: 1, total_pages: 1, results: [] },
      }
    })
    return urls
  }

  it('maps sort keys to labels and sends the key as sort_by', async () => {
    const urls = stubFetch()
    const provider = new TmdbBrowseApi(config, { tmdbKey: 'key' })

    expect((await provider.formatFilters()).sorters).toEqual({
      popularity: 'Trending',
      rating: 'Rating',
      year: 'Newest',
    })

    await provider.fetch({ page: 1, sorter: 'rating' })
    expect(urls.some((url) => url.includes('sort_by=vote_average.desc'))).toBe(true)

    await provider.fetch({ page: 1, sorter: 'year' })
    expect(urls.some((url) => url.includes('sort_by=primary_release_date.desc'))).toBe(true)
  })

  it('uses the search endpoint for keywords and pages it like browse', async () => {
    const urls = stubFetch()
    const provider = new TmdbBrowseApi(config, { tmdbKey: 'key' })

    const result = await provider.fetch({ page: 2, keywords: 'dune' })

    const search = urls.find((url) => url.includes('/search/movie'))
    expect(search).toBeDefined()
    expect(search).toContain('query=dune')
    expect(search).toContain('page=2')
    expect(result.hasMore).toBe(false)
  })
})

describe('TpbBrowseApi', () => {
  const items = [
    {
      id: 1,
      info_hash: 'a'.repeat(40),
      name: 'Alpha 2019 1080p',
      seeders: 5,
      leechers: 1,
      size: 3_000_000_000,
      added: 100,
      imdb: 'tt1111111',
      category: 200,
    },
    {
      id: 2,
      info_hash: 'b'.repeat(40),
      name: 'Beta 2020 1080p',
      seeders: 1,
      leechers: 1,
      size: 1_000,
      added: 200,
      imdb: 'tt2222222',
      category: 200,
    },
  ]

  afterEach(() => vi.unstubAllGlobals())

  function provider(): TpbBrowseApi {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => items }))
    return new TpbBrowseApi({
      name: 'TPBBrowse',
      uniqueId: 'imdb_id',
      tabName: 'Movies',
      type: 'movie',
    })
  }

  it('maps sort keys to labels', async () => {
    expect((await provider().formatFilters()).sorters).toEqual({
      seeds: 'Trending',
      size: 'Size',
      added: 'Uploaded',
    })
  })

  it('orders by seeds, size and added from the chosen key', async () => {
    const browse = provider()
    const titles = async (sorter?: string) =>
      (await browse.fetch({ page: 1, ...(sorter === undefined ? {} : { sorter }) })).results.map(
        (movie) => movie.title,
      )

    expect(await titles()).toEqual(['Alpha 2019 1080p', 'Beta 2020 1080p'])
    expect(await titles('size')).toEqual(['Alpha 2019 1080p', 'Beta 2020 1080p'])
    expect(await titles('added')).toEqual(['Beta 2020 1080p', 'Alpha 2019 1080p'])
  })
})
