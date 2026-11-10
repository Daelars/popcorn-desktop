import { homedir } from 'node:os'
import { join } from 'node:path'
import { Effect, ManagedRuntime, Stream } from 'effect'
import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron'
import { makeAppLayer } from './app'
import { registerIpc } from './ipc'
import { resolveLegacyProfileRoot } from './migration'
import { type SettingsEnvironment, SettingsService } from './settings'
import { smokePlay, smokeTest } from './smoke'
import { StreamManager } from './streams'
import { createAutoUpdaterPort, UpdatesService } from './updates'
import { zoomLevelFor } from './window'

const RELEASE_NAME = 'Now.. Bring me that Horizon'

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
  window.webContents.send('window:openFile', target)
}

function createWindow(): BrowserWindow {
  applyContentSecurityPolicy()
  const window = new BrowserWindow({
    width: 960,
    height: 520,
    minWidth: 960,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    // Frameless with a custom titlebar; macOS keeps its inset traffic lights.
    frame: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
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
    if (target !== undefined) window.webContents.send('window:openFile', target)
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
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('updates:status', status)
      }
    },
    onMigrationError: (error) => {
      console.error('[migration] failed; continuing with an empty database', error)
    },
  })

  const runtime = ManagedRuntime.make(layer)
  registerIpc(ipcMain, runtime)

  // Forward each session's progress to every window.
  runtime.runFork(
    Stream.runForEach(
      Stream.unwrap(Effect.map(StreamManager, (manager) => manager.progress)),
      (progress) =>
        Effect.sync(() => {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send('streams:progress', progress)
          }
        }),
    ),
  )

  return runtime
}

type AppRuntime = ReturnType<typeof startApp>

/** Applies the configured UI scale once settings are available. */
function applyZoom(runtime: AppRuntime, window: BrowserWindow): void {
  runtime.runFork(
    Effect.flatMap(SettingsService, (settings) => settings.get('bigPicture')).pipe(
      Effect.tap((percent) =>
        Effect.sync(() => window.webContents.setZoomLevel(zoomLevelFor(percent))),
      ),
    ),
  )
}

/** Checks on start-up once the renderer can hear the status, then every six hours. */
function scheduleUpdates(runtime: AppRuntime, window: BrowserWindow): void {
  window.webContents.once('did-finish-load', () => {
    runtime.runFork(Effect.flatMap(UpdatesService, (updates) => updates.check(false)))
  })
  setInterval(
    () => runtime.runFork(Effect.flatMap(UpdatesService, (updates) => updates.check(false))),
    6 * 60 * 60 * 1000,
  ).unref()
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
    const window = createWindow()
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
    await smokeTest(runtime)
    return
  }

  const window = createWindow()
  applyZoom(runtime, window)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const next = createWindow()
      applyZoom(runtime, next)

      // `nw.App.argv.pop()`: the first launch may carry a file or link to open.
      const initialTarget = openTarget(process.argv)
      if (initialTarget !== undefined) sendOpenTarget(initialTarget)

      scheduleUpdates(runtime, next)
    }
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
