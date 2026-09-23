import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Schema } from 'effect'
import { MediaItem } from '../../shared'
import type { BrowseItem } from './browse'
import type { LibraryState } from './components/Poster'

/** Bookmarks and watched movies from the database, keyed by imdb id. */
export function useLibraryState() {
  return useQuery({
    queryKey: ['library'],
    queryFn: async (): Promise<ReadonlyMap<string, LibraryState>> => {
      const bridge = window.popcorn
      if (bridge === undefined) {
        throw new Error('IPC bridge unavailable')
      }
      const [bookmarks, watched] = await Promise.all([
        bridge.invoke('bookmarks:list', {}),
        bridge.invoke('watched:movies', {}),
      ])
      const bookmarkSet = new Set(bookmarks.map((bookmark) => bookmark.imdbId))
      const watchedSet = new Set(watched)
      const ids = new Set([...bookmarkSet, ...watchedSet])
      return new Map(
        [...ids].map((id) => [
          id,
          { bookmarked: bookmarkSet.has(id), watched: watchedSet.has(id) },
        ]),
      )
    },
  })
}

export async function getCachedMedia(imdbId: string): Promise<BrowseItem | undefined> {
  const bridge = window.popcorn
  if (bridge === undefined) {
    throw new Error('IPC bridge unavailable')
  }
  const movie = await bridge.invoke('media:getMovie', { imdbId })
  const show = movie === undefined ? await bridge.invoke('media:getShow', { imdbId }) : undefined
  const raw = movie ?? show
  if (raw === undefined) return undefined
  const decoded = Schema.decodeUnknownOption(MediaItem)(raw)
  return decoded._tag === 'Some' ? decoded.value : undefined
}

async function cachedItems(ids: ReadonlyArray<string>): Promise<ReadonlyArray<BrowseItem>> {
  const items = await Promise.all(ids.map((id) => getCachedMedia(id)))
  return items.filter((item): item is BrowseItem => item !== undefined)
}

/** Watched episodes for one show, keyed by `season:episode`. */
export function useWatchedEpisodes(tvdbId: number) {
  return useQuery({
    queryKey: ['watched-episodes', tvdbId],
    queryFn: async (): Promise<ReadonlySet<string>> => {
      const bridge = window.popcorn
      if (bridge === undefined) {
        throw new Error('IPC bridge unavailable')
      }
      const episodes = await bridge.invoke('watched:episodes', { tvdbId: String(tvdbId) })
      return new Set(episodes.map((episode) => `${episode.season}:${episode.episode}`))
    },
  })
}

export function useToggleWatchedMovie() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ imdbId, watched }: { imdbId: string; watched: boolean }) => {
      const bridge = window.popcorn
      if (bridge === undefined) {
        throw new Error('IPC bridge unavailable')
      }
      if (watched) await bridge.invoke('watched:unmarkMovie', { imdbId })
      else await bridge.invoke('watched:markMovie', { imdbId })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['library'] })
      void client.invalidateQueries({ queryKey: ['watched'] })
    },
  })
}

export function useToggleWatchedEpisode() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      tvdbId,
      imdbId,
      season,
      episode,
      watched,
    }: {
      tvdbId: string
      imdbId: string
      season: string
      episode: string
      watched: boolean
    }) => {
      const bridge = window.popcorn
      if (bridge === undefined) {
        throw new Error('IPC bridge unavailable')
      }
      const ref = { tvdbId, imdbId, season, episode }
      if (watched) await bridge.invoke('watched:unmarkEpisode', ref)
      else await bridge.invoke('watched:markEpisode', ref)
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['watched-episodes'] })
      void client.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

/** Favorites: bookmarked ids, hydrated from the media cache. */
export function useFavoriteItems() {
  return useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      const bridge = window.popcorn
      if (bridge === undefined) {
        throw new Error('IPC bridge unavailable')
      }
      const bookmarks = await bridge.invoke('bookmarks:list', {})
      return cachedItems(bookmarks.map((bookmark) => bookmark.imdbId))
    },
  })
}

/** Watched: watched movie ids, hydrated from the media cache. */
export function useWatchedItems() {
  return useQuery({
    queryKey: ['watched'],
    queryFn: async () => {
      const bridge = window.popcorn
      if (bridge === undefined) {
        throw new Error('IPC bridge unavailable')
      }
      return cachedItems(await bridge.invoke('watched:movies', {}))
    },
  })
}

export function useToggleBookmark() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (item: BrowseItem) => {
      const bridge = window.popcorn
      if (bridge === undefined) {
        throw new Error('IPC bridge unavailable')
      }
      const bookmarked = await bridge.invoke('bookmarks:list', {})
      const exists = bookmarked.some((bookmark) => bookmark.imdbId === item.imdb_id)
      if (exists) {
        await bridge.invoke('bookmarks:remove', { imdbId: item.imdb_id })
      } else {
        await bridge.invoke('bookmarks:add', { imdbId: item.imdb_id, type: item.type })
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['library'] })
      void client.invalidateQueries({ queryKey: ['favorites'] })
    },
  })
}
