import type { Episode } from './media'

/**
 * The playback rules from the legacy player, isolated as pure functions so they carry no
 * React or DOM and can be tested directly. `Player.tsx` calls these instead of computing
 * them inside effect cleanups (where StrictMode timing made them untestable).
 */

/** The legacy watched threshold: playback past 80% of the duration counts as watched. */
export const WATCHED_THRESHOLD = 0.8

export function isWatched(position: number, duration: number): boolean {
  return (
    Number.isFinite(position) &&
    Number.isFinite(duration) &&
    duration > 0 &&
    position / duration >= WATCHED_THRESHOLD
  )
}

export interface WatchHistory {
  readonly title: string
  readonly time: number | false
}

/** `onPlayerReady`: resume only when the saved entry is for this exact title. */
export function resumeAt(title: string, history: WatchHistory): number | undefined {
  if (history.title !== title) return undefined
  if (typeof history.time !== 'number' || !Number.isFinite(history.time)) return undefined
  return history.time > 0 ? history.time : undefined
}

/** `closePlayer`: a watched title clears the resume point, otherwise it is `position - 5`. */
export function closeState(
  position: number,
  duration: number,
): { readonly watched: boolean; readonly resumeTime?: number } {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) {
    return { watched: false }
  }
  if (isWatched(position, duration)) return { watched: true }
  return position > 0
    ? { watched: false, resumeTime: Math.max(0, position - 5) }
    : { watched: false }
}

/** `checkAutoPlay`: within 60s of the end and not still in the opening 30s. */
export function nearEnd(position: number, duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && position > 30 && duration - position < 60
}

const same = (a: unknown, b: unknown) => String(a) === String(b)

/** `processNext`: the next episode in order, crossing a season boundary. */
export function nextEpisode(
  episodes: ReadonlyArray<Episode>,
  current: { readonly season: unknown; readonly episode: unknown },
): Episode | undefined {
  const index = episodes.findIndex(
    (episode) => same(episode.season, current.season) && same(episode.episode, current.episode),
  )
  return index === -1 ? undefined : episodes[index + 1]
}

/** The next episode is offered only when autoplay is on and "No thank you" was not pressed. */
export function autoplayPolicy(options: {
  readonly autoPlay: boolean
  readonly dismissed: boolean
}): boolean {
  return options.autoPlay && !options.dismissed
}

/**
 * The loopback MIME table, shared by the file server and the player: one place decides
 * what a file is served as, so the declared `type` and the `Content-Type` header agree.
 */
const LOOPBACK_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.srt': 'application/x-subrip',
  '.vtt': 'text/vtt',
}

/** The `Content-Type` the loopback server answers with for a file name. */
export function contentTypeForFile(name: string): string {
  const dot = name.lastIndexOf('.')
  return (
    (dot === -1 ? undefined : LOOPBACK_CONTENT_TYPES[name.slice(dot).toLowerCase()]) ??
    'application/octet-stream'
  )
}

/**
 * Containers Chromium cannot demux at all (AVI/DivX, WMV): the built-in player fails with
 * `MEDIA_ERR_SRC_NOT_SUPPORTED`, so these always need an external player. Other
 * containers (`.mkv`, `.mov`) may still play when the inner codec is supported, so they
 * try the built-in player first and fall back on its error banner instead.
 */
const EXTERNAL_ONLY_EXTENSIONS: ReadonlyArray<string> = ['.avi', '.wmv']

export function needsExternalPlayer(name: string): boolean {
  const lower = name.toLowerCase()
  return EXTERNAL_ONLY_EXTENSIONS.some((extension) => lower.endsWith(extension))
}
