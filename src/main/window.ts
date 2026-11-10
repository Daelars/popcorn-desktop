import { Context, Effect, Layer } from 'effect'
import { BrowserWindow } from 'electron'

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
