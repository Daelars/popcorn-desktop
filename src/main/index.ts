import { homedir } from 'node:os'
import { join } from 'node:path'
import { Effect, ManagedRuntime, Schedule, Stream } from 'effect'
import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron'
import { makeAppLayer } from './app'
import { createEventPublisher, registerIpc } from './ipc'
import { resolveLegacyProfileRoot } from './migration'
import { type SettingsEnvironment, SettingsService } from './settings'
import { StreamManager } from './streams'
import { createAutoUpdaterPort, UpdatesService } from './updates'
import { zoomLevelFor } from './window'

const RELEASE_NAME = 'Now.. Bring me that Horizon'

/** The one push-event sender; every `webContents.send` in the process goes through it. */
const publisher = createEventPublisher((channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
})

// The play smoke test is driven from outside over CDP, which needs a debugging port;
// POPCORN_CDP opens the same port without the smoke drive, for interactive probing.
if (process.env.POPCORN_SMOKE_PLAY !== undefined || process.env.POPCORN_CDP !== undefined) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

function settingsEnvironment(): SettingsEnvironment {
  const display = screen.getPrimaryDisplay().workAreaSize
  return {
    tempDir: app.getPath('temp'),
    dataDir: app.getPath('userData'),
    screen: { width: display.width, height: display.height },
    windowFrame: false,
    arch: process.arch,
    platform: process.platform,
    appVersion: app.getVersion(),
    releaseName: RELEASE_NAME,
    secrets: {
      traktClientId: process.env.POPCORN_TRAKT_CLIENT_ID,
      traktClientSecret: process.env.POPCORN_TRAKT_CLIENT_SECRET,
      fanartApiKey: process.env.POPCORN_FANART_API_KEY,
      tvdbApiKey: process.env.POPCORN_TVDB_API_KEY,
      tmdbApiKey: process.env.POPCORN_TMDB_API_KEY,
    },
  }
}

/** The platform's application-data root, where NW.js kept its `Popcorn-Time` profile. */
function legacyAppDataRoot(): string {
  if (process.platform === 'win32') return process.env.LOCALAPPDATA ?? app.getPath('appData')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
}

/**
 * Packaged builds get a CSP: the loopback stream and subtitles, TMDB artwork and the
 * YouTube trailer tech are the only things the renderer may reach. Dev keeps Vite's
 * inline scripts and websocket, which the policy would otherwise block.
 */
