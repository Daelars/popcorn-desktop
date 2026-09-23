import type { Show } from '../../shared'
import type { ProviderConfig, ProviderFilters } from './base'
import { type RawShow, TvApi } from './tv'

export const ANIME_API_CONFIG: ProviderConfig = {
  name: 'AnimeApi',
  uniqueId: 'tvdb_id',
  tabName: 'Anime',
  type: 'anime',
  metadata: 'trakttv:show-metadata',
}

function capitalizeEach(value: string): string {
  return value.replace(/\w*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}

/** Anime is the TV provider with an anime flag, no genre filter, and slug-derived titles. */
export class AnimeApi extends TvApi {
  protected override readonly includeGenre = false

  protected override requestParams(): Record<string, string> {
    return { anime: '1' }
  }

  protected override normalizeTitle(show: RawShow): string {
    return show.slug === undefined ? show.title : capitalizeEach(show.slug.replace(/-/g, ' '))
  }

  override async formatFilters(): Promise<ProviderFilters> {
    const params = new URLSearchParams({ contentLocale: this.contentLanguage, anime: '1' })
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
        genres: { All: 'Anime' },
        sorters: Object.fromEntries(
          ['trending', 'popularity', 'updated', 'year', 'name', 'rating'].map((sorter) => [
            sorter,
            sorter,
          ]),
        ),
      }
    }
  }

  override formatFiltersFromServer(
    sorters: ReadonlyArray<string>,
    data: Record<string, { title: string; count: number }>,
  ): ProviderFilters {
    return {
      genres: { All: 'Anime' },
      sorters: super.formatFiltersFromServer(sorters, data).sorters,
    }
  }

  show(show: RawShow): Show {
    return this.formatShow(show)
  }
}
