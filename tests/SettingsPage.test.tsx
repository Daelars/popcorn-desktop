import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeAll, expect, it } from 'vitest'
import { initI18n } from '../src/renderer/src/i18n'
import { SettingsPage } from '../src/renderer/src/routes/SettingsPage'
import type { PopcornBridge } from '../src/shared/ipc'

beforeAll(async () => {
  await initI18n()
})

function stubBridge(settings: Record<string, unknown> = {}) {
  const calls: Array<{ channel: string; payload: unknown }> = []
  const bridge = {
    invoke: async (channel: string, payload: unknown) => {
      calls.push({ channel, payload })
      if (channel === 'settings:all') {
        return settings
      }
      return undefined
    },
    onProgress: () => () => undefined,
  } as unknown as PopcornBridge
  Object.defineProperty(window, 'popcorn', { value: bridge, configurable: true })
  return calls
}

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('renders the legacy settings sections with their values', async () => {
  stubBridge({ theme: 'Official_-_Dark_theme', postersWidth: 134 })
  renderSettings()

  await waitFor(() => {
    expect(screen.getByText('User Interface')).toBeInTheDocument()
  })
  expect(screen.getByText('Subtitles')).toBeInTheDocument()
  expect(screen.getByText('Connection')).toBeInTheDocument()
  await waitFor(() => {
    expect(screen.getByLabelText('Poster Size')).toHaveValue('134')
  })
})

it('writes a change through the settings channel', async () => {
  const calls = stubBridge({ moviesTabEnable: true })
  renderSettings()

  await waitFor(() => {
    expect(screen.getByRole('checkbox', { name: 'Movies' })).toBeChecked()
  })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Movies' }))
  await waitFor(() => {
    expect(
      calls.some(
        (call) =>
          call.channel === 'settings:set' &&
          JSON.stringify(call.payload) === JSON.stringify({ key: 'moviesTabEnable', value: false }),
      ),
    ).toBe(true)
  })
})
