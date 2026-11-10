import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { CatalogServiceLive } from '../src/main/catalog'
import { CollectionServiceLive } from '../src/main/collection'
import { DatabaseServiceLive, SqliteLive, SqliteSettingsStoreLive } from '../src/main/database'
import { FilePickerService } from '../src/main/file-picker'
import {
  createEventPublisher,
  type ExternalPlayersPort,
  type IpcMainPort,
  registerIpc,
} from '../src/main/ipc'
import { LegacyMigration } from '../src/main/legacy-migration'
import { LocalFiles } from '../src/main/localfiles'
import { NOT_MIGRATED } from '../src/main/migration'
import { PlaybackTargets } from '../src/main/playback-targets'
import { PlayersService, playerArgs, playerCommand } from '../src/main/players'
import { ProvidersService } from '../src/main/providers/registry'
import { SearchService } from '../src/main/search'
import { type SettingsEnvironment, SettingsServiceLive } from '../src/main/settings'
import { SettingsEffectsLive } from '../src/main/settings-effects'
import { StreamSession } from '../src/main/stream-session'
import { SubtitlesServiceLive } from '../src/main/subtitles/service'
import { UpdatesService } from '../src/main/updates'
import { WindowService } from '../src/main/window'
import type { PlaybackTarget } from '../src/shared'
import type { IpcEnvelope } from '../src/shared/ipc'

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

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const port: IpcMainPort = {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    },
  }
  return {
    port,
    invoke: async (channel: string, payload: unknown): Promise<IpcEnvelope> =>
      (await handlers.get(channel)?.(null, payload)) as IpcEnvelope,
  }
}

async function harness() {
  const sqlite = SqliteLive(':memory:')
  const settings = SettingsServiceLive(environment).pipe(
    Layer.provide(SqliteSettingsStoreLive.pipe(Layer.provide(sqlite))),
    Layer.provide(Layer.succeed(LegacyMigration, { result: NOT_MIGRATED })),
  )
  const database = DatabaseServiceLive.pipe(Layer.provide(sqlite))
  const launched: Array<{ playerId: string; url: string; title?: string | undefined }> = []

  // One test Layer supplies every service the IPC handlers read from the context.
  const fakes = Layer.mergeAll(
    Layer.succeed(ProvidersService, { entries: Effect.succeed([]) }),
    Layer.succeed(PlaybackTargets, {
      list: Effect.succeed<ReadonlyArray<PlaybackTarget>>([
        { kind: 'local', id: 'local', name: 'Popcorn Time' },
      ]),
      play: (_target, sessionId) =>
        Effect.succeed({
          target: { kind: 'local' as const, id: 'local' as const, name: 'Popcorn Time' },
          sessionId,
        }),
    }),
    Layer.succeed(WindowService, {
      minimize: () => Effect.void,
      maximize: () => Effect.void,
      close: () => Effect.void,
      setZoom: () => Effect.void,
      setSize: () => Effect.void,
    }),
    Layer.succeed(FilePickerService, {
      pickTorrent: () => Effect.succeed(undefined),
      openDirectory: () => Effect.void,
    }),
    Layer.succeed(SearchService, {
      search: (query: string) =>
        Effect.succeed({
          results: [
            {
              title: `result for ${query}`,
              magnet: 'magnet:?xt=urn:btih:abc',
              size: '1.00 GB',
              seeds: 10,
              peers: 2,
              provider: 'nyaa.si',
              source: 'https://nyaa.si/view/1',
            },
          ],
          counts: { nyaa: 1 },
          failures: [],
        }),
    }),
    Layer.succeed(PlayersService, {
      list: () => Effect.succeed([{ id: 'VLC', type: 'vlc', path: 'C:/VLC/vlc.exe' }]),
      play: (request: Parameters<ExternalPlayersPort['play']>[0]) => {
        launched.push(request)
        return Effect.void
      },
    }),
    Layer.succeed(StreamSession, {
      open: () => Effect.succeed({ id: 'session-1' }),
      states: () => Stream.empty,
      current: () => Effect.succeed(undefined),
      stateEvents: Stream.empty,
      close: () => Effect.void,
      closeAll: () => Effect.void,
      files: () =>
        Effect.succeed({
          infoHash: 'hash-1',
          files: [{ index: 0, name: 'movie.mp4', length: 10 }],
          // Mirrors the real probe: the handle carries functions and cannot be cloned.
          handle: { destroy: () => undefined, pause: () => undefined } as never,
        }),
      list: Effect.succeed([]),
      pause: () => Effect.void,
      resume: () => Effect.void,
      progress: Stream.empty,
    }),
    Layer.succeed(LocalFiles, {
      serve: (path: string) =>
        Effect.succeed({ port: 41000, url: 'http://127.0.0.1:41000/0', name: path }),
      stop: () => Effect.void,
      subtitle: () => Effect.succeed({ port: 41001, url: 'http://127.0.0.1:41001/subtitles.vtt' }),
      serveVtt: () => Effect.succeed({ port: 41001, url: 'http://127.0.0.1:41001/subtitles.vtt' }),
    }),
    Layer.succeed(UpdatesService, {
      check: () => Effect.void,
      download: () => Effect.void,
      install: () => Effect.void,
    }),
  )
  const base = Layer.mergeAll(settings, database, sqlite, fakes)
  const derived = Layer.mergeAll(
    CatalogServiceLive,
    SubtitlesServiceLive,
    CollectionServiceLive,
    SettingsEffectsLive,
  ).pipe(Layer.provide(base))
  const runtime = ManagedRuntime.make(Layer.mergeAll(base, derived))
  const ipc = fakeIpcMain()
  registerIpc(ipc.port, runtime)
  return { runtime, invoke: ipc.invoke, launched }
}

