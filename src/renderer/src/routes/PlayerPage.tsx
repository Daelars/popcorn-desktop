import { useQuery } from '@tanstack/react-query'
import { Schema } from 'effect'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { Show } from '../../../shared'
import { nextEpisode as nextEpisodeRule } from '../../../shared/playback-rules'
import { popcorn } from '../bridge'
import { ExternalPlayerPanel } from '../components/ExternalPlayerPanel'
import { LoadingScreen } from '../components/LoadingScreen'
import {
  type NextEpisode,
  Player,
  type PlayerMedia,
  type SubtitleTrack,
} from '../components/Player'
import { failureText } from '../failure'
import { useSetting } from '../settings'

/** Starts a torrent stream for one file of a torrent and plays it, stopping it on exit. */
export function PlayerPage() {
  const [params] = useSearchParams()
  const source = params.get('source') ?? ''
  // A dropped local file arrives as `?local=<path>`; `handleVideoFile` played it directly.
  const localPath = params.get('local') ?? ''
  const trailer = params.get('trailer')
  const backdrop = params.get('backdrop') ?? ''
  const title = params.get('title') ?? ''
  const quality = params.get('quality') ?? ''
  /** The provider subtitle picked on the detail page, as `defaultSubtitle` used to travel. */
  const subtitleLang = params.get('subtitleLang') ?? ''
  const imdbId = params.get('imdbId') ?? ''
  const media = useMemo<PlayerMedia>(
    () => ({
      ...(params.get('imdbId') === null ? {} : { imdbId: params.get('imdbId') ?? '' }),
      ...(params.get('tvdbId') === null ? {} : { tvdbId: params.get('tvdbId') ?? '' }),
      ...(params.get('season') === null ? {} : { season: params.get('season') ?? '' }),
      ...(params.get('episode') === null ? {} : { episode: params.get('episode') ?? '' }),
    }),
    [params],
  )
  const requestedFile = Number(params.get('file') ?? '0')
  const fileIndex = Number.isInteger(requestedFile) && requestedFile >= 0 ? requestedFile : 0
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [src, setSrc] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const [minimized, setMinimized] = useState(false)
  const [localTitle, setLocalTitle] = useState('')
  const [subtitles, setSubtitles] = useState<ReadonlyArray<SubtitleTrack>>([])
  const sessionPort = useRef<number | undefined>(undefined)
  const sessionId = useRef<string | undefined>(undefined)
  const sessionKind = useRef<'stream' | 'local'>('stream')
  const chosenPlayer = useSetting('chosenPlayer').data ?? 'local'

  // The show is already in the media cache when playback started from a detail page; the
  // episode list is what `processNext` used to find the next episode.
  const show = useQuery({
    queryKey: ['player-show', params.get('imdbId') ?? ''],
    enabled: params.get('tvdbId') !== null && params.get('imdbId') !== null,
    queryFn: async () => {
      const bridge = popcorn()
      const raw = await bridge.invoke('media:getShow', { imdbId: params.get('imdbId') ?? '' })
      // The cache returns undefined for a show that was never browsed; the schema guards
      // against a malformed entry.
      if (raw === undefined || raw === null) return undefined
      return Schema.decodeUnknownSync(Show)(raw)
    },
  })

  /** `processNext` from player.js: the next episode of the season, at the current quality. */
  const nextEpisode = useMemo<NextEpisode | undefined>(() => {
    const found = show.data
    const season = params.get('season')
    const episode = params.get('episode')
    if (found === undefined || season === null || episode === null) return undefined
    // `processNext` crosses season boundaries; the rule lives in playback-rules.
    const next = nextEpisodeRule(found.episodes, { season, episode })
    if (next === undefined) return undefined
    const torrents = Object.entries(next.torrents)
    const best = torrents.find(([name]) => name === quality) ?? torrents[0]
    if (best === undefined) return undefined
    const number = `${String(next.season).padStart(2, '0')}E${String(next.episode).padStart(2, '0')}`
    return {
      source: best[1].url,
      quality: best[0],
      title: `${found.title} S${number}`,
      season: String(next.season),
      episode: String(next.episode),
      show: found.title,
    }
  }, [show.data, params, quality])

  const playNext = () => {
    if (nextEpisode === undefined) return
    const query = new URLSearchParams({
      source: nextEpisode.source,
      title: nextEpisode.title,
      quality: nextEpisode.quality,
      imdbId: params.get('imdbId') ?? '',
      tvdbId: params.get('tvdbId') ?? '',
      season: nextEpisode.season,
      episode: nextEpisode.episode,
      ...(subtitleLang === '' ? {} : { subtitleLang }),
      ...(backdrop === '' ? {} : { backdrop }),
    })
    // Replace the current episode so closing the next one returns to where playback started.
    navigate(`/player?${query.toString()}`, { replace: true })
  }

  useEffect(() => {
    const bridge = popcorn()
    if (source === '' && localPath === '') return
    // A local file always plays in the built-in player; torrents respect the chosen player.
    if (chosenPlayer !== 'local' && localPath === '') return
    let cancelled = false
    // A new source shows the connecting screen again instead of the previous player.
    setSrc(undefined)
    setFailure(undefined)
    const kind = localPath === '' ? 'stream' : 'local'
    sessionKind.current = kind
    const stop = (port: number) =>
      kind === 'local' ? bridge.invoke('local:stop', { port }) : Promise.resolve(undefined)
    const stopStream = (id: string) => bridge.invoke('stream:stop', { id })
    const start =
      kind === 'stream'
        ? bridge.invoke('stream:start', {
            torrentId: source,
            fileIndex,
            origin: window.location.origin,
            ...(imdbId === '' ? {} : { imdbId }),
            ...(subtitleLang === '' ? {} : { subtitleLang }),
            ...(params.get('season') === null ? {} : { season: params.get('season') ?? '' }),
            ...(params.get('episode') === null ? {} : { episode: params.get('episode') ?? '' }),
          })
        : bridge.invoke('local:serve', { path: localPath, origin: window.location.origin })
    void start
      .then(async (session) => {
        if (cancelled) {
          // React's StrictMode runs effects twice; the first session must not leak a server.
          if ('id' in session) void stopStream(session.id).catch(() => undefined)
          else void stop(session.port).catch(() => undefined)
          return
        }
        let tracks: ReadonlyArray<SubtitleTrack> = []
        if (kind === 'local' && 'name' in session) {
          setLocalTitle(session.name)
          if (session.subtitle !== undefined) {
            // A sidecar subtitle arrives with the video; `checkSubs` looked for it the same way.
            // A sidecar subtitle was shown by default: `playObj.defaultSubtitle = 'local'`.
            try {
              const track = await bridge.invoke('local:subtitle', {
                path: session.subtitle,
                origin: window.location.origin,
              })
              tracks = [{ src: track.url, language: 'en', label: session.name, default: true }]
            } catch {
              // Playing without the sidecar subtitle beats failing the whole stream.
            }
          }
        }
        if ('id' in session && session.subtitle !== undefined) {
          // The main process fetched the subtitle inside StreamSession's waitingForSubtitles step.
          const label = subtitleLang === '' ? 'Subtitle' : subtitleLang
          tracks = [
            ...tracks,
            {
              src: session.subtitle,
              language: subtitleLang.split('|')[0] || 'und',
              label,
              default: true,
            },
          ]
        }
        if (cancelled) {
          if ('id' in session) void stopStream(session.id).catch(() => undefined)
          else void stop(session.port).catch(() => undefined)
          return
        }
        setSubtitles(tracks)
        if ('id' in session) sessionId.current = session.id
        else sessionPort.current = session.port
        setSrc(session.url)
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(failureText(error))
      })
    return () => {
      cancelled = true
      const id = sessionId.current
      const port = sessionPort.current
      sessionId.current = undefined
      sessionPort.current = undefined
      if (id !== undefined) {
        void stopStream(id).catch(() => undefined)
      }
      if (port !== undefined) {
        void stop(port).catch(() => undefined)
      }
    }
  }, [source, localPath, fileIndex, chosenPlayer, subtitleLang, imdbId, params])

  // `handleVideoFile` titled a local file with its name; torrents use the passed title.
  const displayTitle = title === '' ? (localPath === '' ? source : localTitle || localPath) : title

  if (trailer !== null && trailer !== '') {
    // `play_control.js:playTrailer` handed the youtube url to the player directly.
    return (
      <Player
        src={trailer}
        type="video/youtube"
        title={title === '' ? trailer : title}
        onClose={() => navigate(-1)}
      />
    )
  }
  if (source === '' && localPath === '') {
    return (
      <section className="grid place-items-center gap-2">
        <p className="text-Text3">{'no torrent selected'}</p>
        <button
          type="button"
          className="rounded bg-BgColor2 px-3 py-1 text-xs"
          onClick={() => navigate(-1)}
        >
          Back
        </button>
      </section>
    )
  }
  if (chosenPlayer !== 'local' && localPath === '') {
    // A concrete target id (not `local`) plays through an external player; branch on kind.
    return (
      <ExternalPlayerPanel
        source={source}
        title={displayTitle}
        fileIndex={fileIndex}
        targetId={chosenPlayer}
      />
    )
  }
  if (failure !== undefined) {
    return (
      <section className="grid place-items-center gap-2 p-6 text-center">
        <p className="text-Text3">{t('Playback failed')}</p>
        <p className="max-w-2xl text-xs text-Text4">{failure}</p>
        <button
          type="button"
          className="rounded bg-BgColor2 px-3 py-1 text-xs"
          onClick={() => navigate(-1)}
        >
          {t('Back')}
        </button>
      </section>
    )
  }
  if (src === undefined) {
    // `loading.tpl`: the connecting screen is shown until the stream is ready.
    return (
      <LoadingScreen
        title={displayTitle}
        {...(backdrop === '' ? {} : { backdrop })}
        state="connecting"
        onCancel={() => navigate(-1)}
      />
    )
  }
  return (
    <Player
      src={src}
      // `streamer.js` declared every local stream as `video/mp4`; the type is what lets the
      // player accept the source, while the container is sniffed from the stream itself.
      type="video/mp4"
      title={displayTitle}
      quality={quality === '' ? undefined : quality}
      media={media}
      minimized={minimized}
      metadataCheck={params.get('metadataCheck') === '1'}
      {...(subtitles.length === 0 ? {} : { subtitles })}
      {...(nextEpisode === undefined ? {} : { nextEpisode })}
      onPlayNext={playNext}
      onMinimize={() => setMinimized((current) => !current)}
      onClose={() => navigate(-1)}
    />
  )
}
