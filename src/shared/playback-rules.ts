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
