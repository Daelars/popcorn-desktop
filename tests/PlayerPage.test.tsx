import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeAll, expect, it, vi } from 'vitest'
import { initI18n } from '../src/renderer/src/i18n'
import { PlayerPage } from '../src/renderer/src/routes/PlayerPage'
import type { PopcornBridge } from '../src/shared/ipc'

const { playerMock, videojsMock } = vi.hoisted(() => {
  const plugins = new Map<string, (this: unknown) => void>()
  const playerMock = {
    paused: vi.fn(() => true),
    play: vi.fn(),
    pause: vi.fn(),
    currentTime: vi.fn(() => 0),
    duration: vi.fn(() => Number.NaN),
    volume: vi.fn(() => 1),
    muted: vi.fn(() => false),
    playbackRate: vi.fn(() => 1),
    textTracks: vi.fn(() => []),
    addTextTrack: vi.fn(() => ({ id_: '' })),
    showTextTrack: vi.fn(),
    error: vi.fn(() => null),
    currentSrc: vi.fn(() => ''),
    isFullscreen: vi.fn(() => false),
    requestFullscreen: vi.fn(),
    exitFullscreen: vi.fn(),
    addClass: vi.fn(),
    trigger: vi.fn(),
    on: vi.fn(),
    ready: vi.fn((callback: () => void) => callback()),
    dispose: vi.fn(),
    el: vi.fn((): HTMLElement => document.createElement('div')),
    controlBar: {
      el: () => document.createElement('div'),
      children: () => [] as unknown[],
      progressControl: {
        el: () => document.createElement('div'),
        seekBar: { calculateDistance: () => 0 },
      },
      playToggle: { el: () => document.createElement('div') },
    },
  }
  const videojsMock = vi.fn((element: HTMLElement, options?: unknown) => {
    const controlBar = document.createElement('div')
    controlBar.className = 'vjs-control-bar'
    element.append(controlBar)
    playerMock.el.mockReturnValue(element)
    playerMock.controlBar = {
      el: () => controlBar,
      children: () => [],
      progressControl: { el: () => controlBar, seekBar: { calculateDistance: () => 0 } },
      playToggle: { el: () => controlBar },
    }
    for (const plugin of plugins.values()) plugin.call(playerMock)
    void options
    return playerMock
  }) as unknown as Record<string, unknown>
  videojsMock.plugin = (name: string, handler: (this: unknown) => void) => {
    plugins.set(name, handler)
  }
  videojsMock.options = {}
  videojsMock.Player = { prototype: {} }
  videojsMock.Component = { extend: () => ({ prototype: {} }), call: () => {}, prototype: {} }
  videojsMock.Button = { extend: () => ({ prototype: {} }), prototype: {} }
  videojsMock.MenuItem = { extend: () => ({ prototype: {} }), prototype: {} }
  videojsMock.TextTrackMenuItem = {
    extend: () => ({ prototype: { onClick: () => {} } }),
    call: () => {},
    prototype: { onClick: () => {} },
  }
  videojsMock.ErrorDisplay = { prototype: {} }
  videojsMock.MediaTechController = { prototype: {} }
  videojsMock.TextTrack = { prototype: { load: () => {} } }
  return { playerMock, videojsMock }
})

vi.mock('../src/renderer/src/player/videojs', () => ({ default: videojsMock }))

beforeAll(async () => {
  await initI18n()
})

const source = 'magnet:?xt=urn:btih:abc'
const title = 'The Shawshank Redemption'

function stubBridge(
  options: { show?: unknown; settings?: Record<string, unknown>; players?: unknown } = {},
) {
  const calls: Array<{ channel: string; payload: unknown }> = []
  const bridge = {
    invoke: async (channel: string, payload: unknown) => {
      calls.push({ channel, payload })
      switch (channel) {
        case 'stream:start':
          return { infoHash: 'hash-1', port: 41000, url: 'http://127.0.0.1:41000/0' }
        case 'media:getShow':
          return options.show
        case 'settings:all':
          return options.settings ?? {}
        case 'players:list':
          return options.players ?? []
        default:
          return undefined
      }
    },
    onProgress: () => () => undefined,
  } as unknown as PopcornBridge
  Object.defineProperty(window, 'popcorn', { value: bridge, configurable: true })
  return calls
}

