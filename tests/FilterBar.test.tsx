import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeAll, expect, it, vi } from 'vitest'
import { FilterBar } from '../src/renderer/src/components/FilterBar'
import { initI18n } from '../src/renderer/src/i18n'

beforeAll(async () => {
  await initI18n()
})

const options = {
  genres: { All: 'All', Action: 'Action' },
  sorters: { trending: 'Trending' },
  types: { All: 'All', '1080p': '1080p' },
  ratings: { All: 'All', r9: '9+' },
}

function renderBar(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FilterBar
          filters={{ order: -1 }}
          onChange={onChange}
          options={options}
          supportsQualityFilters={false}
          {...overrides}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return onChange
}

it('reports genre, sorter and search changes through the legacy dropdowns', () => {
  const onChange = renderBar()

  fireEvent.click(screen.getByLabelText('Genre'))
  fireEvent.click(screen.getByRole('button', { name: 'Action' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ genre: 'Action' }))

  fireEvent.click(screen.getByLabelText('Sort by'))
  fireEvent.click(screen.getByRole('button', { name: 'Trending' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sorter: 'trending' }))

  // `filter_bar.js` applied the search on submit and reset the genre.
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'dune' } })
  fireEvent.submit(screen.getByLabelText('Search').closest('form') as HTMLFormElement)
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ keywords: 'dune', genre: '' }))
})

it('shows the label for the selected sort key', () => {
  renderBar()
  // The dropdown displays the label ("Trending"), not the raw key ("trending").
  expect(screen.getByLabelText('Sort by').querySelector('.value')?.textContent).toBe('Trending')
})

it('shows the type and rating dropdowns only for providers that support them', () => {
  renderBar()
  expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Rating')).not.toBeInTheDocument()
})

it('renders the source tabs', () => {
  renderBar()
  expect(screen.getByRole('link', { name: 'Movies' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Favorites' })).toBeInTheDocument()
})
