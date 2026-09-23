import { gunzipSync, inflateSync } from 'node:zlib'
import AdmZip from 'adm-zip'
import * as chardet from 'chardet'
import { Effect } from 'effect'
import iconv from 'iconv-lite'
import { SubtitleError } from '../../shared/errors'
import { srtToVtt } from './convert'
import { call, userAgent } from './xmlrpc'

/**
 * The OpenSubtitles provider, from `providers/opensubtitles.js`: search by imdb id with a
 * useragent string and optional credentials, then `formatForButter`'s language map of
 * download urls. `generic.js` supplied the download/decompress/decode half.
 */

export const ENDPOINT = 'https://api.opensubtitles.org/xml-rpc'

/** The provider endpoint, overridable so a local stub can stand in for the real service. */
export function endpointFromEnv(): string {
  return process.env.POPCORN_OPENSUBTITLES_API ?? ENDPOINT
}

/** `SubLanguageID` is ISO 639-2; the dropdown flags and locales want two letters. */
const LANGUAGE_CODES: Readonly<Record<string, string>> = {
  alb: 'sq',
  ara: 'ar',
  arm: 'hy',
  baq: 'eu',
  ben: 'bn',
  bos: 'bs',
  bul: 'bg',
  cat: 'ca',
  chi: 'zh',
  cze: 'cs',
  dan: 'da',
  dut: 'nl',
  ell: 'el',
  eng: 'en',
  est: 'et',
  fin: 'fi',
  fre: 'fr',
  geo: 'ka',
  ger: 'de',
  glg: 'gl',
  heb: 'he',
  hin: 'hi',
  hrv: 'hr',
  hun: 'hu',
  ice: 'is',
  ind: 'id',
  ita: 'it',
  jpn: 'ja',
  kan: 'kn',
  kaz: 'kk',
  khm: 'km',
  kor: 'ko',
  lav: 'lv',
  lit: 'lt',
  mac: 'mk',
  mal: 'ml',
  may: 'ms',
  mon: 'mn',
  nor: 'no',
  per: 'fa',
  pob: 'pb',
  pol: 'pl',
  por: 'pt',
  rum: 'ro',
  rus: 'ru',
  scc: 'sr',
  sin: 'si',
  slo: 'sk',
  slv: 'sl',
  spa: 'es',
  swe: 'sv',
  syr: 'sy',
  tam: 'ta',
  tel: 'te',
  tgl: 'tl',
  tha: 'th',
  tur: 'tr',
  ukr: 'uk',
  urd: 'ur',
  vie: 'vi',
  zhe: 'zh',
  zht: 'zt',
}

function languageCode(sublanguageid: string): string {
  const id = sublanguageid.toLowerCase()
  return LANGUAGE_CODES[id] ?? id.slice(0, 2)
}

/** `normalizeLangCodes`: OpenSubtitles spells Brazilian Portuguese `pb`. */
function normalizeLangCodes(data: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    const normalized = key
      .split('|')
      .map((part) => (part === 'pb' ? 'pt-br' : part))
      .join('|')
    result[normalized] = value
  }
  return result
}

let token: string | undefined
let searchCache: { imdbId: string; subtitles: Record<string, string> } | undefined

function credentials(username: string, password: string) {
  return { username: username === '' ? '' : username, password: password === '' ? '' : password }
}

function login(
  endpoint: string,
  username: string,
  password: string,
): Effect.Effect<string, SubtitleError> {
  return call(endpoint, 'LogIn', [username, password, 'en', userAgent]).pipe(
    Effect.flatMap((response) => {
      const record = response as { status?: string; token?: string } | undefined
      if (record?.token === undefined) {
        return Effect.fail(
          new SubtitleError({
            message: `OpenSubtitles login failed (${record?.status ?? 'no token'})`,
            source: 'opensubtitles',
          }),
        )
      }
      return Effect.succeed(record.token)
    }),
  )
}

