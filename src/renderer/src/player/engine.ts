import { applySubtitleStyles, createVjs4Engine, type SubtitleStyleSettings } from './legacy-vjs4'
import { createVjs8Engine } from './vjs8'

/**
 * The version-neutral player surface the component depends on. It is deliberately smaller than
 * any one video.js player: adapters translate their library's API onto it, so swapping video.js 4
 * for video.js 8 (#55) does not leak either version's types into the component.
 */

export interface VideoEngineError {
  readonly code?: number
  readonly message?: string
}

export interface VideoEngineTextTrackCue {
  startTime: number
  endTime: number
  text?: string
}

/** A text track in the neutral shape the component uses: numeric modes, method accessors. */
export interface VideoEngineTextTrack {
  mode(): number
  label(): string
  cues(): VideoEngineTextTrackCue[]
  show(): void
  disable(): void
}

/** A subtitle the player should load when it mounts. */
export interface VideoEngineSubtitle {
  readonly src: string
  readonly label: string
  readonly language: string
  readonly default?: boolean
}

export interface VideoEngineSource {
  readonly src: string
  readonly type?: string
}

export interface VideoEngine {
  el(): HTMLElement
  ready(callback: () => void): void
  on(name: string, handler: (event?: unknown) => void): void
  trigger(name: string): void
  addClass(name: string): void
  dispose(): void
  play(): void
  pause(): void
  paused(): boolean
  volume(): number
  volume(value: number): void
  muted(): boolean
  muted(value: boolean): void
  playbackRate(): number
  playbackRate(rate: number): void
  currentTime(): number
  currentTime(value: number): void
  duration(): number
  currentSrc(): string
  error(): VideoEngineError | null
  error(value: null): void
  isFullscreen(): boolean
  requestFullscreen(): void
  exitFullscreen(): void
  textTracks(): VideoEngineTextTrack[]
  /** Loads one of the subtitles the stream advertised before the player mounts. */
  addSubtitle(subtitle: VideoEngineSubtitle): void
  /** Loads a subtitle the user added while playing (the legacy `Custom...` flow). */
  loadSubtitle(url: string): void
}

/**
 * What the component tells the adapter to play. Each adapter maps this onto its library's option
 * object, so `Player.tsx` no longer builds a video.js 4 option shape.
 */
export interface VideoEngineOptions {
  readonly sources: ReadonlyArray<VideoEngineSource>
  readonly autoplay: boolean
  readonly controls: boolean
  readonly preload: 'auto' | 'metadata' | 'none'
  /** Trailer mode: the adapter picks a YouTube-capable tech instead of the local plugins. */
  readonly trailer: boolean
}

export type VideoEngineId = 'vjs4' | 'vjs8'

export interface VideoEngineAdapter {
  readonly id: VideoEngineId
  create(element: HTMLElement, options: VideoEngineOptions): VideoEngine
}

export const VIDEO_ENGINES: Record<VideoEngineId, VideoEngineAdapter> = {
  vjs4: { id: 'vjs4', create: createVjs4Engine },
  vjs8: { id: 'vjs8', create: createVjs8Engine },
}

// video.js 4 stays the default until the vjs8 adapter matches it (skin parity, trailers and
// packaged-CSP subtitles — see #55). Select explicitly, or wire a setting later.
let selectedEngine: VideoEngineId = 'vjs4'

/** Selects the adapter every later `createVideoEngine` call uses. */
export function selectVideoEngine(id: VideoEngineId): void {
  selectedEngine = id
}

export function selectedVideoEngine(): VideoEngineId {
  return selectedEngine
}

export function createVideoEngine(element: HTMLElement, options: VideoEngineOptions): VideoEngine {
  return VIDEO_ENGINES[selectedEngine].create(element, options)
}

export type { SubtitleStyleSettings }
// Re-exported so the component imports everything player-engine-related from one module.
export { applySubtitleStyles }
