import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect } from 'effect'
import { app, type BrowserWindow } from 'electron'
import { StreamSession } from './stream-session'

/** The slice of the app runtime this diagnostic needs. */
interface SmokeRuntime {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, StreamSession>) => Promise<A>
}

/**
 * Diagnostic hook: with `POPCORN_SMOKE_MAGNET` set, the app loads that torrent through the
 * real stream service inside Electron, logs the outcome and quits. Used to test playback
 * in the packaged runtime rather than in plain Node. Kept out of `index.ts` so the entry
 * point hands the `AppLayer` to one runtime and nothing else.
 */
export async function smokeTest(runtime: SmokeRuntime): Promise<void> {
  const magnet = process.env.POPCORN_SMOKE_MAGNET ?? ''
  const downloadPath = app.getPath('temp')
  const started = Date.now()
  try {
    const probe = await runtime.runPromise(
      Effect.flatMap(StreamSession, (sessions) => sessions.files(magnet, downloadPath)),
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
export async function smokePlay(
  window: BrowserWindow,
  magnet: string,
  fileIndex: number,
): Promise<void> {
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
