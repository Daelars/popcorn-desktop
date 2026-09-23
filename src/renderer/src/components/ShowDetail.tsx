import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { Episode, Show, Torrent } from '../../../shared'
import { failureText } from '../failure'
import { useToggleWatchedEpisode, useWatchedEpisodes } from '../library'
import { notify } from '../notify'
import { providerIcon } from '../provider-icons'
import { useSetting } from '../settings'
import { LangDropdown } from './LangDropdown'
import { PlayerChooser } from './PlayerChooser'
import { RatingStars } from './Poster'
import { QualitySelector } from './QualitySelector'

function imageOf(show: Show): string | undefined {
  if (typeof show.poster === 'string' && show.poster.length > 0) return show.poster
  return show.images?.poster
}

function backdropOf(show: Show): string | undefined {
  if (typeof show.backdrop === 'string' && show.backdrop.length > 0) return show.backdrop
  return show.images?.fanart ?? show.images?.banner
}

/** Show detail in the legacy markup: header, seasons, episodes, overview. */
export function ShowDetail({ show }: { show: Show }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const seasons = [...new Set(show.episodes.map((episode) => String(episode.season)))]
  const [season, setSeason] = useState(seasons[0] ?? '1')
  const [selected, setSelected] = useState<Episode>()
  const [chosen, setChosen] = useState<[string, Torrent]>()
  const [subtitleLang, setSubtitleLang] = useState('none')
  // `play_control.js` asked the subtitle provider for the title's languages on mount.
  const subtitleList = useQuery({
    queryKey: ['subtitles', show.imdb_id],
    queryFn: async () => {
      const bridge = window.popcorn
      if (bridge === undefined) return {}
      const { subtitles } = await bridge.invoke('subtitles:list', { imdbId: show.imdb_id })
      return subtitles
    },
    retry: false,
  })
  const subtitleLangs = Object.keys(subtitleList.data ?? {})
  const watched = useWatchedEpisodes(show.tvdb_id)
  const toggleEpisode = useToggleWatchedEpisode()
  const defaultQuality = useSetting('shows_default_quality').data ?? '1080p'
  const activateSeedbox = useSetting('activateSeedbox').data ?? false
  const showSeedboxOnDlInit = useSetting('showSeedboxOnDlInit').data ?? true

  const episodeLabel = (episode: Episode) =>
    `${show.title} S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`

  /** Episodes play through the file selector, the same route movies use. */
  const play = (episode: Episode, quality?: [string, Torrent]) => {
    const torrent = quality ?? chosen
    if (torrent === undefined) return
    const query = new URLSearchParams({
      source: torrent[1].url,
      title: episodeLabel(episode),
      quality: torrent[0],
      imdbId: show.imdb_id,
      tvdbId: String(show.tvdb_id),
      season: String(episode.season),
      episode: String(episode.episode),
      ...(subtitleLang === 'none' ? {} : { subtitleLang }),
      ...(backdrop === undefined ? {} : { backdrop }),
    })
    navigate(`/select?${query.toString()}`)
  }

  /** `dblclickEpisode` in `show_detail.js`: double click starts the best quality at once. */
  const playDefault = (episode: Episode) => {
    const torrents = Object.entries(episode.torrents)
    const best = torrents.find(([quality]) => quality === defaultQuality) ?? torrents[0]
    if (best !== undefined) play(episode, best)
  }

  /** `show_detail.js:downloadTorrent`: start the stream and surface it in the seedbox. */
  const download = () => {
    if (chosen === undefined) return
    void window.popcorn
      ?.invoke('stream:start', {
        torrentId: chosen[1].url,
        fileIndex: 0,
        origin: window.location.origin,
      })
      .then(() => {
        if (showSeedboxOnDlInit) navigate('/seedbox')
        else notify(t('Download added'))
      })
      .catch((error: unknown) => notify(failureText(error)))
  }

  /** `show-detail.tpl` toggles the episode's watched state from the eye in the row. */
  const toggleWatched = (episode: Episode, isWatched: boolean) =>
    toggleEpisode.mutate({
      tvdbId: String(show.tvdb_id),
      imdbId: show.imdb_id,
      season: String(episode.season),
      episode: String(episode.episode),
      watched: isWatched,
    })

  const episodes = show.episodes.filter((episode) => String(episode.season) === season)

  // `show_detail.js:selectSeason` selects the first episode on load and again whenever the
  // season changes, so the overview panel is never empty.
  useEffect(() => {
    if (selected !== undefined && String(selected.season) === season) return
    const first = episodes[0]
    if (first === undefined) return
    setSelected(first)
    setChosen(undefined)
  }, [episodes, season, selected])
  const poster = imageOf(show)
  const backdrop = backdropOf(show)
  // `show-detail.tpl`: 'medium' keeps the stylesheet default, an empty value means opaque,
  // and the other steps mix the theme colour with more or less transparency.
  const transparency = useSetting('seriesUITransparency').data ?? 'medium'
  const sectionTransparency =
    transparency === ''
      ? ' transpOff'
      : ({ vlow: ' transpVLow', low: ' transpLow', high: ' transpHigh', vhigh: ' transpVHigh' }[
          transparency
        ] ?? '')
  const rowTransparency = transparency === '' ? ' transpOff' : ''

  return (
    <div className="show-detail-container">
      <section className="show-header">
        <div className="sh-backdrop">
          <div
            className={backdrop === undefined ? 'shb-img' : 'shb-img fadein'}
            style={backdrop === undefined ? undefined : { backgroundImage: `url(${backdrop})` }}
          />
        </div>
        <div className="sh-poster">
          <div
            className={poster === undefined ? 'shp-img' : 'shp-img fadein'}
            style={poster === undefined ? undefined : { backgroundImage: `url(${poster})` }}
          />
        </div>
        <div className="sh-metadata">
          <div className="shm-title">{show.title}</div>
          <div className="shm-infos">
            <div className="shmi-year">{show.year}</div>
            <span className="dot" />
            <div className="shmi-runtime">
              {show.runtime === undefined ? 'N/A' : `${show.runtime} min`}
            </div>
            <span className="dot" />
            <div className="shmi-status">{show.status ?? t('N/A')}</div>
            <span className="dot" />
            <div className="shmi-genre">{(show.genres[0] ?? t('N/A')).toLowerCase()}</div>
            <span className="dot" />
            <div className="shmi-rating">
              <RatingStars rating={Math.round(show.rating.percentage) / 10} />
              <div className="number-container-tv hidden">
                {Math.round(show.rating.percentage) / 10}
                <em>/10</em>
              </div>
            </div>
          </div>
          <div className="shm-synopsis">{show.synopsis}</div>
        </div>
        <div className="sh-actions">
          <div className="flex-left">
            <div className="sha-bookmark">{t('Add to bookmarks')}</div>
            <div className="sha-watched">{t('Mark as Seen')}</div>
          </div>
          <div className="flex-right dropdowns-container">
            {/* `play-control.tpl` keeps `.connect-opensubtitles` until the provider's
                languages arrive, then the language dropdown takes its place. */}
            <div id="subs-dropdown">
              {subtitleLangs.length === 0 ? (
                <button
                  type="button"
                  className="connect-opensubtitles"
                  onClick={() => navigate('/settings')}
                >
                  {t('Subtitle')}
                </button>
              ) : (
                <LangDropdown
                  title={t('Subtitle')}
                  values={subtitleLangs}
                  selected={subtitleLang}
                  hasNull
                  onChange={setSubtitleLang}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      <section className={`show-details${sectionTransparency}`}>
        <div className="sd-seasons">
          <div className="sds-title">{t('Seasons')}</div>
          <div className="sds-list">
            <ul>
              {seasons.map((value) => (
                <li
                  key={value}
                  className={`tab-season${rowTransparency}${season === value ? ' active' : ''}`}
                >
                  {/* `show-detail.tpl` uses an anchor: the stylesheet's row rules target `ul a`. */}
                  <a
                    href="#"
                    onClick={(event) => {
                      event.preventDefault()
                      setSeason(value)
                    }}
                  >
                    {t('Season')} {value}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="sd-episodes">
          <div className="sde-title">{t('Episodes')}</div>
          <div className="sde-list">
            <div className={`tab-episodes season-${season}`}>
              <ul>
                {episodes.map((episode) => {
                  const key = `${String(episode.season)}:${String(episode.episode)}`
                  const isWatched = watched.data?.has(key) ?? false
                  return (
                    <li
                      key={key}
                      className={`tab-episode${rowTransparency}${
                        selected !== undefined &&
                        String(selected.season) === String(episode.season) &&
                        String(selected.episode) === String(episode.episode)
                          ? ' active'
                          : ''
                      }`}
                    >
                      <a
                        href="#"
                        className="episodeData"
                        onClick={(event) => {
                          event.preventDefault()
                          setSelected(episode)
                          setChosen(undefined)
                        }}
                        onDoubleClick={() => playDefault(episode)}
                      >
                        <span>{String(episode.episode)}</span>
                        <div>{episode.title ?? t('Untitled')}</div>
                      </a>
                      {/* `show-detail.tpl` marks the watched state with `.watched.true`. */}
                      <i
                        className={`fa fa-eye watched${isWatched ? ' true' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-label={isWatched ? t('Watched') : t('Mark watched')}
                        aria-pressed={isWatched}
                        onClick={() => toggleWatched(episode, isWatched)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          toggleWatched(episode, isWatched)
                        }}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>

        {/* `show-detail.tpl` keeps the overview column in the grid, empty until an episode
          is picked; the stylesheet lays the whole section out as a three-column grid. */}
        <div className={`sd-overview${rowTransparency}`}>
          <div className="sdo-infos">
            <div className="sdoi-title">{selected?.title ?? ''}</div>
            <div className="sdoi-links">
              <div className="fa fa-magnet magnet-icon" />
              <div className="fa fa-circle health-icon None" />
            </div>
            <div className="sdoi-aired">
              <div className="sdoi-number">
                {selected === undefined
                  ? ''
                  : `${t('Season')} ${selected.season}, ${t('Episode')} ${selected.episode}`}
              </div>
              <div className="sdoi-date">
                {selected?.first_aired === undefined
                  ? ''
                  : new Date(selected.first_aired * 1000).toLocaleDateString()}
              </div>
            </div>
            <div className="sdoi-synopsis">{selected?.overview ?? ''}</div>
          </div>
          <div id="torrent-list">
            <table>
              {Object.entries(selected?.torrents ?? {}).map(([quality, torrent]) => (
                <tr key={quality} className="item-row" data-key={quality}>
                  <td className="provider" title={torrent.provider.toLowerCase()}>
                    {providerIcon(torrent.provider) === undefined ? null : (
                      <img src={providerIcon(torrent.provider)} alt="" />
                    )}
                  </td>
                  <td className="ellipsis item-play">
                    <button
                      type="button"
                      className="item-play"
                      onClick={() => setChosen([quality, torrent])}
                    >
                      {torrent.title ?? (selected === undefined ? '' : episodeLabel(selected))}
                    </button>
                  </td>
                  <td className="info item-play" title={`${t('Seeds')} / ${t('Peers')}`}>
                    {torrent.seed ?? torrent.seeds ?? 0} / {torrent.peer ?? torrent.peers ?? 0}
                  </td>
                  <td className="info item-play">{quality}</td>
                  <td className="info item-play">{torrent.filesize ?? ''}</td>
                  <td className="action item-download" title={t('Download')}>
                    <button
                      type="button"
                      className="fa fa-download item-download"
                      aria-label={t('Download')}
                      onClick={() =>
                        void window.popcorn?.invoke('collection:add', {
                          name:
                            torrent.title ?? (selected === undefined ? '' : episodeLabel(selected)),
                          source: torrent.url,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </table>
          </div>
          <div className="sdo-watch">
            <div id="quality-selector">
              <QualitySelector
                torrents={selected?.torrents ?? {}}
                defaultQualityKey="shows_default_quality"
                onSelect={(quality, torrent) => setChosen([quality, torrent])}
              />
            </div>
            <div className="sdow-watchnow">
              <div id="player-chooser">
                <PlayerChooser
                  onWatch={() => {
                    if (selected !== undefined) play(selected)
                  }}
                />
              </div>
            </div>
            {activateSeedbox ? (
              <div id="download-torrent" className="button play-selector" onClick={download}>
                <i className="fa fa-download" />
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
