import { Effect } from 'effect'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/ipc'

/**
 * Auto-update. The legacy `updater.js` only compared version numbers against the GitHub
 * release and told the user to download the new build; electron-updater keeps that manual
 * check from the About page and adds the download and install half.
 */

/** The bits of `electron-updater` this service uses; a fake can drive the states in tests. */
export interface UpdatePort {
  readonly checkForUpdates: () => Promise<unknown>
  readonly downloadUpdate: () => Promise<unknown>
  readonly quitAndInstall: () => void
  readonly on: (listener: (status: UpdateStatus) => void) => void
}

export interface UpdatesShape {
  readonly check: (manual: boolean) => Effect.Effect<void>
  readonly download: () => Effect.Effect<void>
  readonly install: () => Effect.Effect<void>
}

/** The real port: `electron-updater` is only used from a packaged app. */
export function createAutoUpdaterPort(): UpdatePort {
  autoUpdater.autoDownload = false
  // The updater is silent by default; its messages belong in the app log.
  autoUpdater.logger = console
  // An accepted update is installed when the app quits, which is what the legacy prompt said.
  autoUpdater.autoInstallOnAppQuit = true
  const override = process.env.POPCORN_UPDATE_URL
  if (override !== undefined) {
    // An unpacked run has no `app-update.yml`; dev mode plus the override stand in for it.
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.setFeedURL({ provider: 'generic', url: override })
  }
  return {
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    // Silent, and relaunch afterwards: that is the flow the NSIS installer expects.
    quitAndInstall: () => autoUpdater.quitAndInstall(true, true),
    on: (listener) => {
      autoUpdater.on('checking-for-update', () => listener({ state: 'checking' }))
      autoUpdater.on('update-available', (info) =>
        listener({ state: 'available', version: info.version }),
      )
      autoUpdater.on('update-not-available', () => listener({ state: 'latest' }))
      autoUpdater.on('download-progress', (progress) =>
        listener({ state: 'downloading', percent: Math.round(progress.percent) }),
      )
      autoUpdater.on('update-downloaded', (info) =>
        listener({ state: 'ready', version: info.version }),
      )
      autoUpdater.on('error', (error) => listener({ state: 'error', message: error.message }))
    },
  }
}

/**
 * Drives the updater and publishes every state. Without a port (an unpacked run) a manual
 * check reports `unsupported`, and the automatic check stays silent.
 */
export function createUpdates(
  port: UpdatePort | undefined,
  publish: (status: UpdateStatus) => void,
): UpdatesShape {
  port?.on(publish)
  return {
    check: (manual) =>
      Effect.suspend(() => {
        if (port === undefined) {
          if (manual) publish({ state: 'unsupported' })
          return Effect.void
        }
        publish({ state: 'checking' })
        // Failures also arrive as `error` events; this keeps a rejection from escaping.
        return Effect.tryPromise({
          try: () => port.checkForUpdates().then(() => undefined),
          catch: (cause) => cause,
        }).pipe(Effect.ignore)
      }),
    download: () =>
      port === undefined
        ? Effect.void
        : Effect.tryPromise({
            try: () => port.downloadUpdate().then(() => undefined),
            catch: (cause) => cause,
          }).pipe(Effect.ignore),
    install: () => Effect.sync(() => port?.quitAndInstall()),
  }
}
