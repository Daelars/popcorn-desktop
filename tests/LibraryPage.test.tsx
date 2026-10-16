import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeAll, expect, it, vi } from 'vitest'
import { initI18n } from '../src/renderer/src/i18n'
import { Notifications } from '../src/renderer/src/notify'
import { LibraryPage } from '../src/renderer/src/routes/LibraryPage'
import type { PopcornBridge } from '../src/shared/ipc'

// jsdom has no layout, so the virtualizer is stubbed to render every row.
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

const cachedMovie = {
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
  torrents: { '1080p': { url: 'magnet:?xt=urn:btih:abc', provider: 'Yts' } },
  langs: { en: { '1080p': { url: 'magnet:?xt=urn:btih:abc', provider: 'Yts' } } },
  defaultAudio: 'en',
}

const olderMovie = {
  ...cachedMovie,
  imdb_id: 'tt0068646',
  title: 'The Godfather',
  year: 1972,
  rating: 9.2,
}

interface BridgeOptions {
  readonly bookmarks?: ReadonlyArray<{ imdbId: string; type: string }>
  readonly watched?: ReadonlyArray<string>
  readonly movies?: Readonly<Record<string, unknown>>
}

function stubBridge(options: BridgeOptions = {}) {
  // Bookmarks mutate so remove/add (the undo path) is observable in the grid.
  const bookmarks = new Map((options.bookmarks ?? []).map((entry) => [entry.imdbId, entry.type]))
  const watched = new Set(options.watched ?? [])
  const bridge = {
    invoke: async (channel: string, payload?: { imdbId?: string; type?: string }) => {
      switch (channel) {
        case 'bookmarks:list':
          return [...bookmarks].map(([imdbId, type]) => ({ imdbId, type }))
        case 'bookmarks:add':
          if (payload?.imdbId !== undefined) bookmarks.set(payload.imdbId, payload.type ?? 'movie')
          return undefined
        case 'bookmarks:remove':
          if (payload?.imdbId !== undefined) bookmarks.delete(payload.imdbId)
          return undefined
        case 'watched:movies':
          return [...watched]
        case 'media:getMovie': {
          const imdbId = payload?.imdbId
          return imdbId === undefined ? undefined : options.movies?.[imdbId]
        }
        case 'media:getShow':
          return undefined
        default:
          return undefined
      }
    },
    onProgress: () => () => undefined,
  } as unknown as PopcornBridge
  Object.defineProperty(window, 'popcorn', { value: bridge, configurable: true })
}

function renderPage(kind: 'favorites' | 'watched') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LibraryPage kind={kind} title={kind === 'favorites' ? 'Favorites' : 'Watched'} />
        <Notifications />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Poster titles in DOM order, which is the sort order the page produced. */
function posterTitles(): ReadonlyArray<string> {
  return [...document.querySelectorAll('.item .title')].map((node) => node.textContent ?? '')
}

it('renders bookmarked items hydrated from the media cache', async () => {
  stubBridge({
    bookmarks: [{ imdbId: 'tt0111161', type: 'movie' }],
    movies: { tt0111161: cachedMovie },
  })
  renderPage('favorites')
  await waitFor(() => {
    expect(screen.getAllByText('The Shawshank Redemption').length).toBeGreaterThan(0)
  })
})

it('renders watched items hydrated from the media cache', async () => {
  stubBridge({ watched: ['tt0111161'], movies: { tt0111161: cachedMovie } })
  renderPage('watched')
  await waitFor(() => {
    expect(screen.getAllByText('The Shawshank Redemption').length).toBeGreaterThan(0)
  })
})

it('shows the empty state when nothing is cached', async () => {
  stubBridge({ bookmarks: [{ imdbId: 'tt0000000', type: 'movie' }] })
  renderPage('favorites')
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Favorites' })).toBeInTheDocument()
  })
})

it('offers the legacy library sorters and sorts with them', async () => {
  stubBridge({
    bookmarks: [
      { imdbId: 'tt0068646', type: 'movie' },
      { imdbId: 'tt0111161', type: 'movie' },
    ],
    movies: { tt0068646: olderMovie, tt0111161: cachedMovie },
  })
  renderPage('favorites')
  await waitFor(() => {
    expect(posterTitles()).toHaveLength(2)
  })

  // The default sorter is `watched items`; equally-unwatched items keep their bookmark order.
  expect(posterTitles()).toEqual(['The Godfather', 'The Shawshank Redemption'])

  fireEvent.click(screen.getByLabelText('Sort by'))
  for (const label of ['Watched Items', 'Year', 'Title', 'Rating']) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  }

  fireEvent.click(screen.getByRole('button', { name: 'Year' }))
  await waitFor(() => {
    expect(posterTitles()).toEqual(['The Shawshank Redemption', 'The Godfather'])
  })
})

it('offers an undo when a bookmark is removed from the library view', async () => {
  stubBridge({
    bookmarks: [{ imdbId: 'tt0111161', type: 'movie' }],
    movies: { tt0111161: cachedMovie },
  })
  renderPage('favorites')
  await waitFor(() => {
    expect(posterTitles()).toHaveLength(1)
  })

  fireEvent.click(screen.getByRole('button', { name: 'bookmarked' }))

  // The item leaves the grid and the toast offers Undo (`item.js:toggleFavorite`).
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Favorites' })).toBeInTheDocument()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  await waitFor(() => {
    expect(posterTitles()).toEqual(['The Shawshank Redemption'])
  })
})
