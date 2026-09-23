import { useQuery } from '@tanstack/react-query'
import { Schema } from 'effect'
import { useParams } from 'react-router'
import { Movie, Show } from '../../../shared'
import { popcorn } from '../bridge'
import { MovieDetail } from '../components/MovieDetail'
import { ShowDetail } from '../components/ShowDetail'
import { getCachedMedia } from '../library'

/** Detail for a movie or show, read from the media cache by imdb id. */
export function DetailPage() {
  const { imdbId = '' } = useParams()
  const query = useQuery({
    queryKey: ['detail', imdbId],
    queryFn: () => getCachedMedia(imdbId),
    enabled: imdbId !== '',
  })
  const cached = query.data

  // A TMDB-sourced grid item carries no torrents, and a show no episodes; the resolver
  // fills both in when the title is opened (the legacy browse APIs returned them inline).
  const resolved = useQuery({
    queryKey: ['resolve', imdbId, cached?.type ?? ''],
    enabled: cached !== undefined,
    retry: false,
    queryFn: async () => {
      const bridge = popcorn()
      if (cached === undefined) return undefined
      const raw = await bridge.invoke('media:resolve', {
        type: cached.type === 'movie' ? 'movie' : 'tvshow',
        imdbId: cached.imdb_id,
        ...(cached.tmdb_id === undefined ? {} : { tmdbId: Number(cached.tmdb_id) }),
        title: cached.title,
        year: cached.year,
      })
      if (raw === undefined || raw === null) return undefined
      return cached.type === 'movie'
        ? Schema.decodeUnknownSync(Movie)(raw)
        : Schema.decodeUnknownSync(Show)(raw)
    },
  })

  const item = resolved.data ?? cached
  if (item === undefined) return <p className="grid place-items-center text-Text3">{imdbId}</p>
  return item.type === 'movie' ? <MovieDetail movie={item} /> : <ShowDetail show={item} />
}