function applyContentSecurityPolicy(): void {
  if (!app.isPackaged) return
  const policy = [
    "default-src 'self'",
    "script-src 'self' https://www.youtube.com https://s.ytimg.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: http://127.0.0.1:*",
    "connect-src 'self' http://127.0.0.1:* https:",
    "font-src 'self' data:",
    'frame-src https://www.youtube.com',
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

/** `isVideo` from app.js: the extensions an OS "open with" video target uses. */
const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.wmv']

/**
 * `nw.App.argv` / `nw.App.on('open')`: an argument is a magnet or http link, a `.torrent`
 * file, or a video to play.
 */
function openTarget(argv: ReadonlyArray<string>): string | undefined {
  return argv.find((argument) => {
    const value = argument.toLowerCase()
    return (
      value.startsWith('magnet:?') ||
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.endsWith('.torrent') ||
      VIDEO_EXTENSIONS.some((extension) => value.endsWith(extension))
    )
  })
}

/** A target that arrived before the window could receive it. */
let pendingOpenTarget: string | undefined

/** Hands an open-with target to the renderer, which routes it like a dropped file. */
function sendOpenTarget(target: string): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (window === undefined || window.webContents.isLoading()) {
    pendingOpenTarget = target
    return
  }
  if (window.isMinimized()) window.restore()
  window.focus()
  publisher.publish('window:openFile', target)
}

function createWindow(frame: boolean): BrowserWindow {
  applyContentSecurityPolicy()
  const window = new BrowserWindow({
    width: 960,
    height: 520,
    minWidth: 960,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    // `nativeWindowFrame` chooses the OS frame; otherwise a custom titlebar is drawn.
    frame,
    ...(process.platform === 'darwin' && frame === false
      ? { titleBarStyle: 'hiddenInset' as const }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // An open-with target that arrived before the renderer was ready is delivered here.
  window.webContents.once('did-finish-load', () => {
    const target = pendingOpenTarget
    pendingOpenTarget = undefined
    if (target !== undefined) publisher.publish('window:openFile', target)
  })

  return window
}

/**
 * Builds the one AppLayer, starts the one ManagedRuntime and registers the IPC handlers.
 * Every service comes from the Layer graph; nothing is pulled out by hand.
 */
function startApp() {
  const environment = settingsEnvironment()
  const legacy = resolveLegacyProfileRoot(legacyAppDataRoot(), process.platform)
  if (legacy.root === undefined) {
    console.warn(
      `[migration] no legacy profile with data/ found; checked ${legacy.checked.join(', ')}`,
    )
  }

  const layer = makeAppLayer({
    settings: environment,
    sqliteFile: join(app.getPath('userData'), 'popcorn.sqlite'),
    legacyRoot: legacy.root,
    backupDir: join(app.getPath('userData'), 'backup', `legacy-${Date.now()}`),
    platform: process.platform,
    environment: process.env,
    // Updates only exist in a packaged build; POPCORN_UPDATE_URL exercises the flow unpacked.
    updatePort:
      app.isPackaged || process.env.POPCORN_UPDATE_URL !== undefined
        ? createAutoUpdaterPort()
        : undefined,
    publishUpdate: (status) => {
      publisher.publish('updates:status', status)
    },
    onMigrationError: (error) => {
      console.error('[migration] failed; continuing with an empty database', error)
    },
  })

  const runtime = ManagedRuntime.make(layer)
  registerIpc(ipcMain, runtime)

  // Forward each session's progress to every window through the typed publisher.
  runtime.runFork(
    Stream.runForEach(
      Stream.unwrap(Effect.map(StreamManager, (manager) => manager.progress)),
      (progress) => Effect.sync(() => publisher.publish('streams:progress', progress)),
    ),
  )

  return runtime
}

/** Resolves once the renderer document has loaded (immediately if it already has). */
const waitForLoad = (window: BrowserWindow): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    if (!window.webContents.isLoading()) {
      resume(Effect.void)
      return
    }
    window.webContents.once('did-finish-load', () => resume(Effect.void))
  })

/**
 * Opens a window and runs the platform-independent start-up lifecycle as one effect: the
 * frame and zoom come from Settings, the first-launch open target is delivered once the
 * renderer is ready, and the update check repeats every six hours on a scoped fiber that
 * the runtime interrupts on dispose.
 */
function openWindow(): Effect.Effect<void, never, SettingsService | UpdatesService> {
  return Effect.gen(function* () {
    const settings = yield* SettingsService
    const frame = yield* settings.get('nativeWindowFrame')
    const zoom = yield* settings.get('bigPicture')
    const window = yield* Effect.sync(() => createWindow(frame))
    yield* Effect.sync(() => window.webContents.setZoomLevel(zoomLevelFor(zoom)))

    // `nw.App.argv.pop()`: the first launch may carry a file or link to open.
    const target = openTarget(process.argv)
    if (target !== undefined) yield* Effect.sync(() => sendOpenTarget(target))

    yield* waitForLoad(window).pipe(
      Effect.zipRight(Effect.flatMap(UpdatesService, (updates) => updates.check(false))),
      Effect.repeat(Schedule.spaced('6 hours')),
      Effect.fork,
    )
  })
}

// A second launch hands its target to the running window instead of opening another window.
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
}

app.on('second-instance', (_event, argv) => {
  const target = openTarget(argv)
  if (target !== undefined) sendOpenTarget(target)
})

// macOS delivers files through `open-file` rather than argv.
app.on('open-file', (event, path) => {
  event.preventDefault()
  sendOpenTarget(path)
})

void app.whenReady().then(async () => {
  if (!singleInstance) return
  const runtime = startApp()

  if (process.env.POPCORN_SMOKE_PLAY !== undefined) {
    // Loaded only when the smoke drive is requested; keeps the normal bundle out of it.
    const { smokePlay } = await import('./smoke')
    const window = createWindow(false)
    // Forward the renderer console and crash details; without them a dead renderer is silent.
    window.webContents.on('console-message', (event) => {
      const detail = event as unknown as { message?: string; lineNumber?: number }
      console.log(`[renderer] ${detail.message ?? String(event)}`)
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[smoke:play] renderer gone: ${JSON.stringify(details)}`)
    })
    app.on('child-process-gone', (_event, details) => {
      console.error(`[smoke:play] child gone: ${JSON.stringify(details)}`)
    })
    window.webContents.once('did-finish-load', () => {
      void smokePlay(
        window,
        process.env.POPCORN_SMOKE_PLAY ?? '',
        Number(process.env.POPCORN_SMOKE_FILE ?? '0'),
      )
    })
    return
  }

  if (process.env.POPCORN_SMOKE_MAGNET !== undefined) {
    const { smokeTest } = await import('./smoke')
    await smokeTest(runtime)
    return
  }

  runtime.runFork(openWindow())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) runtime.runFork(openWindow())
  })

  app.on('will-quit', () => {
    void runtime.dispose()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
