/// <reference lib="dom" />
/**
 * Packaged smoke: launch, browse, detail and playback start, plus the two security checks
 * from #27 — every listener binds loopback, and the CSP is enforced in the packaged app.
 *
 * Run against an unpacked build (`pnpm dist:dir`) or a real installation:
 *   POPCORN_SMOKE_APP="release/win-unpacked/Popcorn Time.exe" pnpm smoke:packaged
 *
 * The browse step needs a reachable provider; everything else works offline.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const CDP = 'http://127.0.0.1:9222'

function appPath(): string {
  const fromEnv = process.env.POPCORN_SMOKE_APP
  if (fromEnv !== undefined && fromEnv !== '') return resolve(fromEnv)
  if (process.platform === 'win32') return resolve('release/win-unpacked/Popcorn Time.exe')
  if (process.platform === 'darwin') {
    return resolve('release/mac/Popcorn Time.app/Contents/MacOS/Popcorn Time')
  }
  return resolve('release/linux-unpacked/popcorn-time')
}

/** The bind addresses of the given local ports, so the app's own servers can be checked. */
function listenerAddresses(ports: ReadonlyArray<number>): Record<string, string[]> | undefined {
  if (process.platform !== 'win32') return undefined
  try {
    const filter = ports.map((port) => `$_.LocalPort -eq ${port}`).join(' -or ')
    const output = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -State Listen | Where-Object { ${filter} } | Select-Object LocalPort, LocalAddress | ConvertTo-Json -Compress`,
      ],
      { encoding: 'utf8' },
    )
    const parsed = JSON.parse(output.trim() === '' ? '[]' : output) as
      | { LocalPort: number; LocalAddress: string }
      | Array<{ LocalPort: number; LocalAddress: string }>
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    const result: Record<string, string[]> = {}
    for (const row of rows) {
      const key = String(row.LocalPort)
      result[key] = [...(result[key] ?? []), row.LocalAddress]
    }
    return result
  } catch {
    return undefined
  }
}

async function waitForCdp(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${CDP}/json/version`)
      if (response.ok) return true
    } catch {
      // not up yet
    }
    await new Promise((resume) => setTimeout(resume, 1000))
  }
  return false
}

const checks: Array<{ name: string; ok: boolean; detail: string }> = []
function check(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const app = appPath()
console.log(`[smoke] launching ${app}`)
let child: ChildProcess | undefined
let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
try {
  child = spawn(app, [], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      POPCORN_SMOKE_PLAY: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000001&dn=smoke',
      POPCORN_SMOKE_KEEP: '1',
    },
    stdio: 'ignore',
  })

  if (!(await waitForCdp(120000))) throw new Error('the app did not open the smoke port')
  browser = await chromium.connectOverCDP(CDP)
  const context = browser.contexts()[0]
  if (context === undefined) throw new Error('no browser context')
  // The window registers its page a moment after the debugging port opens.
  const deadline = Date.now() + 60000
  let page = context.pages()[0]
  while (page === undefined && Date.now() < deadline) {
    await new Promise((resume) => setTimeout(resume, 500))
    page = context.pages()[0]
  }
  if (page === undefined) throw new Error('no page')

  // Launch. `#main-window` is a zero-height container (its children are positioned), so
  // attachment is the right check rather than visibility.
  const launched = await page
    .waitForSelector('#main-window', { state: 'attached', timeout: 90000 })
    .then(() => true)
    .catch(() => false)
  check('launch: the shell is rendered', launched, page.url().slice(0, 80))

  // Browse
  await page.evaluate(() => {
    window.location.hash = '#/movies'
  })
  const browse = await page
    .waitForSelector('.cover-link', { timeout: 60000 })
    .then(() => true)
    .catch(() => false)
  const posters = await page.locator('.cover-link').count()
  check('browse: posters are listed', browse && posters > 0, `${posters} posters`)

  // Detail
  await page.locator('.cover-link').first().click()
  const detail = await page
    .waitForSelector('.movie-detail', { timeout: 30000 })
    .then(() => true)
    .catch(() => false)
  check('detail: the movie view opens', detail)

  // Playback start: a local file plays without a network or peers.
  const directory = mkdtempSync(join(tmpdir(), 'popcorn-smoke-'))
  const video = join(directory, 'smoke.mp4')
  writeFileSync(video, Buffer.alloc(64, 1))
  const subtitle = join(directory, 'smoke.srt')
  writeFileSync(subtitle, '1\n00:00:01,000 --> 00:00:02,000\nsmoke\n')
  await page.evaluate((path) => {
    window.location.hash = `#/player?local=${encodeURIComponent(path)}`
  }, video)
  const playing = await page
    .waitForFunction(
      () => (document.querySelector('video')?.currentSrc ?? '').includes('127.0.0.1'),
      { timeout: 60000 },
    )
    .then(() => true)
    .catch(() => false)
  check('playback: the served file reaches the player', playing)

  // CSP: an inline script must be refused, and the violation must be reported.
  const csp = await page.evaluate(async () => {
    let violation = false
    const onViolation = () => {
      violation = true
    }
    document.addEventListener('securitypolicyviolation', onViolation)
    const script = document.createElement('script')
    script.textContent = 'window.__popcorn_inline_ran = true'
    document.body.append(script)
    await new Promise((resume) => setTimeout(resume, 500))
    document.removeEventListener('securitypolicyviolation', onViolation)
    const ran =
      (window as unknown as { __popcorn_inline_ran?: boolean }).__popcorn_inline_ran === true
    return { ran, violation }
  })
  check('csp: inline scripts are refused', !csp.ran && csp.violation)

  // Listeners: the app's own servers (file + subtitle) must bind loopback only.
  const ports = await page.evaluate(
    async ({ video: videoPath, subtitle: subtitlePath }) => {
      const bridge = (
        window as unknown as {
          popcorn: {
            invoke: (channel: string, payload: Record<string, unknown>) => Promise<{ port: number }>
          }
        }
      ).popcorn
      const served = await bridge.invoke('local:serve', {
        path: videoPath,
        origin: window.location.origin,
      })
      const track = await bridge.invoke('local:subtitle', {
        path: subtitlePath,
        origin: window.location.origin,
      })
      return [served.port, track.port]
    },
    { video, subtitle },
  )
  const addresses = listenerAddresses(ports)
  if (addresses === undefined) {
    check('loopback: the app servers bind loopback', false, 'could not enumerate listeners')
  } else {
    const foreign = Object.entries(addresses).flatMap(([port, list]) =>
      list
        .filter((address) => !(address.startsWith('127.') || address === '::1'))
        .map((address) => `${port}:${address}`),
    )
    check(
      'loopback: the app servers bind loopback',
      foreign.length === 0 && Object.keys(addresses).length === ports.length,
      `ports ${ports.join(', ')} on ${JSON.stringify(addresses)}`,
    )
  }
} catch (error) {
  check('smoke ran to completion', false, String(error))
} finally {
  await browser?.close().catch(() => undefined)
  child?.kill()
}

const failed = checks.filter((entry) => !entry.ok)
console.log(`[smoke] ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
