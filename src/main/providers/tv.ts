import type { Filters, ImdbId, Show, TvdbId } from '../../shared'
import { BaseProvider, type ProviderConfig, type ProviderFilters, type ProviderPage } from './base'

export const TV_API_CONFIG: ProviderConfig = {
  name: 'TVApi',
  uniqueId: 'tvdb_id',
  tabName: 'TV Shows',
  type: 'tvshow',
  metadata: 'trakttv:show-metadata',
}

export interface RawEpisode {
  readonly season: number | string
  readonly episode: number | string
  readonly tvdb_id: number
  readonly title?: string
  readonly overview?: string
  readonly first_aired?: number
  readonly torrents?: Record<string, Record<string, unknown>>
  readonly locale?: { title?: string; overview?: string }
}

export interface RawShow {
  readonly imdb_id: string
  readonly tvdb_id: number
  readonly tmdb_id?: number
  readonly title: string
  readonly slug?: string
  readonly year: number
  readonly runtime?: number
  readonly status?: string
  readonly country?: string
  readonly original_language?: string
  readonly genres?: ReadonlyArray<string>
  readonly rating?: { percentage?: number }
  readonly synopsis?: string
  readonly images?: { poster?: string; banner?: string; fanart?: string }
  readonly poster?: string
  readonly backdrop?: string
  readonly num_seasons?: number
  readonly exist_translations?: ReadonlyArray<string>
  readonly contextLocale?: string
  readonly locale?: Show['locale']
  readonly episodes?: ReadonlyArray<RawEpisode>
}

/** TV shows provider. Anime extends it, overriding the request params and title normalisation. */
export class TvApi extends BaseProvider<Show> {
  protected readonly includeGenre: boolean = true

  protected requestParams(): Record<string, string> {
    return {}
  }

  protected normalizeTitle(show: RawShow): string {
    return show.title
  }

  async fetch(filters: Filters): Promise<ProviderPage<Show>> {
    const params = new URLSearchParams({
      locale: this.language,
      contentLocale: this.contentLanguage,
      ...this.requestParams(),
    })
    if (!this.contentLangOnly) params.set('showAll', '1')
    if (filters.keywords !== undefined) params.set('keywords', filters.keywords.trim())
    if (this.includeGenre && filters.genre !== undefined) params.set('genre', filters.genre)
    if (filters.order !== undefined) params.set('order', String(filters.order))
    if (filters.sorter !== undefined && filters.sorter !== 'popularity')
      params.set('sort', filters.sorter)

    const raw = (await this.get(
      0,
      `shows/${filters.page ?? 1}?${params.toString()}`,
    )) as ReadonlyArray<RawShow>
    return { results: raw.map((show) => this.formatShow(show)), hasMore: true }
  }

  formatShow(show: RawShow): Show {
    const episodes: Show['episodes'] = (show.episodes ?? []).map((episode) => ({
      season: episode.season,
      episode: episode.episode,
      tvdb_id: episode.tvdb_id as TvdbId,
      ...(episode.title === undefined ? {} : { title: episode.title }),
      ...(episode.overview === undefined ? {} : { overview: episode.overview }),
      ...(episode.first_aired === undefined ? {} : { first_aired: episode.first_aired }),
      // Raw torrents are validated against the shared schemas at the IPC boundary.
      torrents: (episode.torrents ?? {}) as Show['episodes'][number]['torrents'],
      ...(episode.locale === undefined ? {} : { locale: episode.locale }),
    }))

    return {
      type: 'show',
      imdb_id: show.imdb_id as ImdbId,
      tvdb_id: show.tvdb_id as TvdbId,
      ...(show.tmdb_id === undefined ? {} : { tmdb_id: show.tmdb_id }),
      title: this.normalizeTitle(show),
      ...(show.slug === undefined ? {} : { slug: show.slug }),
      year: show.year,
      ...(show.runtime === undefined ? {} : { runtime: show.runtime }),
      ...(show.status === undefined ? {} : { status: show.status }),
      ...(show.country === undefined ? {} : { country: show.country }),
      ...(show.original_language === undefined
        ? {}
        : { original_language: show.original_language }),
      genres: [...(show.genres ?? [])],
      rating: { percentage: Number(show.rating?.percentage ?? 0) },
      synopsis: show.synopsis ?? '',
      ...(show.images === undefined ? {} : { images: show.images }),
      ...(show.poster === undefined ? {} : { poster: show.poster }),
      ...(show.backdrop === undefined ? {} : { backdrop: show.backdrop }),
      ...(show.num_seasons === undefined ? {} : { num_seasons: show.num_seasons }),
      ...(show.exist_translations === undefined
        ? {}
        : { exist_translations: [...show.exist_translations] }),
      ...(show.contextLocale === undefined ? {} : { contextLocale: show.contextLocale }),
      ...(show.locale === undefined ? {} : { locale: show.locale }),
      episodes,
    }
  }

  async detail(
    imdbId: string,
    oldData: { contextLocale?: string; title1?: string } = {},
  ): Promise<RawShow> {
    const params = new URLSearchParams()
    if (oldData.contextLocale !== undefined) params.set('contentLocale', oldData.contextLocale)
    const raw = (await this.get(0, `show/${imdbId}?${params.toString()}`)) as RawShow
    return oldData.title1 === undefined ? raw : { ...raw, title: oldData.title1 }
  }

  async torrents(imdbId: string, language: string): Promise<unknown> {
    const params = new URLSearchParams({ locale: this.language, contentLocale: language })
    return this.get(0, `show/${imdbId}/torrents?${params.toString()}`)
  }

  async episodeTorrents(
    imdbId: string,
    language: string,
    season: number | string,
    episode: number | string,
  ): Promise<unknown> {
    const params = new URLSearchParams({ locale: this.language, contentLocale: language })
    return this.get(0, `show/${imdbId}/${season}/${episode}/torrents?${params.toString()}`)
  }

  async formatFilters(): Promise<ProviderFilters> {
    const params = new URLSearchParams({ contentLocale: this.contentLanguage })
    if (!this.contentLangOnly) params.set('showAll', '1')
    try {
      const result = (await this.get(0, `shows/stat?${params.toString()}`)) as Record<
        string,
        { title: string; count: number }
      >
      return this.formatFiltersFromServer(
        ['trending', 'popularity', 'updated', 'year', 'name', 'rating'],
        result,
      )
    } catch {
      return {
        genres: { All: 'All' },
        sorters: Object.fromEntries(
          ['trending', 'popularity', 'updated', 'year', 'name', 'rating'].map((sorter) => [
            sorter,
            sorter,
          ]),
        ),
      }
    }
  }

  formatFiltersFromServer(
    sorters: ReadonlyArray<string>,
    data: Record<string, { title: string; count: number }>,
  ): ProviderFilters {
    const genres: Record<string, string> = {}
    const all = data.all
    if (all !== undefined) genres.All = `${all.title} (${all.count})`
    for (const [key, value] of Object.entries(data)) {
      if (key === 'all') continue
      genres[key] = `${value.title} (${value.count})`
    }
    return { genres, sorters: Object.fromEntries(sorters.map((sorter) => [sorter, sorter])) }
  }
}
