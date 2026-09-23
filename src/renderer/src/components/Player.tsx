import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { IpcEventPayload } from '../../../shared/ipc'
import { fileSize } from '../format'
import { type PlayerKeyActions, usePlayerKeys } from '../hooks/usePlayerKeys'
import {
  applySubtitleStyles,
  installLegacyPlayer,
  loadCustomSubtitle,
  type SubtitleStyleSettings,
} from '../player/legacy-vjs4'
import videojs from '../player/videojs'
import { useSettings } from '../settings'

export interface SubtitleTrack {
  readonly src: string
  readonly language: string
  readonly label: string
  readonly default?: boolean
}

interface PlayerProps {
  readonly src: string
  readonly title: string
  readonly quality?: string | undefined
  readonly type?: string
  /** Ids of the playing title, so the legacy resume/watched bookkeeping can be saved. */
  readonly media?: PlayerMedia
  readonly subtitles?: ReadonlyArray<SubtitleTrack>
  readonly defaultSubtitle?: string
  /** `minDetails` from player.js: the player shrinks to 0x0 and the maximize bar shows. */
  readonly minimized?: boolean
  /** `metadataCheckRequired` from player.js: the verify-metadata overlay is shown. */
  readonly metadataCheck?: boolean
  /** The episode `playing_next` advances to; absent when there is no next episode. */
  readonly nextEpisode?: NextEpisode
  readonly onPlayNext?: () => void
  readonly onClose: () => void
  readonly onMinimize?: () => void
}

export interface PlayerMedia {
  readonly imdbId?: string
  readonly tvdbId?: string
  readonly season?: string
  readonly episode?: string
}

/** The episode `playing_next` advances to; built by the show detail from its episode list. */
export interface NextEpisode {
  readonly source: string
  readonly quality: string
  readonly title: string
  readonly season: string
  readonly episode: string
  readonly show?: string
}

type Translate = ReturnType<typeof useTranslation>['t']

/** `remainingTime()` from player.js, fed by webtorrent's millisecond estimate. */
function remainingTime(t: Translate, timeRemaining: number | undefined): string {
  if (timeRemaining === undefined || !Number.isFinite(timeRemaining) || timeRemaining <= 0) {
    return t('Unknown time remaining')
  }
  const seconds = Math.round(timeRemaining / 1000)
  if (seconds > 3600) return t('{{0}} hour(s) remaining', { 0: Math.round(seconds / 3600) })
  if (seconds > 60) return t('{{0}} minute(s) remaining', { 0: Math.round(seconds / 60) })
  return t('{{0}} second(s) remaining', { 0: seconds })
}

/** One shared timer: the legacy replaced the overlay message rather than stacking them. */
let overlayTimer = 0

/**
 * The legacy play/pause indicator: the icon scales up and fades out over the video.
 * `player.js` did this with jQuery's show/scale/fadeOut queue.
 */
function showOsd(id: 'osd_play' | 'osd_pause'): void {
  const icon = document.getElementById(id)
  if (icon === null) return
  icon.style.display = 'block'
  icon.style.opacity = '1'
  icon.style.transform = 'scale(1.8)'
  window.setTimeout(() => {
    icon.style.opacity = '0'
    icon.style.transform = 'scale(1)'
  }, 50)
}