describe('external players', () => {
  const vlc = { id: 'VLC', type: 'vlc', path: '/Applications/VLC.app' }
  const bsplayer = { id: 'BSPlayer', type: 'bsplayer', path: 'C:/BSPlayer/bsplayer.exe' }

  it('passes switches, fullscreen, title and url as separate argv entries', () => {
    expect(
      playerArgs(vlc, {
        url: 'http://127.0.0.1:41000/0',
        title: 'A Movie',
        fullscreen: true,
      }),
    ).toEqual([
      '--no-video-title-show',
      '-f',
      '--meta-title=',
      'A Movie',
      'http://127.0.0.1:41000/0',
    ])
  })

  it('keeps BSPlayer url-first argument order', () => {
    expect(playerArgs(bsplayer, { url: 'http://127.0.0.1:41000/0', fullscreen: true })).toEqual([
      'http://127.0.0.1:41000/0',
      '-fs',
    ])
  })

  it('runs the binary inside a macOS bundle and flatpak VLC through flatpak', () => {
    expect(playerCommand(vlc)).toEqual({
      file: '/Applications/VLC.app/Contents/MacOS/VLC',
      prefix: [],
    })
    expect(
      playerCommand({
        id: 'VLC',
        type: 'vlc',
        path: '/var/lib/flatpak/app/org.videolan.VLC/current/active/files/bin/vlc',
      }),
    ).toEqual({ file: '/usr/bin/flatpak', prefix: ['run', 'org.videolan.VLC'] })
  })
})

