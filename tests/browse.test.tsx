import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { useBrowse } from '../src/renderer/src/browse'
import type { Filters } from '../src/shared'
import type { PopcornBridge } from '../src/shared/ipc'

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
  torrents: { '1080p': { url: 'magnet:?xt=urn:btih:abc', provider: 'Yts' } },
  langs: { en: { '1080p': { url: 'magnet:?xt=urn:btih:abc', provider: 'Yts' } } },
  defaultAudio: 'en',
}

function Harness({ provider, filters }: { provider: string; filters: Filters }) {
  const query = useBrowse(provider, filters)
  if (query.isPending) return <p>loading</p>
  if (query.isError) return <p role="alert">{String((query.error as Error).message)}</p>
  const items = query.data.pages.flatMap((page) => page.results)
  return (
    <ul>
      {items.map((item) => (
        <li key={item.imdb_id}>{item.title}</li>
      ))}
    </ul>
  )
}

function stubBridge(result: unknown) {
  const bridge = {
    invoke: async () => result,
    onProgress: () => () => undefined,
  } as unknown as PopcornBridge
  Object.defineProperty(window, 'popcorn', { value: bridge, configurable: true })
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Harness provider="yts" filters={{}} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  stubBridge({ results: [movie], hasMore: false })
})

it('renders decoded items from the provider page', async () => {
  renderHarness()
  await waitFor(() => {
    expect(screen.getByText('The Shawshank Redemption')).toBeInTheDocument()
  })
})

it('fails the query on a malformed provider payload instead of showing an empty grid', async () => {
  stubBridge({ results: [{ imdb_id: 42 }], hasMore: false })
  renderHarness()
  await waitFor(() => {
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