/** `OpenSubtitles.prototype.fetch`: `SearchSubtitles` with `limit: all`, grouped per language. */
export function searchSubtitles(options: {
  readonly imdbId: string
  readonly username: string
  readonly password: string
  readonly endpoint?: string
}): Effect.Effect<Record<string, string>, SubtitleError> {
  const endpoint = options.endpoint ?? endpointFromEnv()
  return Effect.gen(function* () {
    // apibay items without an IMDb id get a synthetic `tt<hash>` key; OpenSubtitles only
    // accepts numeric ids, so those titles simply have no provider subtitles.
    if (!/^tt\d+$/.test(options.imdbId)) return {}
    if (searchCache !== undefined && searchCache.imdbId === options.imdbId) {
      return searchCache.subtitles
    }
    const credentials_ = credentials(options.username, options.password)
    const session = token ?? (yield* login(endpoint, credentials_.username, credentials_.password))
    token = session

    const response = yield* call(endpoint, 'SearchSubtitles', [
      session,
      [{ sublanguageid: 'all', imdbid: options.imdbId.replace('tt', ''), limit: 'all' }],
    ])
    const record = response as { status?: string; data?: unknown } | undefined
    if (record?.status !== undefined && record.status !== '200 OK') {
      token = undefined
      return yield* Effect.fail(
        new SubtitleError({ message: `search failed (${record.status})`, source: 'opensubtitles' }),
      )
    }
    const entries = Array.isArray(record?.data) ? record.data : []
    const grouped = new Map<string, Array<{ url: string; format: string }>>()
    for (const entry of entries) {
      const row = entry as Record<string, unknown>
      const url = typeof row.SubDownloadLink === 'string' ? row.SubDownloadLink : ''
      const language = typeof row.SubLanguageID === 'string' ? row.SubLanguageID : ''
      const format = typeof row.SubFormat === 'string' ? row.SubFormat : ''
      if (url === '' || language === '') continue
      const code = languageCode(language)
      grouped.set(code, [...(grouped.get(code) ?? []), { url, format }])
    }

    // `formatForButter`: the first subtitle keeps the plain language, the rest get `|2`, `|3`.
    const subtitles: Record<string, string> = {}
    for (const [code, entries_] of grouped) {
      const seen = new Set<string>()
      let index = 1
      for (const entry of entries_) {
        if (seen.has(entry.url)) continue
        seen.add(entry.url)
        subtitles[index === 1 ? code : `${code}|${index}`] = entry.url
        index += 1
      }
    }
    const normalized = normalizeLangCodes(subtitles)
    searchCache = { imdbId: options.imdbId, subtitles: normalized }
    return normalized
  })
}

/** The `SubDownloadLink` urls are gzipped; `.zip` archives and plain `.srt` also showed up. */
function decompress(buffer: Buffer, contentType: string): Buffer {
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) return gunzipSync(buffer)
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const archive = new AdmZip(buffer)
    const entry = archive
      .getEntries()
      .find((candidate) => /\.(srt|vtt)$/i.test(candidate.entryName) && !candidate.isDirectory)
    if (entry === undefined) throw new Error('no subtitle file in the archive')
    return archive.readFile(entry) ?? entry.getData()
  }
  if (contentType.includes('zip')) return inflateSync(buffer)
  return buffer
}

/** `generic.js`: charset detection, then an `.srt` is converted and everything becomes VTT. */
export function subtitleText(buffer: Buffer, contentType = ''): string {
  const decompressed = decompress(buffer, contentType)
  const detected = chardet.detect(decompressed) ?? 'utf8'
  const text = iconv.decode(decompressed, detected)
  return /^WEBVTT/m.test(text) ? text : srtToVtt(text)
}

export function downloadSubtitle(url: string): Effect.Effect<string, SubtitleError> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        headers: { 'User-Agent': userAgent },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      return subtitleText(buffer, response.headers.get('content-type') ?? '')
    },
    catch: (cause) => new SubtitleError({ message: `cannot download ${url}`, source: url, cause }),
  })
}

/** The player asks for one language; the search result is cached per imdb id. */
export function fetchSubtitle(options: {
  readonly imdbId: string
  readonly lang: string
  readonly username: string
  readonly password: string
}): Effect.Effect<string, SubtitleError> {
  return Effect.gen(function* () {
    const subtitles = yield* searchSubtitles(options)
    const url = subtitles[options.lang] ?? subtitles[options.lang.split('|')[0] ?? options.lang]
    if (url === undefined) {
      return yield* Effect.fail(
        new SubtitleError({ message: `no ${options.lang} subtitle`, source: options.imdbId }),
      )
    }
    return yield* downloadSubtitle(url)
  })
}

export function resetSession(): void {
  token = undefined
  searchCache = undefined
}
