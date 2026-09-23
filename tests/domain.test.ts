import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { Filters, ImdbId, type ImdbId as ImdbIdType, Movie, Show } from '../src/shared/index'

const ytsTorrent = {
  url: 'magnet:?xt=urn:btih:AABBCC&dn=The.Shawshank.Redemption.1080p-YTS',
  magnet: 'magnet:?xt=urn:btih:AABBCC',
  source: 'https://yts.example.test/movies/shawshank',
  provider: 'Yts',
  size: 2_400_000_000,
  filesize: '2.4 GB',
  seed: 421,
  peer: 80,
}

const movieApiMovie = {
  type: 'movie',
  imdb_id: 'tt0111161',
  tmdb_id: 278,
  title: 'The Shawshank Redemption',
  year: 1994,
  genre: ['Drama', 'Crime'],
  rating: 8.7,
  runtime: 142,
  image: 'https://example.test/poster.jpg',
  cover: 'https://example.test/poster.jpg',
  backdrop: 'https://example.test/fanart.jpg',
  poster: 'https://example.test/poster.jpg',
  poster_medium: 'https://example.test/poster-medium.jpg',
  synopsis: 'Two imprisoned men bond over a number of years.',
  trailer: false,
  certification: 'R',
  torrents: { '1080p': ytsTorrent },
  langs: { en: { '1080p': ytsTorrent } },
  defaultAudio: 'en',
  locale: null,
}

const ytsMovie = {
  type: 'movie',
  imdb_id: 'tt0111161',
  title: 'The Shawshank Redemption',
  year: 1994,
  genre: ['Drama', 'Crime'],
  rating: 8.7,
  runtime: 142,
  images: '',
  image: 'https://example.test/large-cover.jpg',
  cover: 'https://example.test/large-cover.jpg',
  backdrop: 'https://example.test/background.jpg',
  poster: 'https://example.test/large-cover.jpg',
  poster_medium: 'https://example.test/medium-cover.jpg',
  synopsis: 'Two imprisoned men bond over a number of years.',
  trailer: 'https://www.youtube.com/watch?v=PLACEHOLDER',
  certification: '',
  torrents: { '1080p': ytsTorrent },
  defaultAudio: 'en',
  langs: { en: { '1080p': ytsTorrent } },
}

const tvShow = {
  type: 'show',
  imdb_id: 'tt0944947',
  tvdb_id: 121361,
  title: 'Game of Thrones',
  slug: 'game-of-thrones',
  year: 2011,
  status: 'Ended',
  country: 'us',
  original_language: 'en',
  genres: ['Action', 'Adventure', 'Drama'],
  rating: { percentage: 92 },
  synopsis: 'Nine noble families fight for control over Westeros.',
  images: { poster: 'https://example.test/show.jpg', banner: 'https://example.test/banner.jpg' },
  contextLocale: 'en',
  episodes: [
    {
      season: 1,
      episode: 1,
      tvdb_id: 3254641,
      title: 'Winter Is Coming',
      overview: 'Ned Stark leaves Winterfell.',
      first_aired: 1305859200,
      torrents: { '1080p': ytsTorrent },
    },
    {
      season: 1,
      episode: 2,
      tvdb_id: 3254642,
      torrents: { '720p': ytsTorrent },
    },
  ],
}

describe('domain schemas', () => {
  it('decodes a movie normalised by the movies provider', () => {
    const movie = Schema.decodeUnknownSync(Movie)(movieApiMovie)
    expect(movie.imdb_id).toBe('tt0111161')
    expect(movie.rating).toBe(8.7)
    expect(movie.trailer).toBe(false)
  })

  it('decodes a movie shaped by the YTS provider, images placeholder and all', () => {
    const movie = Schema.decodeUnknownSync(Movie)(ytsMovie)
    expect(movie.poster).toContain('large-cover')
    expect(movie.locale).toBeUndefined()
  })

  it('decodes a show with its episode tree', () => {
    const show = Schema.decodeUnknownSync(Show)(tvShow)
    expect(show.rating.percentage).toBe(92)
    expect(show.episodes).toHaveLength(2)
    expect(show.episodes[0]?.torrents['1080p']?.seed).toBe(421)
  })

  it('rejects a torrent without a url', () => {
    const broken = {
      ...movieApiMovie,
      torrents: { '1080p': { provider: 'Yts' } },
    }
    expect(() => Schema.decodeUnknownSync(Movie)(broken)).toThrow()
  })

  it('rejects a torrent whose seed count is not a number', () => {
    const broken = {
      ...movieApiMovie,
      torrents: { '1080p': { ...ytsTorrent, seed: '421' } },
    }
    expect(() => Schema.decodeUnknownSync(Movie)(broken)).toThrow()
  })

  it('rejects a movie with no imdb_id', () => {
    const { imdb_id: _dropped, ...broken } = movieApiMovie
    expect(() => Schema.decodeUnknownSync(Movie)(broken)).toThrow()
  })
})

describe('filters', () => {
  it('decodes an empty filter object', () => {
    expect(Schema.decodeUnknownSync(Filters)({})).toEqual({})
  })

  it('decodes a full browse filter', () => {
    const filters = Schema.decodeUnknownSync(Filters)({
      keywords: 'shawshank',
      genre: 'Drama',
      sorter: 'trending',
      order: -1,
      page: 2,
      type: '1080p',
      rating: 'r9',
      kind: 'Movies',
    })
    expect(filters.order).toBe(-1)
    expect(filters.page).toBe(2)
  })

  it('rejects an order outside 1/-1', () => {
    expect(() => Schema.decodeUnknownSync(Filters)({ order: 2 })).toThrow()
  })
})

describe('branded ids', () => {
  function takesImdbId(_id: ImdbIdType): void {}

  it('accepts ids produced by the schema', () => {
    takesImdbId(Schema.decodeUnknownSync(ImdbId)('tt0111161'))
  })

  it('rejects bare strings at compile time', () => {
    // @ts-expect-error a bare string is not a branded ImdbId
    takesImdbId('tt0111161')
  })
})
