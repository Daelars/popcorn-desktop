import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import placeholder from '../../../../resources/images/posterholder.png'
import type { Movie, Torrent } from '../../../shared'
import { popcorn } from '../bridge'
import { failureText } from '../failure'
import { useLibraryState, useToggleBookmark, useToggleWatchedMovie } from '../library'
import { notify } from '../notify'
import { providerIcon } from '../provider-icons'
import { useSetting } from '../settings'
import { LangDropdown } from './LangDropdown'
import { PlayerChooser } from './PlayerChooser'
import { RatingStars } from './Poster'
import { QualitySelector } from './QualitySelector'

function imageOf(movie: Movie): string {
  if (typeof movie.poster === 'string' && movie.poster.length > 0) return movie.poster
  if (typeof movie.image === 'string' && movie.image.length > 0) return movie.image
  return placeholder
}

function backdropOf(movie: Movie): string | undefined {
  return typeof movie.backdrop === 'string' && movie.backdrop.length > 0
    ? movie.backdrop
    : undefined
}

/** Movie detail, element for element from the legacy `movie-detail.tpl` and its views. */
export function MovieDetail({ movie }: { movie: Movie }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const library = useLibraryState()
  const toggleWatched = useToggleWatchedMovie()
  const toggleBookmark = useToggleBookmark()
  const transparency = useSetting('moviesUITransparency').data ?? '0.65'
  const activateSeedbox = useSetting('activateSeedbox').data ?? false
  const showSeedboxOnDlInit = useSetting('showSeedboxOnDlInit').data ?? true
  const torrents = Object.entries(movie.torrents)
  const [selected, setSelected] = useState<[string, Torrent]>()
  const [audioLang, setAudioLang] = useState(movie.defaultAudio)
  const [subtitleLang, setSubtitleLang] = useState('none')
  // `play_control.js` asked the subtitle provider for the title's languages on mount.
  const subtitleList = useQuery({
    queryKey: ['subtitles', movie.imdb_id],
    queryFn: async () => {
      const bridge = popcorn()
      const { subtitles } = await bridge.invoke('subtitles:list', { imdbId: movie.imdb_id })
      return subtitles
    },
    retry: false,
  })
  const subtitleLangs = Object.keys(subtitleList.data ?? {})
  const state = library.data?.get(movie.imdb_id) ?? { bookmarked: false, watched: false }
  const backdrop = backdropOf(movie)
  const audioLangs = Object.keys(movie.langs)

  const play = () => {
    if (selected === undefined) {
      console.error('[detail] no torrents for', movie.imdb_id, movie.torrents)
      return
    }
    const query = new URLSearchParams({
      source: selected[1].url,
      title: movie.title,
      quality: selected[0],
      imdbId: movie.imdb_id,
      ...(subtitleLang === 'none' ? {} : { subtitleLang }),
      ...(backdrop === undefined ? {} : { backdrop }),
    })
    navigate(`/select?${query.toString()}`)
  }

  const playTrailer = (trailer: string) => {
    const query = new URLSearchParams({ trailer, title: movie.title })
    navigate(`/player?${query.toString()}`)
  }

  /** `play_control.js:downloadTorrent`: start the stream and surface it in the seedbox. */
  const download = () => {
    if (selected === undefined) return
    void popcorn()
      .invoke('stream:start', {
        torrentId: selected[1].url,
        fileIndex: 0,
        origin: window.location.origin,
      })
      .then(() => {
        if (showSeedboxOnDlInit) navigate('/seedbox')
        else notify(t('Download added'))
      })
      .catch((error: unknown) => notify(failureText(error)))
  }

  return (
    <div className="movie-detail">
      <div
        className={backdrop === undefined ? 'backdrop' : 'backdrop fadein'}
        style={backdrop === undefined ? undefined : { backgroundImage: `url(${backdrop})` }}
      />
      <div
        className="backdrop-overlay"
        style={transparency === '0.65' ? undefined : { opacity: transparency }}
      />
      <div className="spinner">
        <div className="loading-container">
          <div className="ball" />
          <div className="ball1" />
        </div>
      </div>
      <button
        type="button"
        className="fa fa-times close-icon"
        aria-label={t('Close')}
        onClick={() => navigate(-1)}
      />

      <section className="poster-box">
        <img src={imageOf(movie)} className="mcover-image fadein" alt="" />
      </section>

      <section className="content-box">
        <div className="meta-container">
          <div className="title">{movie.title}</div>
          <div className="metadatas">
            <div className="metaitem" />
            <div className="year" title={t('Show Release Info')}>
              {movie.year}
            </div>
            <div className="metaitem">{movie.runtime ?? 'N/A'} min</div>
            <div className="metaitem">
              {movie.genre.map((name) => name.toLowerCase()).join(' / ')}
            </div>
            {movie.certification === undefined ||
            movie.certification === '' ||
            movie.certification === 'NR' ? null : (
              <>
                <div className="metaitem" />
                <div className="certification" title={t('Parental Guide')}>
                  {movie.certification}
                </div>
              </>
            )}
            <div className="metaitem" />
            <div className="fa fa-users show-cast" title={t('Show cast')} />
            <div className="metaitem" />
            <a
              className="movie-imdb-link"
              href={`https://www.imdb.com/title/${movie.imdb_id}`}
              target="_blank"
              rel="noreferrer"
              title={t('Open IMDb page')}
            >
              <span className="sr-only">{t('Open IMDb page')}</span>
            </a>
            <div className="metaitem rating-container">
              <div className="star-container" title={`${movie.rating}/10`}>
                <RatingStars rating={movie.rating} />
              </div>
              <div className="number-container hidden">
                {movie.rating} <em>/10</em>
              </div>
            </div>
            <div className="status-indicators">
              <div className="fa fa-circle health-icon" title={t('Health false')} />
              <div className="fa fa-magnet magnet-link" title={t('Magnet link')} />
              <div className="source-link" />
            </div>
          </div>
          <div className="overview">{movie.synopsis}</div>

          <div id="torrent-list">
            <table>
              {torrents.map(([name, torrent]) => (
                <tr key={name} className="item-row" data-key={name}>
                  <td className="provider" title={torrent.provider.toLowerCase()}>
                    {providerIcon(torrent.provider) === undefined ? null : (
                      <img src={providerIcon(torrent.provider)} alt="" />
                    )}
                  </td>
                  <td className="ellipsis item-play">
                    <button
                      type="button"
                      className="item-play"
                      onClick={() => setSelected([name, torrent])}
                    >
                      {torrent.title ?? movie.title}
                    </button>
                  </td>
                  <td className="info item-play" title={`${t('Seeds')} / ${t('Peers')}`}>
                    {torrent.seed ?? torrent.seeds ?? 0} / {torrent.peer ?? torrent.peers ?? 0}
                  </td>
                  <td className="info item-play">{name}</td>
                  <td className="info item-play">{torrent.filesize ?? ''}</td>
                  <td className="action item-download" title={t('Download')}>
                    <button
                      type="button"
                      className="fa fa-download item-download"
                      aria-label={t('Download')}
                      onClick={() =>
                        void popcorn().invoke('collection:add', {
                          name: torrent.title ?? movie.title,
                          source: torrent.url,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </table>
          </div>
        </div>

        <div id="play-control">
          <div className="play-control">
            <div className="flex-left">
              <div className="row setup-container">
                <div className="toggles-container">
                  <button
                    type="button"
                    className={`favourites-toggle${state.bookmarked ? ' selected' : ''}`}
                    onClick={() => toggleBookmark.mutate(movie)}
                  >
                    {t('Add to bookmarks')}
                  </button>
                  <button
                    type="button"
                    className={`watched-toggle${state.watched ? ' selected' : ''}`}
                    onClick={() =>
                      toggleWatched.mutate({ imdbId: movie.imdb_id, watched: state.watched })
                    }
                  >
                    {state.watched ? t('Seen') : t('Not Seen')}
                  </button>
                </div>
              </div>
              <div className="row">
                <div id="player-chooser" className="play-selector">
                  <PlayerChooser onWatch={play} />
                </div>
                {typeof movie.trailer === 'string' && movie.trailer.length > 0 ? (
                  <button
                    type="button"
                    id="watch-trailer"
                    className="button play-selector"
                    onClick={() => playTrailer(movie.trailer as string)}
                  >
                    {t('Watch Trailer')}
                  </button>
                ) : null}
                {activateSeedbox ? (
                  <button
                    type="button"
                    id="download-torrent"
                    className="button play-selector"
                    onClick={download}
                  >
                    {t('Download')}
                  </button>
                ) : null}
                <div id="quality-selector" className="quality-selector">
                  <QualitySelector
                    torrents={movie.torrents}
                    defaultQualityKey="movies_default_quality"
                    onSelect={(quality, torrent) => setSelected([quality, torrent])}
                  />
                </div>
              </div>
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
              {audioLangs.length > 0 ? (
                <div id="audio-dropdown">
                  <LangDropdown
                    title={t('Audio Language')}
                    values={audioLangs}
                    selected={audioLang}
                    onChange={setAudioLang}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
