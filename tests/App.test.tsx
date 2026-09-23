import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, expect, it } from 'vitest'
import App from '../src/renderer/src/App'
import { initI18n } from '../src/renderer/src/i18n'
import type { PopcornBridge } from '../src/shared/ipc'

beforeAll(async () => {
  await initI18n()
})

function stubBridge(
  settings: Record<string, unknown> = {},
  disclaimer: () => Promise<unknown> = async () => ({ accepted: true }),
) {
  const bridge = {
    invoke: async (channel: string) => {
      switch (channel) {
        case 'settings:all':
          return settings
        case 'browse:providers':
          return []
        case 'bookmarks:list':
        case 'watched:movies':
          return []
        case 'browse:fetch':
          return { results: [], hasMore: false }
        case 'browse:filters':
          return { genres: {}, sorters: {} }
        case 'media:getMovie':
        case 'media:getShow':
          return undefined
        case 'disclaimer:status':
          return disclaimer()
        default:
          return undefined
      }
    },
    onProgress: () => () => undefined,
    onOpenFile: () => () => undefined,
    onUpdateStatus: () => () => undefined,
  } as unknown as PopcornBridge
  Object.defineProperty(window, 'popcorn', { value: bridge, configurable: true })
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  stubBridge()
})

it('renders the shell with every enabled tab', async () => {
  renderApp()
  // The boot splash is shown until the settings arrive; the shell follows.
  await waitFor(() => {
    expect(screen.getByRole('link', { name: 'Movies' })).toBeInTheDocument()
  })
  expect(screen.getAllByText('Popcorn Time').length).toBeGreaterThan(0)
  expect(screen.getByRole('link', { name: 'Series' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Anime' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Favorites' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Watched' })).toBeInTheDocument()
})

it('routes between tabs', async () => {
  renderApp()
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument()
  })
  fireEvent.click(screen.getByRole('link', { name: 'Series' }))
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Series' })).toBeInTheDocument()
  })
})

it('hides a tab the settings disable', async () => {
  stubBridge({ animeTabEnable: false })
  renderApp()
  await waitFor(() => {
    expect(screen.getByRole('link', { name: 'Movies' })).toBeInTheDocument()
  })
  expect(screen.queryByRole('link', { name: 'Anime' })).not.toBeInTheDocument()
})

it('applies the theme from settings', async () => {
  stubBridge({ theme: 'Official_-_Light_theme' })
  renderApp()
  await waitFor(() => {
    expect(document.documentElement.dataset.theme).toBe('Official_-_Light_theme')
  })
})

it('hides the disclaimer when it is already accepted', async () => {
  stubBridge()
  renderApp()
  await waitFor(() => {
    expect(screen.getByRole('link', { name: 'Movies' })).toBeInTheDocument()
  })
  expect(screen.queryByText('Terms of Service')).not.toBeInTheDocument()
})

it('shows the disclaimer when the status check fails', async () => {
  stubBridge({}, async () => {
    throw new Error('ipc down')
  })
  renderApp()
  await waitFor(() => {
    expect(screen.getByText('Terms of Service')).toBeInTheDocument()
  })
})
