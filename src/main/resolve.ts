import { Effect } from 'effect'
import type { Episode, Movie, Show } from '../shared'
import { ProviderError } from '../shared/errors'
import { posterOf, tmdbJson, yearOf } from './providers/tmdb'
import { SEARCH_PROVIDERS, searchTorrents, type TorrentResult } from './search'

/**
 * On-demand metadata and torrents. The browse grids come from TMDB (artwork, infinite
 * paging); a title only gets torrents, and a show its episodes, when it is opened. This is
 * the piece the legacy APIs used to provide in the browse response itself.
 */

export interface ResolveRequest {
  readonly type: 'movie' | 'tvshow' | 'anime'
  readonly imdbId: string
  readonly tmdbId?: number | undefined
  readonly title: string
  readonly year?: number | undefined
}

interface TmdbDetails {
  readonly id?: number
  readonly title?: string
  readonly name?: string
  readonly overview?: string
  readonly poster_path?: string | null
  readonly backdrop_path?: string | null
  readonly vote_average?: number
  readonly runtime?: number
  readonly episode_run_time?: ReadonlyArray<number>
  readonly release_date?: string
  readonly first_air_date?: string
  readonly status?: string
  readonly genres?: ReadonlyArray<{ readonly name?: string }>
  readonly seasons?: ReadonlyArray<{
    readonly season_number?: number
    readonly episode_count?: number
  }>
}

interface TmdbEpisode {
  readonly id?: number
  readonly name?: string
  readonly overview?: string
  readonly air_date?: string | null
  readonly episode_number?: number
  readonly season_number?: number
}

const QUALITY = /\b(2160p|1440p|1080p|720p|480p|360p)\b/i
/** Chromium cannot decode HEVC, so those releases would never play. */
const UNPLAYABLE = /\b(x265|h265|hevc)\b/i
const EPISODE_PATTERN = /S(\d{1,2})[\s._-]?E(\d{1,2})/i
const SEASONS_LIMIT = 20

const cache = new Map<string, Movie | Show>()

function torrentsOf(
  results: ReadonlyArray<TorrentResult>,
): Record<string, Movie['torrents'][string]> {
  const torrents: Record<string, Movie['torrents'][string]> = {}
  for (const result of results) {
    if (UNPLAYABLE.test(result.title)) continue
    const quality = (QUALITY.exec(result.title)?.[1] ?? '1080p').toLowerCase()
    const current = torrents[quality]
    if (current !== undefined && (current.seed ?? 0) >= result.seeds) continue
    torrents[quality] = {
      url: result.magnet,
      provider: result.provider,
      quality: quality as Movie['torrents'][string]['quality'],
      filesize: result.size,
      seed: result.seeds,
      peer: result.peers,
      title: result.title,
    }
  }
  return torrents
}

function search(
  query: string,
  category: string,
): Effect.Effect<ReadonlyArray<TorrentResult>, ProviderError> {
  return searchTorrents(SEARCH_PROVIDERS, () => true, query, category).pipe(
    Effect.map((outcome) => outcome.results),
    Effect.mapError(
      (cause) =>
        new ProviderError({
          provider: 'search',
          operation: 'resolve',
          message: 'search failed',
          cause,
        }),
    ),
  )
}

async function tmdbIdFor(request: ResolveRequest, tmdbKey: string): Promise<number | undefined> {
  if (request.tmdbId !== undefined) return request.tmdbId
  try {
    const kind = request.type === 'movie' ? 'movie' : 'tv'
    const found = await tmdbJson<{
      movie_results?: ReadonlyArray<{ id?: number }>
      tv_results?: ReadonlyArray<{ id?: number }>
    }>(`/find/${request.imdbId}`, tmdbKey, { external_source: 'imdb_id' })
    const results = kind === 'movie' ? found.movie_results : found.tv_results
    return results?.[0]?.id
  } catch {
    return undefined
  }
}

function movieOf(details: TmdbDetails, request: ResolveRequest): Movie {
  const poster = posterOf(details.poster_path, 'w300')
  const backdrop = posterOf(details.backdrop_path, 'w1280')
  return {
    type: 'movie',
    imdb_id: request.imdbId as Movie['imdb_id'],
    ...(details.id === undefined ? {} : { tmdb_id: details.id }),
    title: details.title ?? request.title,
    year: yearOf(details.release_date) || request.year || new Date().getFullYear(),
    genre: (details.genres ?? []).flatMap((genre) =>
      genre.name === undefined ? [] : [genre.name],
    ),
    rating: details.vote_average ?? 0,
    ...(details.runtime === undefined ? {} : { runtime: details.runtime }),
    image: poster ?? false,
    cover: poster ?? false,
    backdrop: backdrop ?? false,
    poster: poster ?? false,
    poster_medium: poster ?? false,
    synopsis: details.overview ?? '',
    trailer: false,
    torrents: {},
    langs: {},
    defaultAudio: 'en',
  }
}

