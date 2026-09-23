/** Shared release-name parsing for the torrent providers (apibay and nyaa both used copies). */
export const QUALITY = /\b(2160p|1440p|1080p|720p|480p|360p)\b/i
export const YEAR = /\b(19\d{2}|20\d{2})\b/
/** Chromium cannot decode HEVC, so those releases would never play. */
const UNPLAYABLE = /\b(x265|h265|hevc)\b/i

export function isPlayable(name: string): boolean {
  return !UNPLAYABLE.test(name)
}

export function qualityOf(name: string): string {
  const match = QUALITY.exec(name)
  return match?.[1]?.toLowerCase() ?? '1080p'
}

export function yearOf(name: string): number {
  const match = YEAR.exec(name)
  return match?.[1] === undefined ? new Date().getFullYear() : Number(match[1])
}

export function magnetOf(item: { readonly info_hash?: string; readonly name?: string }): string {
  return `magnet:?xt=urn:btih:${item.info_hash ?? ''}&dn=${encodeURIComponent(item.name ?? '')}`
}

/** The info hash keeps the cache key and the detail route stable for a title with no IMDb id. */
export function imdbIdOf(item: { readonly imdb?: string; readonly info_hash?: string }): string {
  if (item.imdb?.startsWith('tt') === true) return item.imdb
  return `tt${String(item.info_hash ?? '').slice(0, 7)}`
}

export function imdbIdFromMagnet(magnet: string): string {
  const hash = /btih:([0-9a-z]+)/i.exec(magnet)?.[1]?.toLowerCase() ?? magnet
  return `tt${hash.slice(0, 7)}`
}
