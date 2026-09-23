import { Context, Duration, Effect, Layer } from 'effect'
import { ProviderError } from '../shared/errors'
import type { SettingsKey } from '../shared/settings'
import { SettingsService } from './settings'

/** One torrent from an online search, normalised across providers. */
export interface TorrentResult {
  readonly title: string
  readonly magnet: string
  readonly size: string
  readonly seeds: number
  readonly peers: number
  readonly provider: string
  readonly source: string
}

export interface SearchProvider {
  readonly id: string
  readonly name: string
  /** The settings key that turns this provider on. */
  readonly setting: SettingsKey
  readonly search: (
    query: string,
    category: string,
  ) => Effect.Effect<ReadonlyArray<TorrentResult>, ProviderError>
}

export interface SearchOutcome {
  readonly results: ReadonlyArray<TorrentResult>
  /** Per-provider counts, for the "N results" labels on the engine toggles. */
  readonly counts: Readonly<Record<string, number>>
  /** Providers that failed, so the UI can say so instead of looking empty. */
  readonly failures: ReadonlyArray<{ readonly provider: string; readonly message: string }>
}

const USER_AGENT = 'Popcorn Time'

/** The legacy search categories; providers map them onto their own codes. */
export const SEARCH_CATEGORIES = ['Movies', 'Series', 'Anime'] as const

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

function fail(provider: string, message: string, cause?: unknown): ProviderError {
  return new ProviderError({ provider, operation: 'search', message, ...(cause ? { cause } : {}) })
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json' },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.text()
}

interface ApibayEntry {
  readonly id?: string
  readonly name?: string
  readonly info_hash?: string
  readonly seeders?: string
  readonly leechers?: string
  readonly size?: string
}

const TPB_CATEGORY: Readonly<Record<string, string>> = {
  Movies: '207',
  Series: '205',
  Anime: '0',
}

/** The Pirate Bay through apibay's JSON endpoint, which is far steadier than its HTML. */
export const pirateBayProvider: SearchProvider = {
  id: 'thepiratebay',
  name: 'thepiratebay.org',
  setting: 'enableThepiratebaySearch',
  search: (query, category) =>
    Effect.tryPromise({
      try: async () => {
        const cat = TPB_CATEGORY[category] ?? '0'
        const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=${cat}`
        const body = await fetchText(url)
        const entries = JSON.parse(body) as ReadonlyArray<ApibayEntry>
        return entries.flatMap((entry) => {
          if (
            entry.info_hash === undefined ||
            entry.info_hash === '0000000000000000000000000000000000000000'
          )
            return []
          const name = entry.name ?? entry.info_hash
          return [
            {
              title: name,
              magnet: `magnet:?xt=urn:btih:${entry.info_hash}&dn=${encodeURIComponent(name)}`,
              size: formatSize(Number(entry.size ?? 0)),
              seeds: Number(entry.seeders ?? 0),
              peers: Number(entry.leechers ?? 0),
              provider: 'thepiratebay.org',
              source:
                entry.id === undefined
                  ? 'https://thepiratebay.org/'
                  : `https://thepiratebay.org/description.php?id=${entry.id}`,
            },
          ]
        })
      },
      catch: (cause) => fail('thepiratebay', 'thepiratebay search failed', cause),
    }),
}

const NYAA_CATEGORY: Readonly<Record<string, string>> = {
  Movies: '0_0',
  Series: '0_0',
  Anime: '1_0',
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** nyaa.si has no API; each result is one `<tr>` with stable classes. */
export function parseNyaa(html: string): ReadonlyArray<TorrentResult> {
  const results: TorrentResult[] = []
  for (const row of html.split('<tr').slice(1)) {
    const viewId = /href="\/view\/(\d+)"/.exec(row)?.[1]
    const magnet = /href="(magnet:[^"]+)"/.exec(row)?.[1]
    const title = /href="\/view\/\d+"[^>]*title="([^"]*)"/.exec(row)?.[1]
    if (viewId === undefined || magnet === undefined || title === undefined) continue
    const size = /class="text-center">([\d.]+ (?:B|KiB|MiB|GiB|TiB))<\/td>/.exec(row)?.[1]
    // The numeric cells are comments, seeders, leechers; older layouts drop the first.
    const numbers = [...row.matchAll(/class="text-center">(\d+)<\/td>/g)].map((match) =>
      Number(match[1]),
    )
    results.push({
      title: decodeEntities(title),
      magnet: decodeEntities(magnet),
      size: size?.replace(/iB$/, 'B') ?? '',
      seeds: numbers.at(-2) ?? 0,
      peers: numbers.at(-1) ?? 0,
      provider: 'nyaa.si',
      source: `https://nyaa.si/view/${viewId}`,
    })
  }
  return results
}

