import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeAll, expect, it, vi } from 'vitest'
import { initI18n } from '../src/renderer/src/i18n'
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

function stubBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    invoke: async (channel: string) => {
      switch (channel) {
        case 'bookmarks:list':
          return overrides.bookmarks ?? []
        case 'watched:movies':
          return overrides.watched ?? []
        case 'media:getMovie':
          return overrides.movie
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
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('renders bookmarked items hydrated from the media cache', async () => {
  stubBridge({ bookmarks: [{ imdbId: 'tt0111161', type: 'movie' }], movie: cachedMovie })
  renderPage('favorites')
  await waitFor(() => {
    expect(screen.getAllByText('The Shawshank Redemption').length).toBeGreaterThan(0)
  })
})

it('renders watched items hydrated from the media cache', async () => {
  stubBridge({ watched: ['tt0111161'], movie: cachedMovie })
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