/** video.js 4 with the legacy `player.tpl` markup, skin classes and subtitle handling. */
export function Player({
  src,
  title,
  quality,
  type,
  media,
  subtitles,
  defaultSubtitle,
  minimized = false,
  metadataCheck = false,
  nextEpisode,
  onPlayNext,
  onClose,
  onMinimize,
}: PlayerProps) {
  const playerElRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null)
  const [playerEl, setPlayerEl] = useState<HTMLElement | null>(null)
  const [progress, setProgress] = useState<IpcEventPayload<'streams:progress'> | undefined>(
    undefined,
  )
  const [playing, setPlaying] = useState(false)
  const [playingNext, setPlayingNext] = useState(false)
  const [countdown, setCountdown] = useState(60)
  const [nextDismissed, setNextDismissed] = useState(false)
  const [metadataVerified, setMetadataVerified] = useState(false)
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useSettings().data

  const subtitleSettings = useMemo<SubtitleStyleSettings>(
    () => ({
      size: settings?.subtitle_size ?? '38px',
      color: settings?.subtitle_color ?? '#ffffff',
      font: settings?.subtitle_font ?? 'Arial',
      decoration: settings?.subtitle_decoration ?? 'Outline',
      bold: settings?.subtitles_bold === true,
      position: settings?.playerSubPosition ?? '0px',
    }),
    [
      settings?.subtitle_size,
      settings?.subtitle_color,
      settings?.subtitle_font,
      settings?.subtitle_decoration,
      settings?.subtitles_bold,
      settings?.playerSubPosition,
    ],
  )

  const liveSettings = useRef({
    subtitle: subtitleSettings,
    volume: settings?.playerVolume,
    lastWatchedTitle: settings?.lastWatchedTitle ?? '',
    lastWatchedTime: settings?.lastWatchedTime ?? (false as const),
    autoPlay: settings?.playNextEpisodeAuto === true,
    media,
    title,
    nextEpisode,
    onPlayNext,
    onClose,
  })
  useEffect(() => {
    liveSettings.current = {
      subtitle: subtitleSettings,
      volume: settings?.playerVolume,
      lastWatchedTitle: settings?.lastWatchedTitle ?? '',
      lastWatchedTime: settings?.lastWatchedTime ?? (false as const),
      autoPlay: settings?.playNextEpisodeAuto === true,
      media,
      title,
      nextEpisode,
      onPlayNext,
      onClose,
    }
  }, [
    subtitleSettings,
    settings?.playerVolume,
    settings?.lastWatchedTitle,
    settings?.lastWatchedTime,
    settings?.playNextEpisodeAuto,
    media,
    title,
    nextEpisode,
    onPlayNext,
    onClose,
  ])

  const isTrailer = type === 'video/youtube'

  // video.js removes the element it was handed when the player is disposed, so React must
  // not own that element: each run creates a fresh <video> and appends it to .player, the
  // way the legacy template had it. Otherwise React's StrictMode remount (and any re-run
  // of this effect) left the player attached to a node that was no longer in the document.
  useEffect(() => {
    const container = playerElRef.current
    if (container === null) return
    installLegacyPlayer()

    const video = document.createElement('video')
    video.id = 'video_player'
    video.className = 'video-js vjs-popcorn-skin'
    video.setAttribute('width', '100%')
    video.setAttribute('height', '100%')
    video.controls = true
    video.preload = 'auto'
    video.autoplay = true
    container.append(video)

    // Trailers take the legacy youtube branch: the youtube tech instead of the plugins.
    const player = videojs(
      video,
      isTrailer
        ? {
            techOrder: ['youtube'],
            forceSSL: true,
            ytcontrols: false,
            quality: '1080p',
            controls: true,
            autoplay: true,
            sources: [{ src, type: 'video/youtube' }],
          }
        : {
            nativeControlsForTouch: false,
            trackTimeOffset: 0,
            plugins: {
              biggerSubtitle: {},
              smallerSubtitle: {},
              customSubtitles: {},
              progressTips: {},
            },
            controls: true,
            autoplay: true,
            preload: 'auto',
            sources: [{ src, ...(type === undefined ? {} : { type }) }],
          },
    )
    playerRef.current = player
    // video.js 4 builds its own tech element, so DOM `<track>` children are dropped; tracks
    // go through the player API and the `videojshooks.js` loader fetches the VTT text itself.
    for (const track of subtitles ?? []) {
      player.addTextTrack('subtitles', track.label, track.language, {
        src: track.src,
        dflt: track.default === true || track.language === defaultSubtitle,
      })
    }
    player.ready(() => {
      player.addClass('vjs-popcorn-skin')
      setPlayerEl(player.el() as HTMLElement)
      player.on('play', () => {
        setPlaying(true)
        showOsd('osd_play')
      })
      player.on('pause', () => {
        setPlaying(false)
        showOsd('osd_pause')
      })
      // The legacy restores the saved volume on ready; the volume hook writes it back.
      const savedVolume = Number(liveSettings.current.volume ?? '1')
      if (Number.isFinite(savedVolume)) player.volume(savedVolume)
      if (!isTrailer) {
        applySubtitleStyles(liveSettings.current.subtitle, player.isFullscreen() === true)
        player.on('fullscreenchange', () => {
          applySubtitleStyles(liveSettings.current.subtitle, player.isFullscreen() === true)
        })
        player.on('loadedmetadata', () => {
          applySubtitleStyles(liveSettings.current.subtitle, player.isFullscreen() === true)
        })
      }
      // `onPlayerReady` from player.js: the saved position is restored on loadeddata.
      player.on('loadeddata', () => {
        const live = liveSettings.current
        if (live.lastWatchedTitle === live.title && typeof live.lastWatchedTime === 'number') {
          if (live.lastWatchedTime > 0) player.currentTime(live.lastWatchedTime)
        }
      })
      player.on('error', () => {
        const error = player.error()
        console.error(
          '[player]',
          error?.code ?? '-',
          error?.message ?? 'unknown playback error',
          player.currentSrc(),
        )
      })
    })
    // `mouseScroll` from player.js: wheel up/down adjusts the volume (inverted on macOS).
    const macScroll = navigator.userAgent.includes('Mac') ? -1 : 1
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const direction = event.deltaY < 0 ? 1 : -1
      const delta = direction * macScroll * 0.1
      const currentVolume = player.volume() ?? 1
      player.volume(Math.min(1, Math.max(0, currentVolume + delta)))
    }
    player.el().addEventListener('wheel', onWheel, { passive: false })

    // `moveSubtitles` from player.js: Ctrl gives the text track pointer events, dragging it
    // moves it, and the resulting top is persisted as `playerSubPosition`.
    let dragStartY = 0
    let dragStartTop = 0
    let dragging: HTMLElement | null = null
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target === null || !target.classList.contains('vjs-text-track')) return
      if (target.style.pointerEvents !== 'auto') return
      dragging = target
      dragStartY = event.clientY
      dragStartTop = Number.parseFloat(getComputedStyle(target).top) || 0
      target.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (dragging === null) return
      dragging.style.top = `${dragStartTop + (event.clientY - dragStartY)}px`
    }
    const onPointerUp = (event: PointerEvent) => {
      if (dragging === null) return
      const target = dragging
      dragging = null
      target.releasePointerCapture(event.pointerId)
      if (target.style.top !== '') {
        void window.popcorn?.invoke('settings:set', {
          key: 'playerSubPosition',
          value: target.style.top,
        })
        void queryClient.invalidateQueries({ queryKey: ['settings'] })
      }
    }
    player.el().addEventListener('pointerdown', onPointerDown)
    player.el().addEventListener('pointermove', onPointerMove)
    player.el().addEventListener('pointerup', onPointerUp)

    // `checkAutoPlay` from player.js: while the last minute plays, offer the next episode.
    const nextTimer = window.setInterval(() => {
      const live = liveSettings.current
      if (live.nextEpisode === undefined || !live.autoPlay) {
        setPlayingNext(false)
        return
      }
      const duration = player.duration()
      const current = player.currentTime()
      if (!Number.isFinite(duration) || duration <= 0 || current <= 30) {
        setPlayingNext(false)
        return
      }
      const remaining = duration - current
      if (remaining < 60) {
        setPlayingNext(true)
        setCountdown(Math.max(0, Math.round(remaining)))
      } else {
        setPlayingNext(false)
      }
    }, 1000)

    // `onPlayerEnded`: auto-play the next episode, otherwise close like the legacy did.
    const onEnded = () => {
      const live = liveSettings.current
      if (live.nextEpisode !== undefined && live.autoPlay) live.onPlayNext?.()
      else live.onClose()
    }
    player.on('ended', onEnded)

    return () => {
      window.clearInterval(nextTimer)
      // `closePlayer` from player.js: remember the position, and mark the title watched
      // when playback passed 80%. StrictMode's first cleanup sees duration 0 and skips.
      const duration = player.duration()
      const current = player.currentTime()
      if (!isTrailer && Number.isFinite(duration) && duration > 0 && Number.isFinite(current)) {
        const live = liveSettings.current
        const writeSetting = (key: string, value: unknown) => {
          void window.popcorn?.invoke('settings:set', { key, value } as never)
        }
        if (current / duration >= 0.8) {
          writeSetting('lastWatchedTime', false)
          if (live.media?.imdbId !== undefined) {
            if (live.media.tvdbId === undefined) {
              void window.popcorn?.invoke('watched:markMovie', { imdbId: live.media.imdbId })
            } else {
              void window.popcorn?.invoke('watched:markEpisode', {
                tvdbId: live.media.tvdbId,
                imdbId: live.media.imdbId,
                season: live.media.season ?? '',
                episode: live.media.episode ?? '',
              })
            }
            void queryClient.invalidateQueries({ queryKey: ['library'] })
            void queryClient.invalidateQueries({ queryKey: ['watched'] })
            void queryClient.invalidateQueries({ queryKey: ['watched-episodes'] })
          }
        } else if (current > 0) {
          writeSetting('lastWatchedTitle', live.title)
          writeSetting('lastWatchedTime', Math.max(0, current - 5))
        }
        // The settings query is cached with `staleTime: Infinity`; without this the next
        // player mount would read the pre-close snapshot and never resume.
        void queryClient.invalidateQueries({ queryKey: ['settings'] })
      }
      playerRef.current = null
      setPlayerEl(null)
      player.dispose()
    }
  }, [src, type, isTrailer, subtitles, defaultSubtitle, queryClient])

  // `videojs:drop_sub` from app.js: a subtitle dropped onto the window joins the live player
  // rather than restarting it.
  useEffect(() => {
    const onDroppedSubtitle = (event: Event) => {
      const player = playerRef.current
      const detail = (event as CustomEvent<{ url?: string }>).detail
      if (player === null || detail?.url === undefined) return
      loadCustomSubtitle(player, detail.url)
    }
    window.addEventListener('popcorn:subtitle', onDroppedSubtitle)
    return () => window.removeEventListener('popcorn:subtitle', onDroppedSubtitle)
  }, [])

  useEffect(() => {
    const player = playerRef.current
    if (player === null) return
    applySubtitleStyles(subtitleSettings, player.isFullscreen() === true)
  }, [subtitleSettings])

  useEffect(() => {
    const bridge = window.popcorn
    if (bridge === undefined) return
    return bridge.onProgress(setProgress)
  }, [])

  const zoomRef = useRef(1)
  const filtersRef = useRef({ brightness: 1, contrast: 1, hue: 0, saturation: 1 })
  const subtitleOffsetRef = useRef(0)

  /** `displayOverlayMsg` from player.js: the message fades out after 1.2s. */
  const overlay = useCallback((message: string) => {
    const player = playerRef.current
    if (player === null) return
    let element = player.el().querySelector<HTMLElement>('.vjs-overlay')
    if (element === null) {
      element = document.createElement('div')
      element.className = 'vjs-overlay vjs-overlay-top-left'
      player.el().append(element)
    }
    element.textContent = message
    element.style.opacity = '1'
    window.clearTimeout(overlayTimer)
    overlayTimer = window.setTimeout(() => element?.remove(), 1200)
  }, [])

  /** `applyFilters` from player.js, including its brightness compensation. */
  const applyFilters = useCallback(() => {
    const video = document.querySelector<HTMLElement>('.vjs-tech')
    if (video === null) return
    const { brightness, contrast, hue, saturation } = filtersRef.current
    const hueAdjustment = hue === 0 ? '' : `hue-rotate(${hue}deg)`
    const deltaB = brightness - 1.0
    video.style.filter = `brightness(${brightness}) contrast(${contrast - deltaB * 0.333}) ${hueAdjustment} saturate(${saturation - deltaB * 0.5})`
  }, [])

  const actions = useMemo<PlayerKeyActions>(
    () => ({
      close: () => {
        const player = playerRef.current
        if (player?.isFullscreen() === true) player.exitFullscreen()
        else onClose()
      },
      togglePlay: () => {
        const player = playerRef.current
        if (player === null) return
        if (player.paused()) player.play()
        else player.pause()
      },
      seekBy: (seconds: number) => {
        const player = playerRef.current
        if (player === null) return
        player.currentTime(Math.max(0, (player.currentTime() ?? 0) + seconds))
        player.trigger?.('mousemove')
      },
      volumeBy: (delta: number) => {
        const player = playerRef.current
        if (player === null) return
        player.volume(Math.min(1, Math.max(0, (player.volume() ?? 1) + delta)))
      },
      toggleFullscreen: () => playerRef.current?.requestFullscreen(),
      toggleMute: () => {
        const player = playerRef.current
        if (player === null) return
        player.muted(!player.muted())
      },
      /** `toggleCrop` from player.js: crop to fill the screen, or back to the original. */
      toggleCrop: () => {
        const video = document.querySelector<HTMLVideoElement>('.vjs-tech')
        const wrapper = document.getElementById('video_player')
        if (video === null || video.videoWidth === 0 || wrapper === null) return
        const multiplier =
          (video.videoWidth / video.videoHeight / (screen.width / screen.height)) * 100
        if (video.clientWidth > wrapper.clientWidth || video.clientHeight > wrapper.clientHeight) {
          video.removeAttribute('style')
          applyFilters()
          overlay(t('Original'))
        } else if (multiplier > 100) {
          video.style.width = `${multiplier}%`
          video.style.left = `${50 - multiplier / 2}%`
          video.style.border = 'none'
          overlay(t('Fit screen'))
        } else if (multiplier < 100) {
          video.style.height = `${10000 / multiplier}%`
          video.style.top = `${50 - 5000 / multiplier}%`
          video.style.border = 'none'
          overlay(t('Fit screen'))
        } else {
          overlay(t('Video already fits screen'))
        }
      },
      toggleSubtitles: () => {
        const player = playerRef.current
        if (player === null) return
        const active = player.textTracks().find((track) => track.mode() > 0)
        if (active === undefined) return
        const showing = active.mode() === 2
        if (showing) active.disable()
        else active.show()
        overlay(`${t('Subtitles')}: ${showing ? t('Disabled') : active.label()}`)
      },
      /** `adjustZoom` from player.js. */
      zoomBy: (delta: number) => {
        const video = document.querySelector<HTMLElement>('.vjs-tech')
        zoomRef.current = Math.max(0, zoomRef.current + delta)
        if (video !== null) {
          video.style.transform = zoomRef.current === 1 ? '' : `scale(${zoomRef.current})`
        }
        overlay(`${t('Zoom')}: ${(zoomRef.current * 100).toFixed(0)}%`)
      },
      /** `adjustBrightness` / `adjustContrast` / `adjustHue` / `adjustSaturation`. */
      filter: (kind, delta) => {
        const filters = filtersRef.current
        if (kind === 'hue') {
          filters.hue += delta
          if (filters.hue < -180) filters.hue += 360
          else if (filters.hue > 180) filters.hue -= 360
        } else {
          filters[kind] = Math.max(0, filters[kind] + delta)
        }
        applyFilters()
        const labels = {
          contrast: t('Contrast'),
          brightness: t('Brightness'),
          hue: t('Hue'),
          saturation: t('Saturation'),
        }
        const value =
          kind === 'hue' ? filters.hue.toFixed(0) : `${(filters[kind] * 100).toFixed(0)}%`
        overlay(`${labels[kind]}: ${value}`)
      },
      /** `adjustPlaybackRate` from player.js. */
      playbackRate: (rate, delta) => {
        const player = playerRef.current
        if (player === null) return
        const next = delta ? (player.playbackRate() ?? 1) + rate : rate
        if (next > 0.49 && next < 4.01) {
          player.playbackRate(next)
          if (player.playbackRate() !== next) {
            overlay(t('Playback rate adjustment is not available for this video!'))
          } else {
            overlay(`${t('Playback rate')}: ${Number(next.toFixed(1))}x`)
          }
        }
      },
      /** `adjustSubtitleOffset`: the legacy kept a `trackTimeOffset`, applied to the cues. */
      subtitleOffsetBy: (seconds) => {
        const player = playerRef.current
        if (player === null) return
        subtitleOffsetRef.current += seconds
        for (const track of player.textTracks()) {
          for (const cue of track.cues()) {
            cue.startTime += seconds
            cue.endTime += seconds
          }
        }
        overlay(`${t('Subtitles Offset')}: ${(-subtitleOffsetRef.current).toFixed(1)} ${t('secs')}`)
      },
      /** `scaleWindow` from player.js: resize the window to the video size times a factor. */
      scaleWindow: (scale) => {
        const video = document.querySelector<HTMLVideoElement>('.vjs-tech')
        if (video === null || video.videoWidth === 0) return
        void window.popcorn?.invoke('window:setSize', {
          width: Math.round(video.videoWidth * scale),
          height: Math.round(video.videoHeight * scale),
        })
      },
      /** Ctrl makes the subtitle element draggable, as the legacy Mousetrap bind did. */
      subtitleDrag: (enabled) => {
        const track = document.querySelector<HTMLElement>('.vjs-text-track')
        if (track !== null) track.style.pointerEvents = enabled ? 'auto' : 'none'
      },
    }),
    [t, overlay, applyFilters, onClose],
  )

  usePlayerKeys(actions)

  const displayTitle = isTrailer ? `${title} - Trailer` : title
  const percent = Math.round((progress?.progress ?? 0) * 100)
  const length = progress?.length ?? 0
  // `updateDownloaded` from player.js: complete once the rounded percent hits 100.
  const complete = percent >= 100 && length > 0
  const downloadedText = complete
    ? `${percent}%\u00a0\u00a0\u00a0(${fileSize(length)})`
    : length === 0
      ? `(${fileSize(progress?.downloaded ?? 0)} / ${t('Unknown')})`
      : `${percent}%\u00a0\u00a0\u00a0(${fileSize(progress?.downloaded ?? 0)} / ${fileSize(length)})`

  // The legacy drove the video.js load bar from the torrent's downloaded percent.
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('.vjs-load-progress')
    if (bar !== null) bar.style.width = `${percent}%`
  }, [percent])

  return (
    <div
      className="player"
      ref={playerElRef}
      style={minimized ? { height: 0, width: 0 } : undefined}
    >
      {playerEl === null
        ? null
        : createPortal(
            <div className="player-header-background vjs-control-bar">
              <i className="state-info-player fas fa-play" id="osd_play" aria-hidden />
              <i className="state-info-player fas fa-pause" id="osd_pause" aria-hidden />
              <div className="player-title">{displayTitle}</div>
              <div className="details-player">
                {quality === undefined ? null : (
                  <span className="quality-info-player">{quality}</span>
                )}
                <span className="fas fa-angle-down minimize-icon" onClick={onMinimize} />
                <span className="fas fa-times close-info-player" onClick={onClose} />
                {isTrailer ? null : (
                  <div className="download-info-player">
                    <i className="fas fa-eye eye-info-player" />
                    <div className="details-info-player">
                      <div className="arrow-up" />
                      <div id="sstatel-container">
                        <br />
                        <span className="speed-info-player" id="sstatel">
                          {complete ? t('Downloaded') : t('Downloading')}
                        </span>
                      </div>
                      <br />
                      <div id="dwnloading">
                        <span className="downloaded_player value">{downloadedText}</span>
                        {complete ? null : (
                          <>
                            <br />
                            <span className="remaining">
                              {remainingTime(t, progress?.timeRemaining)}
                            </span>
                          </>
                        )}
                      </div>
                      <br />
                      {complete ? null : (
                        <>
                          <span className="speed-info-player" id="dloaddd">
                            {t('Download')}:&nbsp;
                          </span>
                          <span className="download_speed_player value">
                            {fileSize(progress?.speed ?? 0)}/s
                          </span>
                          <br />
                          <span className="speed-info-player">{t('Upload')}:&nbsp;</span>
                          <span className="upload_speed_player value">
                            {fileSize(progress?.uploadSpeed ?? 0)}/s
                          </span>
                          <br />
                          <span className="speed-info-player" id="apeersss">
                            {t('Active Peers')}:&nbsp;
                          </span>
                          <span className="active_peers_player value">{progress?.peers ?? 0}</span>
                          <br />
                        </>
                      )}
                      <span className="speed-info-player">{t('Filename')}:&nbsp;</span>
                      <span className="filename_player value" />
                      <br />
                      <span className="speed-info-player">{t('Stream Url')}:&nbsp;</span>
                      <br />
                      <br />
                    </div>
                  </div>
                )}
              </div>
            </div>,
            playerEl,
          )}

      <div
        className={complete ? 'maximize-icon done' : 'maximize-icon'}
        style={minimized ? { display: 'block' } : undefined}
      >
        <span className="downloadedPercent_player">{percent}%</span>
        <span className={playing ? 'fas fa-pause' : 'fas fa-play'} id="max_play_ctrl" />
        <span className="title copytoclip" data-copy="title">
          {displayTitle}
        </span>
        {complete || isTrailer ? null : (
          <>
            <span id="maxdllb">@ </span>
            <span className="download_speed_player" id="maxdl">
              {fileSize(progress?.speed ?? 0)}/s
            </span>
          </>
        )}
        <span
          className="fa fa-angle-up tooltipped"
          id="maxic"
          data-toggle="tooltip"
          data-placement="top"
          title={t('Restore')}
          onClick={onMinimize}
        />
      </div>

      <div className="trailer_mouse_catch" />

      <div
        className="verify-metadata vjs-control-window"
        style={metadataCheck && !metadataVerified ? { display: 'block' } : undefined}
      >
        <div className="vm_poster">
          <img className="verifmeta_poster" src="images/posterholder.png" alt="" />
        </div>
        <div className="vm_epinfo">
          <p className="verifmeta_show" />
          <p className="verifmeta_episode" />
          <p className="verifmeta_number" />
        </div>
        <div className="vm_box">
          <p className="verifmeta_boxtext">{t('Currently watching')}</p>
        </div>
        <div className="vm_btns">
          <div className="vm-btn verifmetaFALSE" onClick={() => setMetadataVerified(true)}>
            {t("No, it's not that")}
          </div>
          <div className="vm-btn verifmetaTRUE" onClick={() => setMetadataVerified(true)}>
            {t('Correct')}
          </div>
        </div>
      </div>

      <div
        className="playing_next vjs-control-window"
        style={playingNext && !nextDismissed ? { display: 'block' } : undefined}
      >
        <div className="pn_poster">
          <img className="playing_next_poster" src="images/posterholder.png" alt="" />
        </div>
        <div className="pn_epinfo">
          <p className="playing_next_show">{nextEpisode?.show ?? ''}</p>
          <p className="playing_next_episode">{nextEpisode?.title ?? ''}</p>
          <p className="playing_next_number">
            {nextEpisode === undefined
              ? ''
              : `${t('Season {{0}}', { 0: nextEpisode.season })}, ${t('Episode {{0}}', { 0: nextEpisode.episode })}`}
          </p>
        </div>
        <div className="pn_counter">
          <p className="playing_next_countertext">{t('Playing Next')}</p>
          <p id="nextCountdown">{countdown}</p>
        </div>
        <div className="pn_btns">
          <div className="auto-next-btn playnownextNOT" onClick={() => setNextDismissed(true)}>
            {t('No thank you')}
          </div>
          <div className="auto-next-btn playnownext" onClick={() => onPlayNext?.()}>
            {t('Play Now')}
          </div>
        </div>
      </div>
    </div>
  )
}