export const nyaaProvider: SearchProvider = {
  id: 'nyaa',
  name: 'nyaa.si',
  setting: 'enableNyaaSearch',
  search: (query, category) =>
    Effect.tryPromise({
      try: async () => {
        const cat = NYAA_CATEGORY[category] ?? '0_0'
        const url = `https://nyaa.si/?f=0&c=${cat}&q=${encodeURIComponent(query)}`
        return parseNyaa(await fetchText(url))
      },
      catch: (cause) => fail('nyaa', 'nyaa search failed', cause),
    }),
}

/**
 * The providers the app can actually reach. The legacy table also listed 1337x,
 * solidtorrents and torrentgalaxy; those now answer 403, time out, or no longer resolve.
 */
export const SEARCH_PROVIDERS: ReadonlyArray<SearchProvider> = [pirateBayProvider, nyaaProvider]

/** Online torrent search across the providers the settings enable. */
export interface SearchServiceShape {
  readonly search: (query: string, category: string) => Effect.Effect<SearchOutcome>
}

export class SearchService extends Context.Tag('SearchService')<
  SearchService,
  SearchServiceShape
>() {}

export const SearchServiceLive = Layer.effect(
  SearchService,
  Effect.gen(function* () {
    const settings = yield* SettingsService
    return SearchService.of({
      search: (query, category) =>
        Effect.gen(function* () {
          const enabledKeys = yield* Effect.forEach(
            SEARCH_PROVIDERS,
            (provider) =>
              Effect.map(settings.get(provider.setting), (value) => [provider.id, value] as const),
            { concurrency: 'unbounded' },
          )
          const enabled = new Map(enabledKeys)
          return yield* searchTorrents(
            SEARCH_PROVIDERS,
            (provider) => enabled.get(provider.id) !== false,
            query,
            category,
          )
        }),
    })
  }),
)

function infoHashOf(magnet: string): string {
  const match = /btih:([0-9a-z]+)/i.exec(magnet)
  return match?.[1]?.toLowerCase() ?? magnet
}

/** Runs the enabled providers in parallel, dedupes by info hash and sorts by seeds. */
export function searchTorrents(
  providers: ReadonlyArray<SearchProvider>,
  enabled: (provider: SearchProvider) => boolean,
  query: string,
  category: string,
): Effect.Effect<SearchOutcome> {
  const active = providers.filter(enabled)
  return Effect.forEach(
    active,
    (provider) =>
      provider.search(query, category).pipe(
        Effect.timeout(Duration.seconds(8)),
        Effect.map((results) => ({ provider, results, failure: undefined as string | undefined })),
        Effect.catchAll((error) =>
          Effect.succeed({
            provider,
            results: [] as ReadonlyArray<TorrentResult>,
            failure: error.message,
          }),
        ),
      ),
    { concurrency: 'unbounded' },
  ).pipe(
    Effect.map((outcomes) => {
      const seen = new Map<string, TorrentResult>()
      const counts: Record<string, number> = {}
      const failures: Array<{ provider: string; message: string }> = []
      for (const outcome of outcomes) {
        counts[outcome.provider.id] = outcome.results.length
        if (outcome.failure !== undefined) {
          failures.push({ provider: outcome.provider.id, message: outcome.failure })
        }
        for (const result of outcome.results) {
          const hash = infoHashOf(result.magnet)
          if (!seen.has(hash)) seen.set(hash, result)
        }
      }
      return {
        results: [...seen.values()].sort((left, right) => right.seeds - left.seeds),
        counts,
        failures,
      }
    }),
  )
}