function showOf(details: TmdbDetails, request: ResolveRequest, episodes: Episode[]): Show {
  const poster = posterOf(details.poster_path, 'w300')
  const backdrop = posterOf(details.backdrop_path, 'w1280')
  const runtime = details.episode_run_time?.[0] ?? details.runtime
  return {
    type: 'show',
    imdb_id: request.imdbId as Show['imdb_id'],
    tvdb_id: (request.tmdbId ?? details.id ?? 0) as Show['tvdb_id'],
    ...(details.id === undefined ? {} : { tmdb_id: details.id }),
    title: details.name ?? request.title,
    year: yearOf(details.first_air_date) || request.year || new Date().getFullYear(),
    ...(runtime === undefined ? {} : { runtime }),
    ...(details.status === undefined ? {} : { status: details.status }),
    genres: (details.genres ?? []).flatMap((genre) =>
      genre.name === undefined ? [] : [genre.name],
    ),
    rating: { percentage: (details.vote_average ?? 0) * 10 },
    synopsis: details.overview ?? '',
    images: {
      ...(poster === undefined ? {} : { poster }),
      ...(backdrop === undefined ? {} : { fanart: backdrop }),
    },
    ...(poster === undefined ? {} : { poster }),
    ...(backdrop === undefined ? {} : { backdrop }),
    ...(details.seasons === undefined ? {} : { num_seasons: details.seasons.length }),
    episodes,
  }
}

function episodesOf(
  seasons: ReadonlyArray<ReadonlyArray<TmdbEpisode>>,
  torrentsByKey: ReadonlyMap<string, Record<string, Movie['torrents'][string]>>,
): Episode[] {
  const episodes: Episode[] = []
  for (const season of seasons) {
    for (const entry of season) {
      if (entry.season_number === undefined || entry.episode_number === undefined) continue
      const key = `${entry.season_number}:${entry.episode_number}`
      const airDate = entry.air_date ?? undefined
      episodes.push({
        season: entry.season_number,
        episode: entry.episode_number,
        // TMDB has no TVDB episode ids; its own id is a stable number for the watched state.
        tvdb_id: (entry.id ?? 0) as Episode['tvdb_id'],
        ...(entry.name === undefined ? {} : { title: entry.name }),
        ...(entry.overview === undefined || entry.overview === ''
          ? {}
          : { overview: entry.overview }),
        ...(airDate === undefined ? {} : { first_aired: Math.floor(Date.parse(airDate) / 1000) }),
        torrents: torrentsByKey.get(key) ?? {},
      })
    }
  }
  return episodes
}

/** Groups a show's search results by their `SxxExx`, keeping the best release per quality. */
function groupByEpisode(
  results: ReadonlyArray<TorrentResult>,
): Map<string, Record<string, Movie['torrents'][string]>> {
  const grouped = new Map<string, TorrentResult[]>()
  for (const result of results) {
    const match = EPISODE_PATTERN.exec(result.title)
    if (match === null) continue
    const key = `${Number(match[1])}:${Number(match[2])}`
    grouped.set(key, [...(grouped.get(key) ?? []), result])
  }
  const output = new Map<string, Record<string, Movie['torrents'][string]>>()
  for (const [key, entries] of grouped) output.set(key, torrentsOf(entries))
  return output
}

/**
 * Resolves one title: TMDB for metadata and episodes, the torrent providers for playback.
 * Results are cached for the process lifetime, so reopening a detail page is instant.
 */
export function resolveItem(
  request: ResolveRequest,
  tmdbKey: string,
): Effect.Effect<Movie | Show, ProviderError> {
  const cacheKey = `${request.type}:${request.imdbId}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return Effect.succeed(cached)
  return Effect.gen(function* () {
    const id = yield* Effect.tryPromise({
      try: () => tmdbIdFor(request, tmdbKey),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined))
    const kind = request.type === 'movie' ? 'movie' : 'tv'
    const details =
      id === undefined
        ? undefined
        : yield* Effect.tryPromise({
            try: () => tmdbJson<TmdbDetails>(`/${kind}/${id}`, tmdbKey),
            catch: (cause) =>
              new ProviderError({
                provider: 'tmdb',
                operation: 'resolve',
                message: 'metadata failed',
                cause,
              }),
          }).pipe(Effect.orElseSucceed(() => undefined))

    if (request.type === 'movie') {
      const torrents = yield* search(
        `${details?.title ?? request.title} ${request.year ?? ''}`.trim(),
        'Movies',
      ).pipe(Effect.orElseSucceed(() => []))
      const movie = movieOf(details ?? {}, request)
      const resolved: Movie = { ...movie, torrents: torrentsOf(torrents) }
      cache.set(cacheKey, resolved)
      return resolved
    }

    const category = request.type === 'anime' ? 'Anime' : 'Series'
    const searchResults = yield* search(details?.name ?? request.title, category).pipe(
      Effect.orElseSucceed(() => []),
    )
    const torrentsByKey = groupByEpisode(searchResults)

    // Episodes come one season at a time; a long-running show is capped at the limit.
    const seasons = (details?.seasons ?? [])
      .flatMap((season) => (season.season_number === undefined ? [] : [season.season_number]))
      .slice(0, SEASONS_LIMIT)
    const episodeLists: Array<ReadonlyArray<TmdbEpisode>> = []
    for (const season of seasons) {
      if (id === undefined) break
      const list = yield* Effect.tryPromise({
        try: () =>
          tmdbJson<{ episodes?: ReadonlyArray<TmdbEpisode> }>(
            `/tv/${id}/season/${season}`,
            tmdbKey,
          ),
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => ({ episodes: [] as ReadonlyArray<TmdbEpisode> })))
      episodeLists.push(list.episodes ?? [])
    }

    const show = showOf(details ?? {}, request, episodesOf(episodeLists, torrentsByKey))
    cache.set(cacheKey, show)
    return show
  })
}
