import { useTranslation } from 'react-i18next'
import { fileSize } from '../format'

export interface LoadingProgress {
  readonly progress: number
  readonly downloaded: number
  readonly length: number
  readonly speed: number
  readonly uploadSpeed: number
  readonly uploaded: number
  readonly peers: number
  readonly timeRemaining: number
}

export interface LoadingScreenProps {
  readonly title: string
  readonly backdrop?: string
  /** The i18n key `watchState` chose: connecting, downloading, startingDownload, … */
  readonly state: string
  readonly transparency?: string
  readonly progress?: LoadingProgress
  readonly filename?: string
  readonly streamUrl?: string
  readonly onCancel: () => void
  readonly onMinimize?: () => void
}

/**
 * `loading.tpl`: the connecting/downloading screen shown between starting a stream and the
 * player taking over. The controls mirror the legacy markup; only the values that exist in
 * this port (progress, filename, stream url) are filled in.
 */
export function LoadingScreen({
  title,
  backdrop,
  state,
  transparency = '0.65',
  progress,
  filename,
  streamUrl,
  onCancel,
  onMinimize,
}: LoadingScreenProps) {
  const { t } = useTranslation()
  const percent = Math.round((progress?.progress ?? 0) * 100)

  return (
    <div className="loading">
      <div
        className="loading-backdrop"
        style={backdrop === undefined ? undefined : { backgroundImage: `url(${backdrop})` }}
      />
      <div
        className="loading-backdrop-overlay"
        style={transparency === '0.65' ? undefined : { opacity: transparency }}
      />
      <div
        className="fa fa-angle-down minimize-icon tooltipped"
        title={t('Minimize')}
        onClick={onMinimize}
      />
      <div className="maximize-icon">
        <span className="buffer_percent">{percent}%</span>
        <span className="fa fa-play" id="max_play_ctrl" />
        <span className="title copytoclip" data-copy="title">
          {title}
        </span>
        <span id="maxdllb">@ </span>
        <span className="download_speed value" id="maxdl">
          {fileSize(progress?.speed ?? 0)}/s
        </span>
        <span className="fa fa-angle-up tooltipped" id="maxic" title={t('Restore')} />
      </div>

      <div className="state-flex">
        <div className="state">
          <div className="title tooltipped copytoclip" data-copy="title">
            {title}
          </div>
          <div className="external-play">
            {t('Streaming to')} <span className="player-name" />
          </div>

          <div className="loading-progressbar">
            <div id="loadingbar-contents" style={{ width: `${percent}%` }} />
          </div>

          <div className="text_download">{t(state)}</div>

          <div className="seed_status">
            <div className="loading-info">
              <span className="buffer_percent">{percent}%</span>
              &nbsp;&nbsp;&nbsp;<span className="text">(</span>
              <span className="text_downloadedformatted">
                {fileSize(progress?.downloaded ?? 0)}
              </span>
              <span className="text_size">
                {progress === undefined ? '' : ` / ${fileSize(progress.length)}`}
              </span>
              <span className="text">)</span>
              <span className="magnet-icon tooltipped" title={t('Magnet link')}>
                <i className="fa fa-magnet" />
              </span>
              <br />
              <span className="text_remaining">
                {progress === undefined || !Number.isFinite(progress.timeRemaining)
                  ? t('Unknown time remaining')
                  : t('{{0}} minute(s) remaining', {
                      0: Math.round(progress.timeRemaining / 60000),
                    })}
              </span>
              <span id="rbreak1">
                <br />
              </span>
              <br />
              <span className="loading-info-text" id="rdownl">
                {t('Download')}:&nbsp;
              </span>
              <span className="download_speed value">{fileSize(progress?.speed ?? 0)}/s</span>
              <span id="rbreak2">
                <br />
              </span>
              <span className="loading-info-text">{t('Upload')}:&nbsp;</span>
              <span className="upload_speed value">{fileSize(progress?.uploadSpeed ?? 0)}/s</span>
              <br />
              <span className="loading-info-text" id="ractpr">
                {t('Active Peers')}:&nbsp;
              </span>
              <span className="value_peers value">{progress?.peers ?? 0}</span>
              <span id="rbreak3">
                <br />
              </span>
              <span className="loading-info-text">{t('Filename')}:&nbsp;</span>
              <span className="text_filename value tooltipped copytoclip" data-copy="filename">
                {filename ?? ''}
              </span>
              <br />
              <span className="loading-info-text">{t('Stream Url')}:&nbsp;</span>
              <span className="text_streamurl value tooltipped copytoclip" data-copy="stream url">
                {streamUrl ?? ''}
              </span>
              <br />
              <div
                className="fa fa-caret-down show-pcontrols tooltipped"
                title={t('Show playback controls')}
              />
              <div className="player-controls">
                <i className="fa fa-backward backward" />
                <i className="fa fa-pause pause" />
                <i className="fa fa-stop stop" onClick={onCancel} />
                <i className="fa fa-forward forward" />
              </div>
              <div className="playing-progressbar">
                <div id="playingbar-contents" />
              </div>
            </div>
          </div>

          <div id="cancel-button" className="cancel-button button">
            <div className="cancel-button-text" onClick={onCancel}>
              {t('Cancel')}
            </div>
          </div>
        </div>
      </div>
      <div className="warning-nospace">
        <span className="warn">{t('Your disk is almost full.')}</span>
        <br />
        <span className="detail">
          {t('You need to make more space available on your disk by deleting files.')}
        </span>
      </div>
    </div>
  )
}
