import type { Filters, Movie, Provider, Show } from '../../shared'
import { BaseProvider, type ProviderConfig, type ProviderPage } from './base'

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
}

const TOP_LISTS = {
  movie: 'precompiled/data_top100_207.json',
  tvshow: 'precompiled/data_top100_205.json',
} as const

interface ApibayItem {
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

/** Chromium cannot decode HEVC, so those releases would never play. */
const UNPLAYABLE = /\b(x265|h265|hevc)\b/i
const QUALITY = /\b(2160p|1440p|1080p|720p|480p|360p)\b/i
const YEAR = /\b(19\d{2}|20\d{2})\b/
/** The legacy browse page size; the grid's load-more row counts in the same steps. */
const PAGE_SIZE = 50

function magnetOf(item: ApibayItem): string {
  return `magnet:?xt=urn:btih:${item.info_hash ?? ''}&dn=${encodeURIComponent(item.name ?? '')}`
}

function qualityOf(name: string): string {
  const match = QUALITY.exec(name)
  return match?.[1]?.toLowerCase() ?? '1080p'
}

function yearOf(name: string): number {
  const match = YEAR.exec(name)
  return match?.[1] === undefined ? new Date().getFullYear() : Number(match[1])
}

function imdbIdOf(item: ApibayItem): string {
  if (item.imdb?.startsWith('tt') === true) return item.imdb
  // Items without an IMDb id still need a stable key for the cache and the detail route.
  return `tt${String(item.info_hash ?? '').slice(0, 7)}`
}

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

interface TmdbMovie {
  readonly poster_path?: string | null
  readonly backdrop_path?: string | null
  readonly overview?: string
  readonly runtime?: number
  readonly vote_average?: number
  readonly release_date?: string
  readonly genres?: ReadonlyArray<{ readonly name?: string }>
  readonly imdb_id?: string
}

interface TmdbShow {
  readonly id?: number
  readonly name?: string
  readonly poster_path?: string | null
  readonly backdrop_path?: string | null
  readonly overview?: string
  readonly vote_average?: number
  readonly first_air_date?: string
  readonly genres?: ReadonlyArray<{ readonly name?: string }>
  readonly external_ids?: { readonly tvdb_id?: number | null }
}

const IMAGE_BASE = 'https://image.tmdb.org/t/p'

/** Artwork is stable per title, so one lookup per id lasts the process. */
const metadataCache = new Map<string, TmdbMovie | undefined>()
const showMetadataCache = new Map<string, TmdbShow | undefined>()

/** TMDB fills in the artwork and synopsis apibay does not have; the key is the app's own. */
async function tmdbMetadata(imdbId: string, apiKey: string): Promise<TmdbMovie | undefined> {
  const cached = metadataCache.get(imdbId)
  if (cached !== undefined) return cached
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/movie/${imdbId}?api_key=${apiKey}&language=en`,
    )
    if (!response.ok) {
      metadataCache.set(imdbId, undefined)
      return undefined
    }
    const meta = (await response.json()) as TmdbMovie
    metadataCache.set(imdbId, meta)
    return meta
  } catch {
    return undefined
  }
}

/**
 * Shows need two TMDB calls: `/find` resolves the IMDb id to a TMDB id, and the details
 * call carries the artwork plus the real TVDB id (`external_ids`), which the watched
 * bookkeeping needs.
 */
async function tmdbShowMetadata(imdbId: string, apiKey: string): Promise<TmdbShow | undefined> {
  const cached = showMetadataCache.get(imdbId)
  if (cached !== undefined) return cached
  try {
    const found = (await (
      await fetch(
        `https://api.themoviedb.org/3/find/${imdbId}?api_key=${apiKey}&external_source=imdb_id`,
      )
    ).json()) as { tv_results?: ReadonlyArray<{ id?: number }> }
    const id = found.tv_results?.[0]?.id
    if (id === undefined) {
      showMetadataCache.set(imdbId, undefined)
      return undefined
    }
    const response = await fetch(
      `https://api.themoviedb.org/3/tv/${id}?api_key=${apiKey}&language=en&append_to_response=external_ids`,
    )
    if (!response.ok) {
      showMetadataCache.set(imdbId, undefined)
      return undefined
    }
    const meta = (await response.json()) as TmdbShow
    showMetadataCache.set(imdbId, meta)
    return meta
  } catch {
    return undefined
  }
}

function withTmdb(movie: Movie, meta: TmdbMovie): Movie {
  const poster = meta.poster_path == null ? undefined : `${IMAGE_BASE}/w300${meta.poster_path}`
  const backdrop =
    meta.backdrop_path == null ? undefined : `${IMAGE_BASE}/w1280${meta.backdrop_path}`
  const year = meta.release_date === undefined ? undefined : Number(meta.release_date.slice(0, 4))
  return {
    ...movie,
    title: movie.title,
    year: Number.isFinite(year) ? (year as number) : movie.year,
    genre: (meta.genres ?? []).flatMap((genre) => (genre.name === undefined ? [] : [genre.name])),
    rating: meta.vote_average ?? movie.rating,
    ...(meta.runtime === undefined ? {} : { runtime: meta.runtime }),
    synopsis: meta.overview ?? movie.synopsis,
    ...(poster === undefined ? {} : { poster, image: poster, poster_medium: poster }),
    ...(backdrop === undefined ? {} : { backdrop }),
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

function withTmdbShow(show: Show, meta: TmdbShow): Show {
  const poster = meta.poster_path == null ? undefined : `${IMAGE_BASE}/w300${meta.poster_path}`
  const backdrop =
    meta.backdrop_path == null ? undefined : `${IMAGE_BASE}/w1280${meta.backdrop_path}`
  const year =
    meta.first_air_date === undefined ? undefined : Number(meta.first_air_date.slice(0, 4))
  const tvdb = meta.external_ids?.tvdb_id ?? undefined
  return {
    ...show,
    title: meta.name ?? show.title,
    year: Number.isFinite(year) ? (year as number) : show.year,
    genres: (meta.genres ?? []).flatMap((genre) => (genre.name === undefined ? [] : [genre.name])),
    rating: { percentage: (meta.vote_average ?? 0) * 10 },
    synopsis: meta.overview ?? show.synopsis,
    ...(poster === undefined ? {} : { poster, images: { poster } }),
    ...(backdrop === undefined ? {} : { backdrop }),
    // The apibay id is not a TVDB id; a real one is only there when TMDB knows the show.
    ...(tvdb === undefined ? {} : { tvdb_id: tvdb as Show['tvdb_id'] }),
  }
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
    const playable = raw.filter((item) => !UNPLAYABLE.test(item.name ?? ''))
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

  async formatFilters(): Promise<{
    genres: Record<string, string>
    sorters: Record<string, string>
  }> {
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
