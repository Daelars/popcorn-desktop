import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { app, BrowserWindow, dialog, ipcMain, screen, session, shell } from 'electron'
import {
  DatabaseService,
  DatabaseServiceLive,
  SqliteLive,
  SqliteSettingsStoreLive,
} from './database'
import { type ExternalPlayersPort, registerIpc } from './ipc'
import { LocalFiles, LocalFilesLive } from './localfiles'
import { LegacyMigrationLive, resolveLegacyProfileRoot } from './migration'
import { launchPlayer, playerArgs, playerSearchPaths, scanPlayers } from './players'
import { createRegistry } from './providers/registry'
import { SEARCH_PROVIDERS, searchTorrents } from './search'
import { type SettingsEnvironment, SettingsService, SettingsServiceLive } from './settings'
import { StreamManager, StreamManagerLive } from './streams'
import { TorrentServiceLive } from './torrent'
import { createAutoUpdaterPort, createUpdates } from './updates'
import { WebTorrentEngineLive } from './webtorrent-engine'

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

/** The legacy UI scaling: percent mapped onto Electron's 1.2-step zoom levels. */
function zoomLevelFor(percent: number): number {
  return Math.log(percent / 100) / Math.log(1.2)
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

function createWindow(zoomPercent: number): BrowserWindow {
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

  window.webContents.setZoomLevel(zoomLevelFor(zoomPercent))

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

async function startServices() {
  const environment = settingsEnvironment()
  const sqlite = SqliteLive(join(app.getPath('userData'), 'popcorn.sqlite'))

  const legacy = resolveLegacyProfileRoot(legacyAppDataRoot(), process.platform)
  if (legacy.root === undefined) {
    console.warn(
      `[migration] no legacy profile with data/ found; checked ${legacy.checked.join(', ')}`,
    )
  }
  const migration = LegacyMigrationLive({
    legacyRoot: legacy.root,
    backupDir: join(app.getPath('userData'), 'backup', `legacy-${Date.now()}`),
    onError: (error) => {
      console.error('[migration] failed; continuing with an empty database', error)
    },
  }).pipe(Layer.provide(sqlite))

  // Settings depends on LegacyMigration, so building it runs migration before any read.
  const settings = SettingsServiceLive(environment).pipe(
    Layer.provide(SqliteSettingsStoreLive.pipe(Layer.provide(sqlite))),
    Layer.provide(migration),
  )
  const database = DatabaseServiceLive.pipe(Layer.provide(sqlite))
  // The engine reads the connection settings from Settings when the layer is built.
  const streams = StreamManagerLive.pipe(
    Layer.provide(TorrentServiceLive.pipe(Layer.provide(WebTorrentEngineLive))),
  )

  const core = Layer.mergeAll(settings, database, sqlite, LocalFilesLive)
  const runtime = ManagedRuntime.make(Layer.mergeAll(core, streams.pipe(Layer.provide(core))))

  const settingsService = await runtime.runPromise(SettingsService)
  const snapshot = await runtime.runPromise(
    Effect.flatMap(SettingsService, (service) => service.snapshot),
  )
  const language = snapshot.language === '' ? 'en' : snapshot.language
  const registry = createRegistry({
    apiUrls: {
      ...(process.env.POPCORN_MOVIES_API === undefined
        ? {}
        : { movies: process.env.POPCORN_MOVIES_API }),
      ...(process.env.POPCORN_YTS_API === undefined ? {} : { yts: process.env.POPCORN_YTS_API }),
      ...(process.env.POPCORN_TV_API === undefined ? {} : { tv: process.env.POPCORN_TV_API }),
      ...(process.env.POPCORN_ANIME_API === undefined
        ? {}
        : { anime: process.env.POPCORN_ANIME_API }),
    },
    tmdbKey: snapshot.tmdb.api_key,
    language,
    contentLanguage: snapshot.contentLanguage === '' ? language : snapshot.contentLanguage,
    contentLangOnly: snapshot.contentLangOnly,
  })

  const streamManager = await runtime.runPromise(StreamManager)
  const externalPlayers = await runtime.runPromise(
    scanPlayers(playerSearchPaths(process.platform, process.env)),
  )
  runtime.runFork(
    Stream.runForEach(streamManager.progress, (progress) =>
      Effect.sync(() => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('streams:progress', progress)
        }
      }),
    ),
  )

  const services = {
    settings: settingsService,
    database: await runtime.runPromise(DatabaseService),
    providers: registry,
    stream: streamManager,
    local: await runtime.runPromise(LocalFiles),
    // Updates only exist in a packaged build; POPCORN_UPDATE_URL exercises the flow unpacked.
    updates: createUpdates(
      app.isPackaged || process.env.POPCORN_UPDATE_URL !== undefined
        ? createAutoUpdaterPort()
        : undefined,
      (status) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('updates:status', status)
        }
      },
    ),
    window: {
      minimize: () => Effect.sync(() => BrowserWindow.getFocusedWindow()?.minimize()),
      maximize: () =>
        Effect.sync(() => {
          const focused = BrowserWindow.getFocusedWindow()
          if (focused?.isMaximized() === true) focused.unmaximize()
          else focused?.maximize()
        }),
      close: () => Effect.sync(() => BrowserWindow.getFocusedWindow()?.close()),
      setZoom: (percent: number) =>
        Effect.sync(() => {
          const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
          window?.webContents.setZoomLevel(zoomLevelFor(percent))
        }),
      setSize: (width: number, height: number) =>
        Effect.sync(() => {
          const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
          window?.setSize(Math.round(width), Math.round(height))
        }),
    },
    files: {
      pickTorrent: () =>
        Effect.tryPromise(async () => {
          const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Torrent', extensions: ['torrent'] }],
          })
          return result.canceled ? undefined : result.filePaths[0]
        }).pipe(Effect.orElseSucceed(() => undefined)),
      openDirectory: (path: string) =>
        Effect.tryPromise(() => shell.openPath(path)).pipe(
          Effect.asVoid,
          Effect.orElseSucceed(() => undefined),
        ),
    },
    search: {
      search: (query: string, category: string) =>
        Effect.gen(function* () {
          const enabledKeys = yield* Effect.forEach(
            SEARCH_PROVIDERS,
            (provider) =>
              Effect.map(
                settingsService.get(provider.setting),
                (value) => [provider.id, value] as const,
              ),
            { concurrency: 'unbounded' },
          )
          const enabled = new Map(enabledKeys)
          return yield* searchTorrents(
            SEARCH_PROVIDERS,
            (provider) => enabled.get(provider.id) !== false,
            query,
            category,
          )
        }),
    },
    players: {
      list: () => Effect.succeed(externalPlayers),
      play: (request: Parameters<ExternalPlayersPort['play']>[0]) =>
        Effect.gen(function* () {
          const player = externalPlayers.find((candidate) => candidate.id === request.playerId)
          if (player === undefined) return
          const args = playerArgs(player, {
            url: request.url,
            ...(request.subtitle === undefined ? {} : { subtitle: request.subtitle }),
            ...(request.title === undefined ? {} : { title: request.title }),
            fullscreen: request.fullscreen === true,
            utf8Subtitle: true,
          })
          yield* launchPlayer(player, args)
        }),
    },
  }
  registerIpc(ipcMain, services, runtime)

  return { runtime, zoomPercent: snapshot.bigPicture, updates: services.updates }
}

