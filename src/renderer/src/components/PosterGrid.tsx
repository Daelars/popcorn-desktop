import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { BrowseItem } from '../browse'
import { type LibraryState, Poster } from './Poster'

/** Columns that fit in the container, at least one. Pure so it can be tested. */
export function computeColumns(containerWidth: number, posterWidth: number, gap = 20): number {
  if (posterWidth <= 0) return 1
  return Math.max(1, Math.floor((containerWidth + gap) / (posterWidth + gap)))
}

interface PosterGridProps {
  readonly items: ReadonlyArray<BrowseItem>
  readonly posterWidth: number
  readonly sizeRatio: number
  readonly showRating: boolean
  readonly library: ReadonlyMap<string, LibraryState>
  readonly hasMore: boolean
  readonly isLoadingMore: boolean
  readonly onLoadMore: () => void
  readonly onToggleBookmark?: (item: BrowseItem) => void
}

const FONT_MIN = 0.8
const FONT_MAX = 1.3
const WIDTH_MIN = 134
const WIDTH_MAX = 294

/**
 * The legacy grid: `.list > ul.items > li.item` laid out with floats, sized by a runtime
 * stylesheet the original app injected from the poster settings.
 */
export function PosterGrid({
  items,
  posterWidth,
  sizeRatio,
  showRating,
  library,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onToggleBookmark,
}: PosterGridProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLUListElement>(null)
  const navigate = useNavigate()
  const posterHeight = Math.round(posterWidth * sizeRatio)
  const fontSize =
    ((FONT_MAX - FONT_MIN) * ((posterWidth - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN)) * 100) / 100 +
    FONT_MIN

  // `list.js:addloadmore` hid the row unless a full page came back, because a provider that
  // claimed `hasMore` with nothing new would loop. Pages differ in size (TMDB returns 20,
  // the torrent lists 50), so any non-empty page with more to come keeps the row.
  const showLoadMore = hasMore && items.length > 0

  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'postersSizeStylesheet'
    style.textContent = [
      `.list .items .item { width: ${posterWidth}px; }`,
      `.list .items .item .cover, .load-more {`,
      `background-size: ${posterWidth}px ${posterHeight}px;`,
      `width: ${posterWidth}px; height: ${posterHeight}px; }`,
      `.item { font-size: ${fontSize}em; }`,
    ].join('')
    document.getElementById('postersSizeStylesheet')?.remove()
    document.head.append(style)
    return () => style.remove()
  }, [posterWidth, posterHeight, fontSize])

  const onScroll = () => {
    const element = scrollRef.current
    if (element === null || !showLoadMore || isLoadingMore) return
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 800) {
      onLoadMore()
    }
  }

  // The load-more row also triggers the feed when it is already in view: a page can be
  // shorter than the viewport (TMDB returns 20 items), which would otherwise stall. The
  // callback lives in a ref so a re-render does not rebuild the observer and re-fire it.
  const loadMoreRow = useRef<HTMLLIElement>(null)
  const loadMore = useRef(onLoadMore)
  loadMore.current = onLoadMore
  useEffect(() => {
    const row = loadMoreRow.current
    if (row === null || !showLoadMore || isLoadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore.current()
      },
      { root: scrollRef.current, rootMargin: '400px' },
    )
    observer.observe(row)
    return () => observer.disconnect()
  }, [showLoadMore, isLoadingMore])

  // The legacy list view puts the media type on the container; its CSS lays out the flex rows.
  const container = items.some((item) => item.type === 'movie') ? 'items_movie' : 'items_show'

  return (
    <div className="list">
      {/* The legacy stylesheet makes the inner `ul.items` the scroller, not `.list`. */}
      <ul className={`items ${container}`} ref={scrollRef} onScroll={onScroll}>
        {items.map((item) => (
          <Poster
            key={item.imdb_id}
            item={item}
            width={posterWidth}
            height={posterHeight}
            showRating={showRating}
            state={library.get(item.imdb_id) ?? { bookmarked: false, watched: false }}
            onOpen={(opened) => navigate(`/detail/${opened.imdb_id}`)}
            {...(onToggleBookmark === undefined ? {} : { onToggleBookmark })}
          />
        ))}
        {showLoadMore ? (
          <li
            id="load-more-item"
            className="load-more"
            role="button"
            tabIndex={0}
            ref={loadMoreRow}
            onClick={() => {
              if (!isLoadingMore) onLoadMore()
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              if (!isLoadingMore) onLoadMore()
            }}
          >
            <span
              className="status-loadmore"
              style={isLoadingMore ? { display: 'none' } : undefined}
            >
              {t('Load More')}
            </span>
            <div
              id="loading-more-animi"
              className="loading-container"
              style={isLoadingMore ? undefined : { display: 'none' }}
            >
              <div className="ball" />
              <div className="ball1" />
            </div>
            <span id="overlay" />
          </li>
        ) : null}
      </ul>
    </div>
  )
}
