/**
 * The video.js 4 API surface the player uses. The package ships no types, and the legacy
 * app loaded `video.dev.js` as a script, so the library exposes itself as `window.videojs`;
 * this declares the globals and the side-effect import.
 */
interface VideoJsError {
  readonly code?: number
  readonly message?: string
}

interface VideoJsControlBarChild {
  name(): string
  show(): void
  el(): HTMLElement
  menu: { addItem(item: unknown): void }
}

interface VideoJsPlayer {
  el(): HTMLElement
  ready(callback: () => void): void
  on(name: string, handler: (event?: unknown) => void): void
  trigger(name: string): void
  addClass(name: string): void
  removeClass(name: string): void
  isFullscreen(): boolean
  requestFullscreen(): void
  exitFullscreen(): void
  volume(): number
  volume(value: number): VideoJsPlayer
  muted(): boolean
  muted(value: boolean): VideoJsPlayer
  paused(): boolean
  play(): void
  pause(): void
  playbackRate(): number
  playbackRate(rate: number): VideoJsPlayer
  textTracks(): VideoJsTextTrack[]
  showTextTrack(id: string, kind?: string): VideoJsPlayer
  currentTime(): number
  currentTime(value: number): void
  duration(): number
  currentSrc(): string
  error(): VideoJsError | null
  error(value: null): void
  dispose(): void
  addTextTrack(
    kind: string,
    label: string,
    language: string,
    options?: { src?: string; dflt?: boolean },
  ): unknown
  controlBar: {
    el(): HTMLElement
    children(): ReadonlyArray<VideoJsControlBarChild>
    progressControl: {
      el(): HTMLElement
      seekBar: { calculateDistance(event: MouseEvent): number }
    }
    playToggle: { el(): HTMLElement }
  }
}

type VideoJsComponentConstructor = {
  new (...args: unknown[]): unknown
  prototype: Record<string, unknown>
}

interface VideoJsTextTrackCue {
  startTime: number
  endTime: number
  text?: string
}

interface VideoJsTextTrack {
  id(): string
  kind(): string
  label(): string
  language(): string
  src(): string
  mode(): number
  cues(): VideoJsTextTrackCue[]
  show(): void
  disable(): void
  el?(): HTMLElement
}

interface VideoJsStatic {
  (element: HTMLElement | string, options?: Record<string, unknown>): VideoJsPlayer
  plugin(name: string, handler: (this: VideoJsPlayer, ...args: unknown[]) => void): void
  options: Record<string, unknown>
  Player: { prototype: Record<string, unknown> }
  Component: {
    extend(proto: Record<string, unknown>): VideoJsComponentConstructor
    call(context: unknown, ...args: unknown[]): void
    prototype: Record<string, unknown>
  }
  Button: {
    extend(proto: Record<string, unknown>): VideoJsComponentConstructor
    prototype: Record<string, unknown>
  }
  MenuItem: {
    extend(proto: Record<string, unknown>): VideoJsComponentConstructor
    prototype: Record<string, unknown>
  }
  TextTrack: { prototype: Record<string, unknown> }
  TextTrackMenuItem: {
    extend(proto: Record<string, unknown>): {
      new (...args: unknown[]): unknown
      prototype: { onClick: (this: unknown) => void }
    }
    call(context: unknown, ...args: unknown[]): void
    prototype: { onClick: (this: unknown) => void }
  }
  ErrorDisplay: { prototype: Record<string, unknown> }
  MediaTechController: { prototype: Record<string, unknown> }
}

interface Window {
  videojs: VideoJsStatic
  _V_?: VideoJsStatic
}

declare module 'video.js/dist/video-js/video.dev.js' {}