/**
 * Diagnostic hook: with `POPCORN_SMOKE_MAGNET` set, the app loads that torrent through the
 * real stream service inside Electron, logs the outcome and quits. Used to test playback
 * in the packaged runtime rather than in plain Node.
 */
async function smokeTest(
  runtime: Awaited<ReturnType<typeof startServices>>['runtime'],
): Promise<void> {
  const magnet = process.env.POPCORN_SMOKE_MAGNET ?? ''
  const downloadPath = app.getPath('temp')
  const started = Date.now()
  try {
    const probe = await runtime.runPromise(
      Effect.flatMap(StreamManager, (streams) => streams.files(magnet, downloadPath)),
    )
    console.log(
      `[smoke] OK after ${Date.now() - started}ms: ${probe.files.length} files, first=${probe.files[0]?.name}`,
    )
  } catch (error) {
    console.error(`[smoke] FAILED after ${Date.now() - started}ms:`, error)
  }
  app.quit()
}

/**
 * Renderer half of the smoke test: `POPCORN_SMOKE_PLAY` is a magnet and `POPCORN_SMOKE_FILE`
 * an optional file index. Drives the window to the player route and logs what video.js did
 * (attached element, ready state, decoded frame size) so playback can be checked headlessly.
 */
async function smokePlay(window: BrowserWindow, magnet: string, fileIndex: number): Promise<void> {
  const started = Date.now()
  const route = `#/player?source=${encodeURIComponent(magnet)}&file=${fileIndex}&title=Smoke`
  try {
    // StartScreen redirects to the configured start route once settings load, which would
    // override this hash; give it a moment to land before navigating.
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const headerState = await window.webContents.executeJavaScript(`(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector)
        if (element === null) return null
        const box = element.getBoundingClientRect()
        return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]
      }
      const header = document.querySelector('#header')
      return {
        header: rect('#header'),
        titlebar: rect('.windows-titlebar'),
        filterBar: rect('.filter-bar'),
        drag: header === null ? null : getComputedStyle(header).getPropertyValue('-webkit-app-region'),
      }
    })()`)
    console.log(`[smoke:header] ${JSON.stringify(headerState)}`)
    const headerShot = await window.webContents.capturePage()
    await writeFile(join(app.getPath('temp'), 'popcorn-header.png'), headerShot.toPNG())
    await window.webContents.executeJavaScript(`
      window.addEventListener('error', (event) => {
        console.log('[smoke:error]', event.message, event.filename + ':' + event.lineno, event.error && event.error.stack)
      })
      window.addEventListener('unhandledrejection', (event) => {
        console.log('[smoke:error] rejection', String((event.reason && event.reason.stack) || event.reason))
      })
      window.addEventListener('hashchange', () => {
        console.log('[smoke:hash]', window.location.hash, String(new Error().stack).split('\\n').slice(1, 4).join(' | '))
      })
      document.addEventListener('fullscreenchange', () => {
        console.log('[smoke:fs]', document.fullscreenElement ? document.fullscreenElement.className : 'exit', String(new Error().stack).split('\\n').slice(1, 5).join(' | '))
      })
      for (const name of ['pushState', 'replaceState']) {
        const original = history[name].bind(history)
        history[name] = (...args) => {
          console.log('[smoke:history]', name, String(args[2]), String(new Error().stack).split('\\n').slice(1, 4).join(' | '))
          return original(...args)
        }
      }
      void 0;
    `)
    await window.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(route)}`)
    console.log(
      `[smoke:play] navigated to`,
      await window.webContents.executeJavaScript('window.location.hash'),
    )
    let capturedEarly = false
    for (let second = 1; second <= 60; second++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const state = (await window.webContents.executeJavaScript(`(() => {
        const wrapper = document.getElementById('video_player')
        const video = document.querySelector('.vjs-tech')
        const rect = (element) => {
          if (element === null || element === undefined) return null
          const box = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return {
            x: Math.round(box.x), y: Math.round(box.y),
            w: Math.round(box.width), h: Math.round(box.height),
            position: style.position, display: style.display,
          }
        }
        if (video === null || video === undefined) {
          return { found: false, hash: window.location.hash, wrapper: rect(wrapper) }
        }
        return {
          found: true,
          attached: document.contains(video),
          readyState: video.readyState,
          networkState: video.networkState,
          currentTime: Math.round(video.currentTime * 10) / 10,
          duration: Number.isFinite(video.duration) ? Math.round(video.duration) : null,
          paused: video.paused,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          error: video.error ? video.error.message || String(video.error.code) : null,
          currentSrc: video.currentSrc,
          buffered: video.buffered.length,
          wrapper: rect(wrapper),
          video: rect(video),
          controlBar: rect(document.querySelector('.vjs-control-bar:not(.player-header-background)')),
        }
      })()`)) as Record<string, unknown>
      console.log(`[smoke:play] ${second}s`, JSON.stringify(state))
      if (second === 8) {
        const image = await window.webContents.capturePage()
        const shot = join(app.getPath('temp'), 'popcorn-player.png')
        await writeFile(shot, image.toPNG())
        console.log(`[smoke:play] screenshot written to ${shot}`)
      }
      if (state.attached === true && Number(state.currentTime ?? 0) > 2 && !capturedEarly) {
        capturedEarly = true
        const image = await window.webContents.capturePage()
        const shot = join(app.getPath('temp'), 'popcorn-player-playing.png')
        await writeFile(shot, image.toPNG())
        console.log(`[smoke:play] PLAYING after ${Date.now() - started}ms, screenshot ${shot}`)
      }
      if (state.attached === true && Number(state.currentTime ?? 0) > 12) {
        const image = await window.webContents.capturePage()
        const shot = join(app.getPath('temp'), 'popcorn-player-later.png')
        await writeFile(shot, image.toPNG())
        console.log(`[smoke:play] PLAYING 12s in, screenshot ${shot}`)
        break
      }
      if (state.error !== null && state.error !== undefined) {
        console.error(`[smoke:play] player error after ${Date.now() - started}ms`)
        break
      }
    }
  } catch (error) {
    console.error(`[smoke:play] FAILED after ${Date.now() - started}ms:`, error)
  }
  // POPCORN_SMOKE_KEEP leaves the app up so an external CDP client can inspect the renderer.
  if (process.env.POPCORN_SMOKE_KEEP === undefined) app.quit()
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
  const { runtime, zoomPercent, updates } = await startServices()

  if (process.env.POPCORN_SMOKE_PLAY !== undefined) {
    const window = createWindow(zoomPercent)
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

  createWindow(zoomPercent)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const window = createWindow(zoomPercent)

      // `nw.App.argv.pop()`: the first launch may carry a file or link to open.
      const initialTarget = openTarget(process.argv)
      if (initialTarget !== undefined) sendOpenTarget(initialTarget)

      // Check on start-up once the renderer can hear the status, then every six hours.
      window.webContents.once('did-finish-load', () => {
        runtime.runFork(updates.check(false))
      })
      setInterval(() => runtime.runFork(updates.check(false)), 6 * 60 * 60 * 1000).unref()
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