describe('registerIpc', () => {
  it('serves settings reads over a validated channel', async () => {
    const { runtime, invoke } = await harness()
    expect(await invoke('settings:get', { key: 'theme' })).toEqual({
      ok: true,
      value: 'Official_-_Dark_theme',
    })
    await runtime.dispose()
  })

  it('rejects a malformed request as data', async () => {
    const { runtime, invoke } = await harness()
    const result = await invoke('settings:get', { key: 42 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message.length).toBeGreaterThan(0)
    }
    await runtime.dispose()
  })

  it('turns a service failure into a tagged failure envelope', async () => {
    const { runtime, invoke } = await harness()
    const result = await invoke('settings:set', { key: 'not_a_key', value: 1 })
    expect(result).toEqual({
      ok: false,
      error: {
        tag: 'SettingsError',
        message: 'unknown settings key',
        context: { key: 'not_a_key' },
      },
    })
    await runtime.dispose()
  })

  it('round-trips the torrent collection through the database', async () => {
    const { runtime, invoke } = await harness()
    expect(
      await invoke('collection:add', { name: 'Sintel', source: 'magnet:?xt=urn:btih:aaa' }),
    ).toEqual({ ok: true, value: undefined })
    const listed = await invoke('collection:list', {})
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      const items = listed.value as ReadonlyArray<{ id: number; name: string }>
      expect(items).toHaveLength(1)
      expect(items[0]?.name).toBe('Sintel')
      expect(await invoke('collection:remove', { id: items[0]?.id ?? 0 })).toEqual({
        ok: true,
        value: undefined,
      })
    }
    await runtime.dispose()
  })

  it('searches torrents over the search channel', async () => {
    const { runtime, invoke } = await harness()
    const response = await invoke('search:torrents', { query: 'sintel', category: 'Movies' })
    expect(response.ok).toBe(true)
    if (response.ok) {
      const outcome = response.value as {
        results: ReadonlyArray<{ title: string; seeds: number }>
        counts: Record<string, number>
      }
      expect(outcome.results[0]?.title).toBe('result for sintel')
      expect(outcome.counts.nyaa).toBe(1)
    }
    await runtime.dispose()
  })

  it('lists playback targets and forwards a play', async () => {
    const { runtime, invoke } = await harness()
    expect(await invoke('playback:targets', {})).toEqual({
      ok: true,
      value: [{ kind: 'local', id: 'local', name: 'Popcorn Time' }],
    })
    expect(await invoke('playback:play', { targetId: 'local', sessionId: 'session-1' })).toEqual({
      ok: true,
      value: undefined,
    })
    await runtime.dispose()
  })

  it('does nothing when the torrent picker is cancelled', async () => {
    const { runtime, invoke } = await harness()
    expect(await invoke('collection:import', {})).toEqual({ ok: true, value: undefined })
    expect(await invoke('collection:list', {})).toEqual({ ok: true, value: [] })
    await runtime.dispose()
  })

  it('lists live torrents over the seedbox channel', async () => {
    const { runtime, invoke } = await harness()
    expect(await invoke('torrents:list', {})).toEqual({ ok: true, value: [] })
    await runtime.dispose()
  })

  it('lists the files of a torrent over the stream channel', async () => {
    const { runtime, invoke } = await harness()
    const response = await invoke('stream:files', { torrentId: 'magnet:?xt=urn:btih:abc' })
    expect(response).toEqual({
      ok: true,
      value: { infoHash: 'hash-1', files: [{ index: 0, name: 'movie.mp4', length: 10 }] },
    })
    // Electron refuses to send anything it cannot structured-clone, so a probe's live
    // handle must never reach the envelope.
    expect(() => structuredClone(response)).not.toThrow()
    await runtime.dispose()
  })

  it('round-trips bookmarks through the database service', async () => {
    const { runtime, invoke } = await harness()
    expect(await invoke('bookmarks:add', { imdbId: 'tt0111161', type: 'movie' })).toEqual({
      ok: true,
      value: undefined,
    })
    expect(await invoke('bookmarks:list', {})).toEqual({
      ok: true,
      value: [{ imdbId: 'tt0111161', type: 'movie' }],
    })
    await runtime.dispose()
  })

  it('lists the provider registry and rejects an unknown tab as data', async () => {
    const { runtime, invoke } = await harness()
    expect(await invoke('browse:providers', {})).toEqual({ ok: true, value: [] })
    expect(await invoke('browse:fetch', { tab: 'movie', filters: {} })).toEqual({
      ok: false,
      error: {
        tag: 'ProviderError',
        message: 'unknown tab',
        context: { provider: 'movie', operation: 'fetch' },
      },
    })
    await runtime.dispose()
  })
})

describe('createEventPublisher', () => {
  it('sends every push event through one typed entry point', () => {
    const sent: Array<{ channel: string; payload: unknown }> = []
    const publisher = createEventPublisher((channel, payload) => sent.push({ channel, payload }))

    publisher.publish('streams:progress', {
      infoHash: 'abc',
      downloaded: 1,
      uploaded: 2,
      speed: 3,
      peers: 4,
      progress: 0.5,
      length: 100,
      timeRemaining: 5000,
    })
    publisher.publish('window:openFile', 'magnet:?xt=urn:btih:abc')
    publisher.publish('updates:status', { state: 'checking' })

    expect(sent).toEqual([
      {
        channel: 'streams:progress',
        payload: {
          infoHash: 'abc',
          downloaded: 1,
          uploaded: 2,
          speed: 3,
          peers: 4,
          progress: 0.5,
          length: 100,
          timeRemaining: 5000,
        },
      },
      { channel: 'window:openFile', payload: 'magnet:?xt=urn:btih:abc' },
      { channel: 'updates:status', payload: { state: 'checking' } },
    ])
  })
})
