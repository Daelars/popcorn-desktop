import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BrowseItem } from '../src/renderer/src/browse'
import { Poster } from '../src/renderer/src/components/Poster'
import { computeColumns } from '../src/renderer/src/components/PosterGrid'
import type { ImdbId } from '../src/shared'

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
})
