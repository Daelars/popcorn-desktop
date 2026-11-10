import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeAll, expect, it, vi } from 'vitest'
import { initI18n } from '../src/renderer/src/i18n'
import { DetailPage } from '../src/renderer/src/routes/DetailPage'
import type { PopcornBridge } from '../src/shared/ipc'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 200,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 200 })),
  }),
}))

beforeAll(async () => {
  await initI18n()
})

const movie = {
  type: 'movie',
  imdb_id: 'tt0111161',
  title: 'The Shawshank Redemption',
  year: 1994,
  genre: ['Drama'],
  rating: 8.7,
  runtime: 142,
  image: 'https://example.test/poster.jpg',
  cover: 'https://example.test/poster.jpg',
  backdrop: false,
  poster: 'https://example.test/poster.jpg',
  poster_medium: false,
  synopsis: 'Two imprisoned men bond.',
  trailer: false,
  torrents: {
    '1080p': { url: 'magnet:?xt=urn:btih:abc', provider: 'Yts', filesize: '2.4 GB', seed: 421 },
    '720p': { url: 'magnet:?xt=urn:btih:def', provider: 'Yts', filesize: '1.1 GB', seed: 200 },
  },
  langs: {},
  defaultAudio: 'en',
}

const show = {
  type: 'show',
  imdb_id: 'tt0944947',
  tvdb_id: 121361,
  title: 'Game of Thrones',
  year: 2011,
  genres: ['Drama'],
  rating: { percentage: 92 },
  synopsis: 'Nine noble families fight for control.',
  episodes: [
    { season: 1, episode: 1, tvdb_id: 1, title: 'Winter Is Coming', torrents: {} },
    { season: 2, episode: 1, tvdb_id: 2, title: 'The North Remembers', torrents: {} },
  ],
}

function stubBridge(media: unknown, overrides: Record<string, unknown> = {}) {
  const calls: Array<{ channel: string; payload: unknown }> = []
  const bridge = {
    invoke: async (channel: string, payload: unknown) => {
      calls.push({ channel, payload })
      switch (channel) {
        case 'media:getMovie':
          return media !== undefined && (media as { type?: string }).type === 'movie'
            ? media
            : undefined
        case 'media:getShow':
          return media !== undefined && (media as { type?: string }).type === 'show'
            ? media
            : undefined
        case 'bookmarks:list':
        case 'watched:movies':
          return overrides.watchedMovies ?? []
        case 'watched:episodes':
          return overrides.episodes ?? []
        case 'playback:targets':
          return [{ kind: 'local', id: 'local', name: 'Popcorn Time' }]
        default:
          return undefined
      }
    },
    onProgress: () => () => undefined,
  } as unknown as PopcornBridge
  Object.defineProperty(window, 'popcorn', { value: bridge, configurable: true })
  return calls
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/detail/tt0111161']}>
        <Routes>
          <Route path="/detail/:imdbId" element={<DetailPage />} />
          <Route path="/select" element={<SelectProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Exposes the query Watch Now navigates to, without rendering the select page. */
function SelectProbe() {
  return <div data-testid="select-location">{useLocation().search}</div>
}

it('renders a movie detail with quality options and marks it watched', async () => {
  const calls = stubBridge(movie)
  renderDetail()

  await waitFor(() => {
    // The title appears in the header and, for an untitled torrent, in the torrent row.
    expect(screen.getAllByText(/The Shawshank Redemption/).length).toBeGreaterThan(0)
  })
  expect(screen.getByText(/2.4 GB/)).toBeInTheDocument()

  screen.getByRole('button', { name: 'Not Seen' }).click()
  await waitFor(() => {
    expect(calls.some((call) => call.channel === 'watched:markMovie')).toBe(true)
  })
})

it('renders a show detail and switches seasons', async () => {
  stubBridge(show)
  renderDetail()

  await waitFor(() => {
    expect(screen.getByText(/Winter Is Coming/)).toBeInTheDocument()
  })
  expect(screen.queryByText(/The North Remembers/)).not.toBeInTheDocument()

  // The seasons are anchors, matching `show-detail.tpl` and the stylesheet's `ul a` rules.
  screen.getByRole('link', { name: /Season 2/ }).click()
  await waitFor(() => {
    expect(screen.getByText(/The North Remembers/)).toBeInTheDocument()
  })
})

it('toggles an episode as watched over IPC', async () => {
  const calls = stubBridge(show)
  renderDetail()

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Mark watched' })).toBeInTheDocument()
  })
  screen.getAllByRole('button', { name: 'Mark watched' })[0]?.click()
  await waitFor(() => {
    expect(calls.some((call) => call.channel === 'watched:markEpisode')).toBe(true)
  })
})

const packShow = {
  type: 'show',
  imdb_id: 'tt0000001',
  tvdb_id: 999,
  title: 'Pack Show',
  year: 2020,
  genres: ['Drama'],
  rating: { percentage: 80 },
  synopsis: 'Episodes in one season.',
  episodes: [
    {
      season: 1,
      episode: 1,
      tvdb_id: 11,
      title: 'One',
      torrents: { '1080p': { url: 'magnet:?xt=urn:btih:ep1', provider: 'tpbtv' } },
    },
    {
      season: 1,
      episode: 2,
      tvdb_id: 12,
      title: 'Two',
      torrents: { '1080p': { url: 'magnet:?xt=urn:btih:ep2', provider: 'tpbtv' } },
    },
  ],
}

it('plays the changed episode when Watch Now is pressed', async () => {
  stubBridge(packShow)
  renderDetail()

  await waitFor(() => {
    expect(screen.getByText('One')).toBeInTheDocument()
  })

  // The quality selector must re-pick for the new episode; otherwise Watch Now has no torrent.
  screen.getByRole('link', { name: /Two/ }).click()
  // Let the remounted selector's effect publish the new episode's default quality.
  await new Promise((resolve) => setTimeout(resolve, 0))
  fireEvent.click(document.querySelector('#watch-now') as HTMLElement)

  await waitFor(() => {
    expect(screen.getByTestId('select-location').textContent).toContain('ep2')
  })
})
