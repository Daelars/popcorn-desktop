import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { AnimeApi } from '../src/main/providers/anime'
import { createRegistry } from '../src/main/providers/registry'
import { type RawShow, TV_API_CONFIG, TvApi } from '../src/main/providers/tv'
import { Show } from '../src/shared'

const rawShow: RawShow = {
  imdb_id: 'tt0944947',
  tvdb_id: 121361,
  title: 'Game of Thrones',
  slug: 'game-of-thrones',
  year: 2011,
  status: 'Ended',
  genres: ['Action', 'Drama'],
  rating: { percentage: 92 },
  synopsis: 'Nine noble families fight for control over Westeros.',
  images: { poster: 'https://example.test/show.jpg' },
  contextLocale: 'en',
  episodes: [
    {
      season: 1,
      episode: 1,
      tvdb_id: 3254641,
      title: 'Winter Is Coming',
      first_aired: 1305859200,
      torrents: { '1080p': { url: 'magnet:?xt=urn:btih:abc', provider: 'tv', seed: 10, peer: 2 } },
    },
  ],
}

function tvProvider() {
  return new TvApi(TV_API_CONFIG, { apiURL: 'https://api.test/' })
}

describe('TvApi', () => {
  it('formats a show with its episode tree so it decodes against the shared schema', () => {
    const show = tvProvider().formatShow(rawShow)
    const decoded = Schema.decodeUnknownSync(Show)(show)
    expect(decoded.title).toBe('Game of Thrones')
    expect(decoded.rating.percentage).toBe(92)
    expect(decoded.episodes).toHaveLength(1)
    expect(decoded.episodes[0]?.torrents['1080p']?.seed).toBe(10)
  })
})

describe('AnimeApi', () => {
  it('derives the title from the slug', () => {
    const show = new AnimeApi(
      { name: 'AnimeApi', uniqueId: 'tvdb_id', tabName: 'Anime', type: 'anime' },
      { apiURL: 'https://api.test/' },
    ).formatShow({ ...rawShow, title: 'ignored', slug: 'attack-on-titan' })
    expect(show.title).toBe('Attack On Titan')
  })

  it('always reports a single Anime genre', async () => {
    const filters = await new AnimeApi(
      { name: 'AnimeApi', uniqueId: 'tvdb_id', tabName: 'Anime', type: 'anime' },
      { apiURL: 'https://api.test/' },
    ).formatFilters()
    expect(filters.genres).toEqual({ All: 'Anime' })
  })
})

describe('registry with all providers', () => {
  it('registers every configured tab in order', () => {
    const entries = createRegistry({
      apiUrls: {
        movies: 'https://api.test/',
        yts: 'https://yts.test/',
        tv: 'https://api.test/',
        anime: 'https://api.test/',
      },
      language: 'en',
      contentLanguage: 'en',
      contentLangOnly: false,
    })
    expect(entries.map((entry) => entry.id)).toEqual(['movies', 'yts', 'tv', 'anime'])
    expect(entries[2]?.descriptor).toMatchObject({
      name: 'TVApi',
      type: 'tvshow',
      uniqueId: 'tvdb_id',
    })
    expect(entries[3]?.descriptor).toMatchObject({ name: 'AnimeApi', type: 'anime' })
  })
})
