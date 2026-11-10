import type { PopcornBridge } from '../../shared/ipc'

/** Raised when the renderer runs outside Electron and no bridge has been installed. */
export class BridgeUnavailableError extends Error {
  readonly _tag = 'BridgeUnavailableError'
  constructor() {
    super('window.popcorn is unavailable; the renderer is not running under Electron')
  }
}

/**
 * The one IPC accessor. It throws a typed error instead of making every caller guard for a
 * missing bridge, which is how the `window.popcorn === undefined` checks spread.
 */
export function popcorn(): PopcornBridge {
  const bridge = window.popcorn
  if (bridge === undefined) throw new BridgeUnavailableError()
  return bridge
}