function renderPlayer(extra: Record<string, string> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const query = new URLSearchParams({ source, title, quality: '1080p', ...extra })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/player?${query.toString()}`]}>
        <Routes>
          <Route path="/player" element={<PlayerPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('starts the stream and renders the legacy player markup', async () => {
  const calls = stubBridge()
  renderPlayer()

  await waitFor(() => {
    expect(document.querySelector('.player')).not.toBeNull()
  })
  expect(document.querySelector('#osd_play')).not.toBeNull()
  expect(screen.getAllByText(title).length).toBeGreaterThan(0)
  const start = calls.find((call) => call.channel === 'stream:start')
  expect(start?.payload).toMatchObject({ torrentId: source, fileIndex: 0 })
})

it('starts the stream and shows the external panel for a chosen external player', async () => {
  const calls = stubBridge({
    settings: { chosenPlayer: 'VLC' },
    players: [{ id: 'VLC', type: 'vlc', path: 'C:/VLC/vlc.exe' }],
  })
  renderPlayer()

  await waitFor(() => {
    expect(document.querySelector('.player-name')?.textContent).toBe('VLC')
  })
  const start = calls.find((call) => call.channel === 'stream:start')
  expect(start?.payload).toMatchObject({ torrentId: source, fileIndex: 0 })
  expect(calls.find((call) => call.channel === 'players:play')?.payload).toMatchObject({
    playerId: 'VLC',
    url: 'http://127.0.0.1:41000/0',
    port: 41000,
  })
})

it('renders the A-/A+ buttons from the legacy subtitle plugins', async () => {
  stubBridge()
  renderPlayer()

  await waitFor(() => {
    expect(document.querySelector('.vjs_biggersub_button')).not.toBeNull()
  })
  expect(document.querySelector('.vjs_smallersub_button')).not.toBeNull()
  expect(document.querySelector('.vjs_biggersub_button')?.textContent).toContain('A+')
  expect(document.querySelector('.vjs_smallersub_button')?.textContent).toContain('A-')
})

it('plays and pauses with the legacy space shortcut', async () => {
  stubBridge()
  renderPlayer()

  await waitFor(() => {
    expect(document.querySelector('.player')).not.toBeNull()
  })
  playerMock.paused.mockReturnValue(true)
  fireEvent.keyDown(window, { key: ' ' })
  expect(playerMock.play).toHaveBeenCalled()
})

it('resets the playback rate with the k shortcut', async () => {
  stubBridge()
  renderPlayer()

  await waitFor(() => {
    expect(document.querySelector('.player')).not.toBeNull()
  })
  fireEvent.keyDown(window, { key: 'k' })
  expect(playerMock.playbackRate).toHaveBeenCalledWith(1)
})

it('remembers the position when the player closes', async () => {
  const calls = stubBridge()
  const view = renderPlayer()

  await waitFor(() => {
    expect(document.querySelector('.player')).not.toBeNull()
  })
  playerMock.duration.mockReturnValue(100)
  playerMock.currentTime.mockReturnValue(40)
  view.unmount()

  const writes = calls.filter((call) => call.channel === 'settings:set')
  expect(writes).toContainEqual({
    channel: 'settings:set',
    payload: { key: 'lastWatchedTitle', value: title },
  })
  expect(writes).toContainEqual({
    channel: 'settings:set',
    payload: { key: 'lastWatchedTime', value: 35 },
  })
})

const showFixture = {
  type: 'show',
  imdb_id: 'tt0903747',
  tvdb_id: 81189,
  title: 'Breaking Bad',
  year: 2008,
  genres: ['Drama'],
  rating: { percentage: 90 },
  synopsis: 'A chemistry teacher turns to manufacturing.',
  episodes: [
    {
      season: 1,
      episode: 1,
      tvdb_id: 349232,
      torrents: { '1080p': { url: 'magnet:?xt=urn:btih:first', provider: 'tpbtv' } },
    },
    {
      season: 1,
      episode: 2,
      tvdb_id: 349233,
      torrents: { '1080p': { url: 'magnet:?xt=urn:btih:second', provider: 'tpbtv' } },
    },
  ],
}

it('offers the next episode in the final minute and plays it on demand', async () => {
  const calls = stubBridge({ show: showFixture, settings: { playNextEpisodeAuto: true } })
  renderPlayer({ imdbId: 'tt0903747', tvdbId: '81189', season: '1', episode: '1' })

  await waitFor(() => {
    expect(document.querySelector('.player')).not.toBeNull()
  })
  playerMock.duration.mockReturnValue(120)
  playerMock.currentTime.mockReturnValue(80)

  await waitFor(
    () => {
      expect(document.querySelector('#nextCountdown')?.textContent).toBe('40')
    },
    { timeout: 4000 },
  )
  const overlay = document.querySelector('.playing_next') as HTMLElement | null
  expect(overlay?.style.display).toBe('block')

  fireEvent.click(screen.getByText('Play Now'))
  await waitFor(() => {
    const started = calls.filter((call) => call.channel === 'stream:start')
    expect(
      started.some((call) =>
        String((call.payload as { torrentId?: string }).torrentId).includes('second'),
      ),
    ).toBe(true)
  })
})
