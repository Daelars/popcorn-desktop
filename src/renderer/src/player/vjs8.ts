import videojs8 from 'videojs8'
import type Player from 'videojs8/dist/types/player'
import type {
  VideoEngine,
  VideoEngineOptions,
  VideoEngineSubtitle,
  VideoEngineTextTrack,
  VideoEngineTextTrackCue,
} from './engine'

/**
 * Video.js 8 adapter. It normalises video.js 8 onto the neutral `VideoEngine` interface: v8
 * exposes DOM-style text tracks (string modes and properties rather than method accessors), and
 * its shipped typings do not describe the track fields this adapter reads.
 *
 * It is selectable but not the default until it matches the video.js 4 adapter — see #55 for the
 * remaining skin, trailer (`videojs-youtube` is v4-only) and packaged-CSP subtitle work.
 */

/** The video.js 8 text track fields the adapter reads; v8's typings omit them. */
interface Vjs8TextTrack {
  readonly label: string
  mode: number | string
  readonly cues: ArrayLike<Vjs8Cue> | null
}

interface Vjs8Cue {
  readonly startTime: number
  readonly endTime: number
  readonly text?: string
}

const MODE_DISABLED = 0
const MODE_HIDDEN = 1
const MODE_SHOWING = 2

function toModeNumber(mode: number | string): number {
  if (typeof mode === 'number') return mode
  if (mode === 'showing') return MODE_SHOWING
  if (mode === 'hidden') return MODE_HIDDEN
  return MODE_DISABLED
}

function toNeutralCue(cue: Vjs8Cue): VideoEngineTextTrackCue {
  return {
    startTime: cue.startTime,
    endTime: cue.endTime,
    ...(cue.text === undefined ? {} : { text: cue.text }),
  }
}

function toNeutralTrack(track: Vjs8TextTrack): VideoEngineTextTrack {
  return {
    mode: () => toModeNumber(track.mode),
    label: () => track.label,
    cues: () => (track.cues === null ? [] : Array.from(track.cues, toNeutralCue)),
    show: () => {
      track.mode = 'showing'
    },
    disable: () => {
      track.mode = 'disabled'
    },
  }
}

/** v8 wants a DOM-style options object; trailer mode still needs a v8 YouTube tech (see #55). */
function toVjs8Options(options: VideoEngineOptions): Record<string, unknown> {
  return {
    controls: options.controls,
    autoplay: options.autoplay,
    preload: options.preload,
    sources: options.sources,
    ...(options.trailer ? { techOrder: ['youtube'] } : {}),
  }
}

/** The `.track` field v8 omits from the element its `addRemoteTextTrack` returns. */
interface Vjs8RemoteTrack {
  track: { mode: string }
}

/** Adds a remote `<track>` through v8's DOM-style API and hands back its text track. */
function addRemoteSubtitle(
  player: Player,
  subtitle: VideoEngineSubtitle,
): Vjs8RemoteTrack['track'] {
  const element = player.addRemoteTextTrack(
    {
      kind: 'subtitles',
      label: subtitle.label,
      language: subtitle.language,
      src: subtitle.src,
      default: subtitle.default === true,
    },
    // The custom subtitle is replaced by the next one, so it is ours to clean up.
    true,
  )
  return (element as unknown as Vjs8RemoteTrack).track
}

export function createVjs8Engine(element: HTMLElement, options: VideoEngineOptions): VideoEngine {
  const player = videojs8(element, toVjs8Options(options))
  let customSubtitle: Vjs8RemoteTrack['track'] | null = null
  return {
    el: () => player.el() as HTMLElement,
    ready: (callback) => player.ready(callback),
    on: (name, handler) => player.on(name, handler),
    trigger: (name) => player.trigger(name),
    addClass: (name) => player.addClass(name),
    dispose: () => player.dispose(),
    play: () => {
      void player.play()
    },
    pause: () => player.pause(),
    paused: () => player.paused(),
    volume: (value?: number) => player.volume(value) ?? 1,
    muted: (value?: boolean) => player.muted(value) ?? false,
    playbackRate: (rate?: number) => player.playbackRate(rate) ?? 1,
    currentTime: (value?: number) => {
      if (value !== undefined) player.currentTime(value)
      return player.currentTime() ?? 0
    },
    duration: () => player.duration() ?? Number.NaN,
    currentSrc: () => player.currentSrc(),
    error: (value?: null) => {
      if (value === null) {
        player.error(null)
        return null
      }
      return player.error() ?? null
    },
    isFullscreen: () => player.isFullscreen() === true,
    requestFullscreen: () => {
      void player.requestFullscreen()
    },
    exitFullscreen: () => {
      void player.exitFullscreen()
    },
    textTracks: () => player.textTracks().tracks_.map(toNeutralTrack),
    addSubtitle: (subtitle) => {
      addRemoteSubtitle(player, subtitle)
    },
    loadSubtitle: (url) => {
      // One custom subtitle at a time, like the legacy menu item replaced the previous one.
      if (customSubtitle !== null) customSubtitle.mode = 'disabled'
      customSubtitle = addRemoteSubtitle(player, { src: url, label: 'Custom...', language: '00' })
      customSubtitle.mode = 'showing'
    },
  }
}
