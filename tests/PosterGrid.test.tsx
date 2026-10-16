import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import placeholder from '../resources/images/posterholder.png'
import type { BrowseItem } from '../src/renderer/src/browse'
import { Poster } from '../src/renderer/src/components/Poster'
import { computeColumns, PosterGrid } from '../src/renderer/src/components/PosterGrid'
import { initI18n } from '../src/renderer/src/i18n'
import type { ImdbId } from '../src/shared'

beforeAll(async () => {
  await initI18n()
})

const movie: BrowseItem = {
  type: 'movie',
  // Brands are compile-time; the fixture stands in for decoded provider data.
  imdb_id: 'tt0111161' as ImdbId,
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

describe('computeColumns', () => {
  it('fits as many posters as the container allows', () => {
    expect(computeColumns(960, 134)).toBe(6)
    expect(computeColumns(300, 134)).toBe(2)
  })

  it('never returns fewer than one column', () => {
    expect(computeColumns(100, 134)).toBe(1)
    expect(computeColumns(960, 0)).toBe(1)
  })
})

describe('Poster', () => {
  const base = {
    width: 134,
    height: 196,
    showRating: true,
    state: { bookmarked: false, watched: false },
    onOpen: () => undefined,
  }

  it('renders the legacy cover, title and rating overlay', () => {
    const { container } = render(<Poster item={movie} {...base} />)
    expect(screen.getAllByText('The Shawshank Redemption').length).toBeGreaterThan(0)
    expect(screen.getByText('8.7/10')).toBeInTheDocument()
    expect(container.querySelector('.cover')).toHaveStyle(`background-image: url(${movie.poster})`)
    expect(container.querySelector('.item .cover .cover-link')).toHaveAttribute(
      'href',
      '#/detail/tt0111161',
    )
  })

  it('hides the rating when the setting is off', () => {
    render(<Poster item={movie} {...base} showRating={false} />)
    expect(screen.queryByText('8.7/10')).not.toBeInTheDocument()
  })

  it('shows bookmark and watched overlays from library state', () => {
    const { container } = render(
      <Poster item={movie} {...base} state={{ bookmarked: true, watched: true }} />,
    )
    expect(screen.getByLabelText('bookmarked')).toHaveClass('selected')
    expect(container.querySelector('.actions-watched')).toHaveClass('selected')
    expect(container.querySelector('.item')).toHaveClass('watched')
  })

  it('falls back to the legacy placeholder when the provider has no poster', () => {
    const withoutPoster: BrowseItem = {
      ...movie,
      poster: false,
      image: false,
      poster_medium: false,
    }
    const { container } = render(<Poster item={withoutPoster} {...base} />)
    expect(container.querySelector('.cover')).toHaveStyle(`background-image: url(${placeholder})`)
    expect(container.querySelector('.cover')).toHaveClass('fadein')
  })

  it('marks the keyboard selection with the legacy selected class', () => {
    const { container } = render(<Poster item={movie} {...base} selected={true} />)
    expect(container.querySelector('.item')).toHaveClass('selected')
  })
})

describe('PosterGrid keyboard navigation', () => {
  const items: ReadonlyArray<BrowseItem> = [
    movie,
    { ...movie, imdb_id: 'tt0068646' as ImdbId, title: 'The Godfather' },
  ]

  function LocationProbe() {
    return <span data-testid="path">{useLocation().pathname}</span>
  }

  function renderGrid(onToggleBookmark: (item: BrowseItem) => void = () => undefined) {
    return render(
      <MemoryRouter>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <LocationProbe />
                <PosterGrid
                  items={items}
                  posterWidth={134}
                  sizeRatio={196 / 134}
                  showRating
                  library={new Map()}
                  hasMore={false}
                  isLoadingMore={false}
                  onLoadMore={() => undefined}
                  onToggleBookmark={onToggleBookmark}
                />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('moves the selection with the arrow keys and opens on Enter', () => {
    renderGrid()
    const selected = () => document.querySelectorAll('li.item.selected')
    expect(selected()).toHaveLength(0)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(selected()).toHaveLength(1)
    expect(selected()[0]).toHaveAttribute('data-imdb-id', 'tt0111161')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(selected()[0]).toHaveAttribute('data-imdb-id', 'tt0068646')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.getByTestId('path')).toHaveTextContent('/detail/tt0068646')
  })

  it('toggles the selected bookmark with f', () => {
    const onToggleBookmark = vi.fn()
    renderGrid(onToggleBookmark)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'f' })
    expect(onToggleBookmark).toHaveBeenCalledWith(items[0])
  })
})
