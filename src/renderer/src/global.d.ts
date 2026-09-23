import type { PopcornBridge } from '../../shared/ipc'

declare global {
  interface Window {
    readonly popcorn: PopcornBridge
  }
}
