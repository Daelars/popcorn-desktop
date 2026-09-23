import { useEffect } from 'react'

export type FilterKind = 'contrast' | 'brightness' | 'hue' | 'saturation'

export interface PlayerKeyActions {
  readonly close: () => void
  readonly togglePlay: () => void
  readonly toggleFullscreen: () => void
  readonly toggleMute: () => void
  readonly toggleCrop: () => void
  readonly toggleSubtitles: () => void
  readonly seekBy: (seconds: number) => void
  readonly volumeBy: (delta: number) => void
  readonly zoomBy: (delta: number) => void
  readonly filter: (kind: FilterKind, delta: number) => void
  readonly playbackRate: (rate: number, delta: boolean) => void
  readonly subtitleOffsetBy: (seconds: number) => void
  readonly scaleWindow: (scale: number) => void
  /** Held Ctrl makes the subtitle element draggable, as the legacy Mousetrap binding did. */
  readonly subtitleDrag: (enabled: boolean) => void
}

/**
 * The legacy `bindKeyboardShortcuts` map from `player.js`. Modifier combinations follow the
 * original: plain/shift/ctrl change the step size, `w`/`e` zoom, `shift+1..8` are filters.
 */
export function usePlayerKeys(actions: PlayerKeyActions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return
      }
      const shift = event.shiftKey
      const ctrl = event.ctrlKey
      const seek = shift ? 60 : ctrl ? 600 : 5
      const volume = shift ? 0.5 : ctrl ? 1 : 0.1
      switch (event.key) {
        case 'Escape':
        case 'Backspace':
          event.preventDefault()
          actions.close()
          break
        case ' ':
        case 'p':
          event.preventDefault()
          actions.togglePlay()
          break
        case 'f':
          actions.toggleFullscreen()
          break
        case 'm':
          actions.toggleMute()
          break
        case 'c':
          actions.toggleCrop()
          break
        case 'v':
          actions.toggleSubtitles()
          break
        case 'ArrowRight':
          event.preventDefault()
          actions.seekBy(seek)
          break
        case 'ArrowLeft':
          event.preventDefault()
          actions.seekBy(-seek)
          break
        case 'ArrowUp':
          event.preventDefault()
          actions.volumeBy(volume)
          break
        case 'ArrowDown':
          event.preventDefault()
          actions.volumeBy(-volume)
          break
        case 'w':
          if (!shift && !ctrl) actions.zoomBy(-0.05)
          break
        case 'e':
          if (!shift && !ctrl) actions.zoomBy(0.05)
          break
        case 'h':
          actions.subtitleOffsetBy(ctrl ? -5 : shift ? -1 : -0.1)
          break
        case 'g':
          actions.subtitleOffsetBy(ctrl ? 5 : shift ? 1 : 0.1)
          break
        case 'j':
          if (shift || ctrl) actions.playbackRate(0.5, false)
          else actions.playbackRate(-0.1, true)
          break
        case 'k':
          actions.playbackRate(1, false)
          break
        case 'l':
          if (shift) actions.playbackRate(2, false)
          else if (ctrl) actions.playbackRate(4, false)
          else actions.playbackRate(0.1, true)
          break
        case '0':
          actions.scaleWindow(0.5)
          break
        case '1':
          if (shift) actions.filter('contrast', -0.05)
          else actions.scaleWindow(1)
          break
        case '2':
          if (shift) actions.filter('contrast', 0.05)
          else actions.scaleWindow(2)
          break
        case '3':
          if (shift) actions.filter('brightness', -0.05)
          break
        case '4':
          if (shift) actions.filter('brightness', 0.05)
          break
        case '5':
          if (shift) actions.filter('hue', -1)
          break
        case '6':
          if (shift) actions.filter('hue', 1)
          break
        case '7':
          if (shift) actions.filter('saturation', -0.05)
          break
        case '8':
          if (shift) actions.filter('saturation', 0.05)
          break
        case 'Control':
          actions.subtitleDrag(true)
          break
        default:
          break
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') actions.subtitleDrag(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [actions])
}
