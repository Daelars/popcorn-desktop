import type { Filters, MediaItem, Provider } from '../../shared'
import { ProviderError } from '../../shared/errors'

export const PROVIDER_ARG_TYPES = ['array', 'object', 'string', 'boolean', 'number'] as const
export type ProviderArgType = (typeof PROVIDER_ARG_TYPES)[number]

export interface ProviderArgs {
  readonly language?: string
  readonly contentLanguage?: string
  readonly contentLangOnly?: boolean
  readonly apiURL?: string | ReadonlyArray<string>
  readonly proxy?: string
  readonly args?: Record<string, unknown>
}

export interface ProviderConfig {
  readonly name: string
  readonly uniqueId: 'imdb_id' | 'tvdb_id'
  readonly tabName: string
  readonly type: 'movie' | 'tvshow' | 'anime'
  readonly metadata?: string
  readonly noShowAll?: boolean
  readonly args?: Record<string, ProviderArgType>
}

export interface ProviderPage<TItem> {
  readonly results: ReadonlyArray<TItem>
  readonly hasMore: boolean
}

/**
 * Coerces constructor args per the legacy ArgType table. The OBJECT branch is the
 * path that used to throw `JSON.Parse is not a function` on every call.
 */
export function processArgs(
  argTypes: Record<string, ProviderArgType>,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const processed: Record<string, unknown> = {}
  for (const [key, type] of Object.entries(argTypes)) {
    const value = args?.[key]
    if (value === undefined) continue
    switch (type) {
      case 'number':
        processed[key] = Number(value)
        break
      case 'array':
        processed[key] = String(value).split(',')
        break
      case 'object':
        processed[key] = JSON.parse(String(value)) as unknown
        break
      case 'boolean':
        processed[key] = Boolean(value)
        break
      case 'string':
        processed[key] = String(value)
        break
    }
  }
  return processed
}

function shuffle<T>(values: ReadonlyArray<T>): T[] {
  const copy = [...values]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = copy[i] as T
    const b = copy[j] as T
    copy[i] = b
    copy[j] = a
  }
  return copy
}

export abstract class BaseProvider<TItem extends MediaItem> {
  readonly config: ProviderConfig

  protected apiUrls: string[]
  protected readonly language: string
  protected readonly contentLanguage: string
  protected readonly contentLangOnly: boolean
  protected readonly proxy: string
  readonly args: Record<string, unknown>

  constructor(config: ProviderConfig, args: ProviderArgs = {}) {
    this.config = config
    this.language = args.language ?? ''
    this.contentLanguage = args.contentLanguage ?? this.language
    this.contentLangOnly = args.contentLangOnly ?? false
    this.proxy = args.proxy ?? ''
    this.args = processArgs(this.config.args ?? {}, args.args)
    this.apiUrls =
      args.apiURL === undefined
        ? []
        : shuffle(
            typeof args.apiURL === 'string'
              ? args.apiURL
                  .split(',')
                  .map((u) => u.trim())
                  .filter(Boolean)
              : args.apiURL,
          )
  }

  protected buildRequest(baseUrl: string, uri: string): { url: string; options: RequestInit } {
    const options: RequestInit = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux) AppleWebkit/534.30 (KHTML, like Gecko) PT/4.4.0',
      },
    }
    const match = /^cloudflare\+(.*):\/\/(.*)\//.exec(baseUrl)
    if (match !== null) {
      baseUrl = `${match[1]}://cloudflare.com/`
      ;(options.headers as Record<string, string>).Host = match[2] as string
    }
    return { url: baseUrl + uri, options }
  }

  /** Tries each API URL in order, rotating the list so the next call starts at the winner. */
  protected async get(
    index: number,
    uri: string,
    alternate?: ReadonlyArray<string>,
  ): Promise<unknown> {
    const base = alternate?.[index] ?? this.apiUrls[index]
    if (base === undefined) {
      throw new ProviderError({
        provider: this.config.name,
        operation: 'request',
        message: 'no API URL configured',
      })
    }
    const request = this.buildRequest(base, uri)
    try {
      const response = await fetch(request.url, request.options)
      if (response.ok) {
        if (index > 0) {
          this.apiUrls = this.apiUrls.slice(index).concat(this.apiUrls.slice(0, index))
        }
        return (await response.json()) as unknown
      }
    } catch (cause) {
      if (index + 1 >= this.apiUrls.length) {
        throw new ProviderError({
          provider: this.config.name,
          operation: 'request',
          message: `all API endpoints failed for ${uri}`,
          cause,
        })
      }
      return this.get(index + 1, uri)
    }
    if (index + 1 >= this.apiUrls.length) {
      throw new ProviderError({
        provider: this.config.name,
        operation: 'request',
        message: `all API endpoints failed for ${uri}`,
      })
    }
    return this.get(index + 1, uri)
  }

  abstract fetch(filters: Filters): Promise<ProviderPage<TItem>>

  abstract formatFilters(): Promise<ProviderFilters>

  feature(name: string): boolean {
    return name === 'torrents'
  }

  extractIds(items: ProviderPage<TItem>): string[] {
    return items.results.map((item) =>
      String((item as unknown as Record<string, unknown>)[this.config.uniqueId]),
    )
  }

  toProvider(): Provider {
    return {
      name: this.config.name,
      type: this.config.type,
      uniqueId: this.config.uniqueId,
      tabName: this.config.tabName,
      ...(this.config.metadata === undefined ? {} : { metadata: this.config.metadata }),
      ...(this.config.noShowAll === undefined ? {} : { noShowAll: this.config.noShowAll }),
    }
  }
}

export interface ProviderFilters {
  readonly genres: Record<string, string>
  readonly sorters: Record<string, string>
  readonly kinds?: Record<string, string>
  readonly types?: Record<string, string>
  readonly ratings?: Record<string, string>
}
