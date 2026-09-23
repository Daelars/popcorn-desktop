import type { Movie, Provider, Show } from '../../shared'
import { ANIME_API_CONFIG, AnimeApi } from './anime'
import type { BaseProvider } from './base'
import { MOVIE_API_CONFIG, MovieApi } from './movie'
import { createNyaaAnimeProvider } from './nyaa'
import { createTpbBrowseProviders } from './piratebay'
import { createTmdbProviders } from './tmdb'
import { TV_API_CONFIG, TvApi } from './tv'
import { YTS_CONFIG, YtsApi } from './yts'

export type ProviderId =
  | 'movies'
  | 'yts'
  | 'tv'
  | 'anime'
  | 'tpb'
  | 'tpbtv'
  | 'tmdb'
  | 'tmdbSeries'
  | 'tmdbAnime'

/** One static registry replaces the legacy readdir/package.json/dependency-name loading. */
export interface ProviderEntry {
  readonly id: ProviderId
  readonly provider: BaseProvider<Movie> | BaseProvider<Show>
  readonly descriptor: Provider
}

export interface RegistryOptions {
  /** Base URL per provider id; the legacy app read these from settings or the DHT config. */
  readonly apiUrls: Partial<Record<ProviderId, string>>
  readonly language: string
  readonly contentLanguage: string
  readonly contentLangOnly: boolean
  readonly proxy?: string
  /** Metadata key used to fill in artwork the browse source does not carry. */
  readonly tmdbKey?: string
}

export function createRegistry(options: RegistryOptions): ReadonlyArray<ProviderEntry> {
  const shared = {
    language: options.language,
    contentLanguage: options.contentLanguage,
    contentLangOnly: options.contentLangOnly,
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
  }
  const entries: ProviderEntry[] = []

  const movies = options.apiUrls.movies
  if (movies !== undefined) {
    const provider = new MovieApi(MOVIE_API_CONFIG, { ...shared, apiURL: movies })
    entries.push({ id: 'movies', provider, descriptor: provider.toProvider() })
  }
  const yts = options.apiUrls.yts
  if (yts !== undefined) {
    const provider = new YtsApi(YTS_CONFIG, { ...shared, apiURL: yts })
    entries.push({ id: 'yts', provider, descriptor: provider.toProvider() })
  }
  const tv = options.apiUrls.tv
  if (tv !== undefined) {
    const provider = new TvApi(TV_API_CONFIG, { ...shared, apiURL: tv })
    entries.push({ id: 'tv', provider, descriptor: provider.toProvider() })
  }
  const anime = options.apiUrls.anime
  if (anime !== undefined) {
    const provider = new AnimeApi(ANIME_API_CONFIG, { ...shared, apiURL: anime })
    entries.push({ id: 'anime', provider, descriptor: provider.toProvider() })
  }

  // TMDB keeps every tab populated with artwork and real paging; torrents arrive on demand
  // from the resolver. It replaces the apibay/nyaa grids whenever a key is configured.
  const tmdbKey = options.tmdbKey
  if (tmdbKey !== undefined && tmdbKey !== '') {
    const tmdbIds: ReadonlyArray<ProviderId> = ['tmdb', 'tmdbSeries', 'tmdbAnime']
    createTmdbProviders(tmdbKey).forEach((entry, index) => {
      const type = entry.descriptor.type
      if (entries.every((existing) => existing.descriptor.type !== type)) {
        entries.push({
          id: tmdbIds[index] ?? 'tmdb',
          provider: entry.provider,
          descriptor: entry.descriptor,
        })
      }
    })
  }

  // The legacy API servers are gone; without them the grid would be empty. The apibay
  // top-100 lists keep Movies and Series populated and playable.
  if (entries.every((entry) => entry.descriptor.type !== 'movie')) {
    const [movies] = createTpbBrowseProviders(options.tmdbKey)
    if (movies !== undefined) {
      entries.push({ id: 'tpb', provider: movies.provider, descriptor: movies.descriptor })
    }
  }
  if (entries.every((entry) => entry.descriptor.type !== 'tvshow')) {
    const [, shows] = createTpbBrowseProviders(options.tmdbKey)
    if (shows !== undefined) {
      entries.push({ id: 'tpbtv', provider: shows.provider, descriptor: shows.descriptor })
    }
  }
  // Anime has no reachable API either; nyaa.si's anime category keeps the tab alive.
  if (entries.every((entry) => entry.descriptor.type !== 'anime')) {
    const anime = createNyaaAnimeProvider()
    entries.push({ id: 'anime', provider: anime.provider, descriptor: anime.descriptor })
  }

  return entries
}
