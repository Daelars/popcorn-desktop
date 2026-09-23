import type { BrowseItem } from '../browse'

export interface LibraryState {
  readonly bookmarked: boolean
  readonly watched: boolean
}

interface PosterProps {
  readonly item: BrowseItem
  readonly width: number
  readonly height: number
  readonly showRating: boolean
  readonly state: LibraryState
  readonly onOpen: (item: BrowseItem) => void
  readonly onToggleBookmark?: (item: BrowseItem) => void
}

function ratingOf(item: BrowseItem): number {
  return item.type === 'movie' ? item.rating : item.rating.percentage / 10
}

function posterUrl(item: BrowseItem): string | undefined {
  if (typeof item.poster === 'string' && item.poster.length > 0) return item.poster
  if (item.type === 'movie' && typeof item.image === 'string' && item.image.length > 0)
    return item.image
  if (item.type === 'show' && item.images?.poster !== undefined) return item.images.poster
  return undefined
}

const STAR_SLOTS = [0, 1, 2, 3, 4] as const

/** The legacy `.rating-stars` markup: full, half and empty Font Awesome stars. */
export function RatingStars({ rating }: { rating: number }) {
  const stars = Math.round(rating) / 2
  const full = Math.floor(stars)
  const hasHalf = stars % 1 > 0
  return (
    <div className="rating-stars">
      {STAR_SLOTS.slice(0, full).map((slot) => (
        <i key={`full-${slot}`} className="fa fa-star rating-star" aria-hidden />
      ))}
      {hasHalf ? (
        <span className="fa-stack rating-star-half-container">
          <i className="fa fa-star fa-stack-1x rating-star-half-empty" aria-hidden />
          <i className="fa fa-star-half fa-stack-1x rating-star-half" aria-hidden />
        </span>
      ) : null}
      {STAR_SLOTS.slice(Math.ceil(stars)).map((slot) => (
        <i key={`empty-${slot}`} className="fa fa-star rating-star-empty" aria-hidden />
      ))}
    </div>
  )
}

/** One poster, in the legacy item template's markup so the ported view CSS applies. */
export function Poster({ item, showRating, state, onOpen, onToggleBookmark }: PosterProps) {
  const poster = posterUrl(item)
  const rating = ratingOf(item)
  const quality =
    item.type === 'movie' ? Object.keys(item.torrents).join(', ').toLowerCase() : undefined
  const seasons = item.type === 'show' ? item.num_seasons : undefined

  return (
    <li className={`item${state.watched ? ' watched' : ''}`}>
      <div
        className={`cover${poster === undefined ? '' : ' fadein'}`}
        style={poster === undefined ? undefined : { backgroundImage: `url(${poster})` }}
      >
        <a
          className="cover-link"
          href={`#/detail/${item.imdb_id}`}
          aria-label={item.title}
          onClick={(event) => {
            event.preventDefault()
            onOpen(item)
          }}
        >
          <span className="sr-only">{item.title}</span>
        </a>
        <div className="cover-overlay cover-info-overlay">
          <button
            type="button"
            className={`fa fa-heart actions-favorites${state.bookmarked ? ' selected' : ''}`}
            aria-label={state.bookmarked ? 'bookmarked' : 'bookmark'}
            onClick={(event) => {
              event.stopPropagation()
              onToggleBookmark?.(item)
            }}
          />
          <i
            className={`fa fa-eye actions-watched${state.watched ? ' selected' : ''}`}
            aria-hidden
          />
          {showRating ? (
            <div className="rating" style={{ display: 'block' }}>
              <RatingStars rating={rating} />
              <div className="rating-value">{rating.toFixed(1)}/10</div>
            </div>
          ) : null}
        </div>
      </div>
      <p className="title" title={item.title}>
        {item.title}
      </p>
      <p className="year">{item.year}</p>
      {seasons === undefined ? null : (
        <p className="seasons">
          {seasons} {seasons === 1 ? 'Season' : 'Seasons'}
        </p>
      )}
      {quality === undefined || quality === '' ? null : (
        <p className="seasons quality">{quality}</p>
      )}
    </li>
  )
}
