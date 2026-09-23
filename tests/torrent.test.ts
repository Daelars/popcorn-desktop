import { Readable } from 'node:stream'
import { Effect } from 'effect'
import type { WebTorrentTorrent } from 'webtorrent'
import { describe, expect, it } from 'vitest'
import { type SettingsEnvironment, settingsDefaults } from '../src/main/settings'
import { parseRange } from '../src/main/torrent'
import { handleOf, liveLimits } from '../src/main/webtorrent-engine'

const environment: SettingsEnvironment = {
  tempDir: 'C:/tmp',
  dataDir: 'C:/data',
  screen: { width: 1920, height: 1080 },
  windowFrame: false,
  arch: 'x64',
  platform: 'win32',
  appVersion: '0.5.1',
  releaseName: 'test',
}

describe('parseRange', () => {
  it('parses explicit and suffix ranges', () => {
    expect(parseRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 })
    expect(parseRange('bytes=-4', 10)).toEqual({ start: 6, end: 9 })
    expect(parseRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 })
    expect(parseRange(undefined, 10)).toBeNull()
    expect(parseRange('bytes=20-30', 10)).toBeNull()
  })
})

describe('live limits', () => {
  it('derives connection and speed limits from a settings snapshot', () => {
    const base = settingsDefaults(environment)
    expect(
      liveLimits({
        ...base,
        connectionLimit: 12,
        downloadLimit: '2',
        uploadLimit: '1',
        maxLimitMult: 1024,
      }),
    ).toEqual({ maxConns: 12, downloadLimit: 2048, uploadLimit: 1024 })
  })

  it('treats empty speed limits as unlimited', () => {
    const base = settingsDefaults(environment)
    expect(liveLimits({ ...base, downloadLimit: '', uploadLimit: '' })).toEqual({
      maxConns: base.connectionLimit,
      downloadLimit: -1,
      uploadLimit: -1,
    })
  })
})

describe('webtorrent file selection', () => {
  function fakeTorrent() {
    const selected = new Set<number>()
    const files = [0, 1, 2].map((piece) => {
      const name = `episode-${piece + 1}.mkv`
      return {
        name,
        length: 10,
        path: name,
        createReadStream: () => Readable.from(Buffer.from('0123456789')),
        select: () => {
          selected.add(piece)
        },
        deselect: () => {
          selected.delete(piece)
        },
      }
    })
    const torrent: Record<string, unknown> = {
      infoHash: 'aabbccddeeff',
      name: 'Season 1',
      length: 30,
      files,
      pieces: [null, null, null],
      downloaded: 0,
      uploaded: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      progress: 0,
      paused: false,
      ready: true,
      once: () => torrent,
      on: () => torrent,
      off: () => torrent,
      select: (start: number, end: number) => {
        for (let piece = start; piece <= end; piece += 1) selected.add(piece)
      },
      deselect: (start: number, end: number) => {
        for (let piece = start; piece <= end; piece += 1) selected.delete(piece)
      },
      pause: () => {},
      resume: () => {},
      destroy: () => {},
    }
    return { torrent: torrent as unknown as WebTorrentTorrent, selected }
  }

  it('deselects every file and selects only the chosen one', () => {
    const { torrent, selected } = fakeTorrent()
    // WebTorrent selects every file by default when the torrent is added.
    selected.add(0)
    selected.add(1)
    selected.add(2)

    const handle = handleOf(torrent)
    const file = Effect.runSync(handle.select(1))

    expect(file.name).toBe('episode-2.mkv')
    expect([...selected]).toEqual([1])
  })
})
