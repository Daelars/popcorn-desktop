import {
  applySubtitleStyles,
  installLegacyPlayer,
  loadCustomSubtitle,
  type SubtitleStyleSettings,
} from './legacy-vjs4'
import videojs from './videojs'

/**
 * The player surface the component needs. It is the video.js 4 player type, so the adapter
 * can hand the real instance back; a video.js 8 adapter (#55) implements the same surface.
 */
export type VideoEngine = ReturnType<typeof videojs>

/**
 * Creates a video.js 4 engine. Installing the legacy prototype patches happens here, so the
 * component imports no video.js symbol and the monkey-patching stays behind this seam.
 */
export function createVideoEngine(
  element: HTMLElement,
  options: Parameters<typeof videojs>[1],
): VideoEngine {
  installLegacyPlayer()
  return videojs(element, options)
}

export type { SubtitleStyleSettings }
// Re-exported so the component imports everything player-engine-related from one module.
export { applySubtitleStyles, loadCustomSubtitle }
