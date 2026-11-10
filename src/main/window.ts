import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { app, BrowserWindow, type NativeImage, nativeImage, Tray } from 'electron'
import type { SettingsChange } from './settings'

/** Window chrome actions the renderer's titlebar drives. */
export interface WindowControlsShape {
  readonly minimize: () => Effect.Effect<void>
  readonly maximize: () => Effect.Effect<void>
  readonly close: () => Effect.Effect<void>
  readonly setZoom: (percent: number) => Effect.Effect<void>
  readonly setSize: (width: number, height: number) => Effect.Effect<void>
}

export class WindowService extends Context.Tag('WindowService')<
  WindowService,
  WindowControlsShape
>() {}

/** The legacy UI scaling: percent mapped onto Electron's 1.2-step zoom levels. */
export function zoomLevelFor(percent: number): number {
  return Math.log(percent / 100) / Math.log(1.2)
}

function focused(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

export const WindowServiceLive = Layer.succeed(WindowService, {
  minimize: () => Effect.sync(() => BrowserWindow.getFocusedWindow()?.minimize()),
  maximize: () =>
    Effect.sync(() => {
      const window = BrowserWindow.getFocusedWindow()
      if (window?.isMaximized() === true) window.unmaximize()
      else window?.maximize()
    }),
  close: () => Effect.sync(() => BrowserWindow.getFocusedWindow()?.close()),
  setZoom: (percent) =>
    Effect.sync(() => {
      focused()?.webContents.setZoomLevel(zoomLevelFor(percent))
    }),
  setSize: (width, height) =>
    Effect.sync(() => {
      focused()?.setSize(Math.round(width), Math.round(height))
    }),
})

/**
 * Live window preferences. `alwaysOnTop` and `alwaysFullscreen` are read once when the
 * window is created, so a change is pushed onto every open window here — the legacy
 * settings page called `win.setAlwaysOnTop` on change and the player entered fullscreen.
 */
export function applyWindowPreference(change: SettingsChange): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (change.key === 'alwaysOnTop' && typeof change.value === 'boolean') {
      window.setAlwaysOnTop(change.value)
    }
    if (change.key === 'alwaysFullscreen' && typeof change.value === 'boolean') {
      window.setFullScreen(change.value)
    }
  }
}

/** The window geometry the legacy app kept in NW.js `localStorage`. */
const WindowStateSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  maximized: Schema.Boolean,
})

export type WindowState = Schema.Schema.Type<typeof WindowStateSchema>

/** The file in the userdata directory that replaces the legacy `localStorage` keys. */
export function windowStatePath(userDataDir: string): string {
  return join(userDataDir, 'window-state.json')
}

const parseWindowState = Schema.parseJson(WindowStateSchema)

/** Reads the saved geometry; a missing or malformed file falls back to the defaults. */
export function readWindowState(path: string): WindowState | undefined {
  try {
    return Option.getOrUndefined(
      Schema.decodeUnknownOption(parseWindowState)(readFileSync(path, 'utf8')),
    )
  } catch {
    return undefined
  }
}

/** Persists the geometry; a write failure is logged and never blocks shutdown. */
export function writeWindowState(path: string, state: WindowState): void {
  try {
    writeFileSync(path, JSON.stringify(state))
  } catch (cause) {
    console.warn('[window] cannot persist window geometry', cause)
  }
}

/** Screen metrics the legacy geometry clamp needs: the work area and the full screen size. */
export interface ScreenMetrics {
  readonly workArea: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly size: { readonly width: number; readonly height: number }
}

export interface WindowPlacement {
  readonly bounds: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly maximized: boolean
}

/**
 * `App.onBeforeStart` from the legacy app: cap the saved size to the work area, recentre a
 * position that would fall off the screen, and fall back to `defaultWidth`/`defaultHeight`
 * (the settings module already derives those from 80% of the screen) when nothing is saved.
 */
export function resolveWindowPlacement(
  saved: WindowState | undefined,
  screen: ScreenMetrics,
  defaults: { readonly width: number; readonly height: number },
): WindowPlacement {
  const width = Math.min(saved?.width ?? defaults.width, screen.workArea.width)
  const height = Math.min(saved?.height ?? defaults.height, screen.workArea.height)
  const centreX = screen.workArea.x + Math.round((screen.workArea.width - width) / 2)
  const centreY = screen.workArea.y + Math.round((screen.workArea.height - height) / 2)
  const x =
    saved === undefined || saved.x < 0 || saved.x + width > screen.size.width ? centreX : saved.x
  const y =
    saved === undefined || saved.y < 0 || saved.y + height > screen.size.height ? centreY : saved.y
  return { bounds: { x, y, width, height }, maximized: saved?.maximized ?? false }
}

/** The legacy tray icon (`src/app/images/icon.png`), resolved for dev and packaged builds. */
function trayImage(): NativeImage {
  const candidates = [
    join(__dirname, '../renderer/images/icon.png'),
    join(app.getAppPath(), 'resources/images/icon.png'),
    join(app.getAppPath(), 'build/icon.png'),
  ]
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate)
    if (!image.isEmpty()) return image
  }
  return nativeImage.createEmpty()
}

/**
 * The legacy `minimizeToTray`: hide the window instead of minimizing it and leave a tray
 * icon that restores it on click. The setting is read on every minimize, so toggling it
 * applies without a restart, and the tray is removed whenever the window is visible again.
 */
export function installMinimizeToTray(
  window: BrowserWindow,
  options: { readonly enabled: () => boolean; readonly tooltip: string },
): void {
  let tray: Tray | undefined

  const removeTray = (): void => {
    tray?.destroy()
    tray = undefined
  }

  window.on('minimize', () => {
    if (!options.enabled()) return
    window.hide()
    if (tray !== undefined) return
    tray = new Tray(trayImage())
    tray.setToolTip(options.tooltip)
    tray.on('click', () => {
      // `minimize` cannot be prevented, so the window may already be minimized when hidden.
      window.restore()
      window.show()
      window.focus()
    })
  })

  window.on('show', removeTray)
  window.on('closed', removeTray)
}
