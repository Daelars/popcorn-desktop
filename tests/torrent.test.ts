import { describe, expect, it } from 'vitest'
import { type SettingsEnvironment, settingsDefaults } from '../src/main/settings'
import { parseRange } from '../src/main/torrent'
import { liveLimits } from '../src/main/webtorrent-engine'

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
