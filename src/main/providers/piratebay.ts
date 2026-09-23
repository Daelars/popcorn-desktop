import type { Filters, Movie, Provider, Show } from '../../shared'
import { BaseProvider, type ProviderConfig, type ProviderFilters, type ProviderPage } from './base'
import { imdbIdOf, isPlayable, magnetOf, qualityOf, yearOf } from './release'
import { tmdbMetadata, tmdbShowMetadata, withTmdb, withTmdbShow } from './tmdb-metadata'

/**
 * A browse source that always has content: apibay's precompiled top-100 lists, which are
 * static JSON with info hashes and IMDb ids. The community popcorn-api servers the legacy
 * app discovered through DHT are gone, so this keeps the grid playable.
 */
export const TPB_BROWSE_CONFIG: ProviderConfig = {
  name: 'TPBBrowse',
  uniqueId: 'imdb_id',
  tabName: 'Movies',
  type: 'movie',
  capabilities: { search: true, sort: ['seeds', 'size', 'added'], quality: false, genres: false },
}

const TOP_LISTS = {
  movie: 'precompiled/data_top100_207.json',
  tvshow: 'precompiled/data_top100_205.json',
} as const

export interface ApibayItem {
  readonly id?: number
  readonly info_hash?: string
  readonly name?: string
  readonly seeders?: number
  readonly leechers?: number
  readonly size?: number
  readonly added?: number
  readonly imdb?: string
  readonly category?: number
}

/** The legacy browse page size; the grid's load-more row counts in the same steps. */
const PAGE_SIZE = 50

function torrentOf(item: ApibayItem): Movie['torrents'][string] {
  const quality = qualityOf(item.name ?? '')
  return {
    url: magnetOf(item),
    provider: 'thepiratebay.org',
    quality: quality as Movie['torrents'][string]['quality'],
    filesize: `${(Number(item.size ?? 0) / 1024 ** 3).toFixed(2)} GB`,
    seed: Number(item.seeders ?? 0),
    peer: Number(item.leechers ?? 0),
    title: item.name ?? '',
  }
}

/** Maps one apibay entry onto the movie shape the grid renders. */
export function toMovie(item: ApibayItem): Movie {
  const title = item.name ?? 'Untitled'
  const quality = qualityOf(title)
  return {
    type: 'movie',
    // Brands are compile-time; apibay ids are already IMDb-shaped.
    imdb_id: imdbIdOf(item) as Movie['imdb_id'],
    title,
    year: yearOf(title),
    genre: [],
    rating: 0,
    image: false,
    cover: false,
    backdrop: false,
    poster: false,
    poster_medium: false,
    synopsis: '',
    trailer: false,
    torrents: { [quality]: torrentOf(item) },
    langs: {},
    defaultAudio: 'en',
  }
}

/** Maps one apibay entry onto the show shape; episodes arrive when the detail page loads. */
export function toShow(item: ApibayItem): Show {
  const title = item.name ?? 'Untitled'
  return {
    type: 'show',
    imdb_id: imdbIdOf(item) as Show['imdb_id'],
    tvdb_id: Number(item.id ?? 0) as Show['tvdb_id'],
    title,
    year: yearOf(title),
    genres: [],
    rating: { percentage: 0 },
    synopsis: '',
    episodes: [],
    torrents: { [qualityOf(title)]: torrentOf(item) },
  } as Show
}

export class TpbBrowseApi extends BaseProvider<Movie> {
  private readonly tmdbKey: string

  constructor(
    config: ProviderConfig,
    args: { apiURL?: string | ReadonlyArray<string>; tmdbKey?: string } = {},
  ) {
    super(config, {
      language: 'en',
      contentLanguage: 'en',
      contentLangOnly: false,
      apiURL: args.apiURL ?? 'https://apibay.org/',
    })
    this.tmdbKey = args.tmdbKey ?? ''
  }

