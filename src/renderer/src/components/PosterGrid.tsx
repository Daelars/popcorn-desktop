import { useCallback, useEffect, useRef, useState } from 'react'
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
  /** `watched` is the current state so the caller can invert it. */
  readonly onToggleWatched?: (item: BrowseItem, watched: boolean) => void
  /** Ctrl +/- and Alt+wheel step the poster width; the page persists the setting. */
  readonly onResizePoster?: (direction: 1 | -1) => void
}

const FONT_MIN = 0.8
const FONT_MAX = 1.3
/** The poster width bounds the legacy `postersMinWidth`/`postersMaxWidth` set. */
export const POSTER_WIDTH_MIN = 134
export const POSTER_WIDTH_MAX = 294

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
  onToggleWatched,
  onResizePoster,
}: PosterGridProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLUListElement>(null)
  const navigate = useNavigate()
  const posterHeight = Math.round(posterWidth * sizeRatio)
  const fontSize =
    ((FONT_MAX - FONT_MIN) *
      ((posterWidth - POSTER_WIDTH_MIN) / (POSTER_WIDTH_MAX - POSTER_WIDTH_MIN)) *
      100) /
      100 +
    FONT_MIN

  // `list.js:selectIndex` kept one `li.item` selected and scrolled it into view. The grid
  // index, not a DOM class, is the source of truth; `Poster` renders `.selected` from it.
  const [selected, setSelected] = useState<number | null>(null)

  // `list.js:addloadmore` hid the row unless a full page came back, because a provider that
  // claimed `hasMore` with nothing new would loop. Pages differ in size (TMDB returns 20,
  // the torrent lists 50), so any non-empty page with more to come keeps the row.
  const showLoadMore = hasMore && items.length > 0

  // A new tab resets the collection below the old index; drop the stale selection.
  useEffect(() => {
    setSelected((current) => (current !== null && current >= items.length ? null : current))
  }, [items.length])

  const columnCount = useCallback((): number => {
    return computeColumns(scrollRef.current?.clientWidth ?? 0, posterWidth)
  }, [posterWidth])

  const selectAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= items.length) return
      setSelected(index)
      scrollRef.current?.querySelectorAll<HTMLElement>('li.item')[index]?.scrollIntoView({
        block: 'nearest',
      })
    },
    [items.length],
  )

  // `list.js:moveUp/moveDown/moveLeft/moveRight`: with nothing selected any arrow picks the
  // first poster; otherwise the index moves and out-of-range moves are no-ops.
  const move = useCallback(
    (delta: number) => {
      if (selected === null) {
        selectAt(0)
        return
      }
      selectAt(selected + delta)
    },
    [selected, selectAt],
  )

  const openAt = useCallback(
    (index: number | null) => {
      const item = index === null ? undefined : items[index]
      if (item !== undefined) navigate(`/detail/${item.imdb_id}`)
    },
    [items, navigate],
  )

  // The keys `list.js:initKeyboardShortcuts` bound on the browse list: arrows select,
  // enter/space opens, f toggles the bookmark and w the watched state of the selection.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      if (event.ctrlKey || event.metaKey) {
        if (event.key === '+' || event.key === '=') {
          event.preventDefault()
          onResizePoster?.(1)
        } else if (event.key === '-' || event.key === '_') {
          event.preventDefault()
          onResizePoster?.(-1)
        }
        return
      }
      if (event.altKey) return
      const selectedItem = selected === null ? undefined : items[selected]
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          move(-columnCount())
          break
        case 'ArrowDown':
          event.preventDefault()
          move(columnCount())
          break
        case 'ArrowLeft':
          event.preventDefault()
          move(-1)
          break
        case 'ArrowRight':
          event.preventDefault()
          move(1)
          break
        case 'Enter':
        case ' ':
          // A focused button, link or the load-more row owns its own activation.
          if (target instanceof HTMLElement && target.closest('button, a, [role="button"]')) return
          event.preventDefault()
          openAt(selected)
          break
        case 'f':
        case 'F':
          if (selectedItem !== undefined) onToggleBookmark?.(selectedItem)
          break
        case 'w':
        case 'W':
          // `item.js:setCoverStates` removed the watched icon for shows, so w only applies to movies.
          if (selectedItem?.type === 'movie')
            onToggleWatched?.(selectedItem, library.get(selectedItem.imdb_id)?.watched ?? false)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    items,
    selected,
    library,
    move,
    columnCount,
    openAt,
    onToggleBookmark,
    onToggleWatched,
    onResizePoster,
  ])

  // `list.js:initPosterResizeKeys`: Alt+wheel resized the posters. Bound natively so the
  // browser's default zoom is cancelled (React's wheel listener is passive).
  useEffect(() => {
    const element = scrollRef.current
    if (element === null || onResizePoster === undefined) return
    const onWheel = (event: WheelEvent) => {
      if (!event.altKey) return
      event.preventDefault()
      onResizePoster(event.deltaY < 0 ? 1 : -1)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [onResizePoster])

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
        {items.map((item, index) => (
          <Poster
            key={item.imdb_id}
            item={item}
            width={posterWidth}
            height={posterHeight}
            showRating={showRating}
            selected={index === selected}
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
