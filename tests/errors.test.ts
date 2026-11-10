import { Cause, Chunk, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  DbError,
  DeviceError,
  ProviderError,
  type ServiceError,
  SettingsError,
  SubtitleError,
  TorrentError,
} from '../src/shared/errors'

describe('tagged errors', () => {
  it('carries its tag and typed context', () => {
    const error = new SettingsError({ message: 'not a valid theme', key: 'theme' })
    expect(error._tag).toBe('SettingsError')
    expect(error.key).toBe('theme')
    expect(error.message).toBe('not a valid theme')
  })

  it('survives an Effect failure as the same instance', async () => {
    const failure = new TorrentError({ message: 'no peers', infoHash: 'aabbcc' })
    const exit = await Effect.runPromiseExit(Effect.fail(failure))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Chunk.toReadonlyArray(Cause.failures(exit.cause))).toContain(failure)
    }
  })

  it('narrows exhaustively over the union', () => {
    const describeError = (error: ServiceError): string => {
      switch (error._tag) {
        case 'TorrentError':
          return `torrent ${error.infoHash ?? 'unknown'}: ${error.message}`
        case 'ProviderError':
          return `${error.provider}/${error.operation}: ${error.message}`
        case 'SubtitleError':
          return `${error.source}: ${error.message}`
        case 'DbError':
          return `db/${error.operation}: ${error.message}`
        case 'DeviceError':
          return `${error.device}/${error.operation}: ${error.message}`
        case 'MigrationError':
          return `migration/${error.operation}: ${error.message}`
        case 'SettingsError':
          return `${error.key}: ${error.message}`
      }
    }

    expect(
      describeError(
        new ProviderError({ message: 'timeout', provider: 'movies', operation: 'fetch' }),
      ),
    ).toBe('movies/fetch: timeout')
    expect(describeError(new DbError({ message: 'locked', operation: 'write' }))).toBe(
      'db/write: locked',
    )
    expect(
      describeError(new SubtitleError({ message: 'bad charset', source: 'opensubtitles' })),
    ).toBe('opensubtitles: bad charset')
    expect(
      describeError(
        new DeviceError({ message: 'refused', device: 'chromecast', operation: 'play' }),
      ),
    ).toBe('chromecast/play: refused')
  })
})