  async fetch(filters: Filters): Promise<ProviderPage<Movie>> {
    const list = this.config.type === 'tvshow' ? TOP_LISTS.tvshow : TOP_LISTS.movie
    const raw = (await this.get(0, list)) as ReadonlyArray<ApibayItem>
    const keywords = filters.keywords?.trim().toLowerCase() ?? ''
    const playable = raw.filter((item) => isPlayable(item.name ?? ''))
    const matching =
      keywords === ''
        ? playable
        : playable.filter((item) => (item.name ?? '').toLowerCase().includes(keywords))

    // The lists carry several releases of the same title; the legacy collection was keyed by
    // imdb id, so releases merge into one item with a torrent per quality. Sorting happens
    // before the merge and before paging, so pages stay stable.
    const sorted = [...matching].sort((left, right) => {
      if (filters.sorter === 'size') return Number(right.size ?? 0) - Number(left.size ?? 0)
      if (filters.sorter === 'added') return Number(right.added ?? 0) - Number(left.added ?? 0)
      return Number(right.seeders ?? 0) - Number(left.seeders ?? 0)
    })
    const isShow = this.config.type === 'tvshow'
    // The schema types are readonly; the merge below builds the records fresh.
    type MutableTorrents = Record<string, Movie['torrents'][string]>
    const byId = new Map<string, { movie: Movie; torrents: MutableTorrents }>()
    for (const item of sorted) {
      const mapped = isShow ? (toShow(item) as unknown as Movie) : toMovie(item)
      const existing = byId.get(mapped.imdb_id)
      if (existing === undefined) {
        byId.set(mapped.imdb_id, { movie: mapped, torrents: { ...mapped.torrents } })
        continue
      }
      for (const [quality, torrent] of Object.entries(mapped.torrents)) {
        const current = existing.torrents[quality]
        if (current === undefined || (torrent.seed ?? 0) > (current.seed ?? 0)) {
          existing.torrents[quality] = torrent
        }
      }
    }

    const unique: Movie[] = [...byId.values()].map((entry) => ({
      ...entry.movie,
      torrents: entry.torrents,
    }))
    const page = Math.max(1, filters.page ?? 1)
    const start = (page - 1) * PAGE_SIZE
    const slice = unique.slice(start, start + PAGE_SIZE)
    const hasMore = start + PAGE_SIZE < unique.length

    if (this.tmdbKey === '') {
      return { results: slice, hasMore }
    }

    // Enrich in small batches: TMDB has no bulk endpoint keyed by IMDb id.
    const enriched: Movie[] = []
    const batch = 8
    for (let index = 0; index < slice.length; index += batch) {
      const group = slice.slice(index, index + batch)
      const mapped = await Promise.all(
        group.map(async (item) => {
          const imdbId = String(item.imdb_id)
          if (isShow) {
            const meta = await tmdbShowMetadata(imdbId, this.tmdbKey)
            return meta === undefined
              ? item
              : (withTmdbShow(item as unknown as Show, meta) as unknown as Movie)
          }
          const meta = await tmdbMetadata(imdbId, this.tmdbKey)
          return meta === undefined ? item : withTmdb(item, meta)
        }),
      )
      enriched.push(...mapped)
    }
    return { results: enriched, hasMore }
  }

  async formatFilters(): Promise<ProviderFilters> {
    return {
      genres: { All: 'All' },
      sorters: { seeds: 'Trending', size: 'Size', added: 'Uploaded' },
    }
  }
}

export function createTpbBrowseProviders(tmdbKey?: string): ReadonlyArray<{
  readonly provider: TpbBrowseApi
  readonly descriptor: Provider
}> {
  return (['movie', 'tvshow'] as const).map((type) => {
    const config = {
      ...TPB_BROWSE_CONFIG,
      // `browse:fetch` resolves a provider by name, so the two lists need distinct names.
      name: type === 'movie' ? 'TPBBrowse' : 'TPBBrowseTV',
      type,
      tabName: type === 'movie' ? 'Movies' : 'Series',
    }
    const provider = new TpbBrowseApi(config, tmdbKey === undefined ? {} : { tmdbKey })
    return { provider, descriptor: provider.toProvider() }
  })
}
