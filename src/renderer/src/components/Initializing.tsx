import { type MouseEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import iconUrl from '../assets/icon.png'

export interface InitializingProps {
  /** 0..1; `updateModal` set the progress bar width from the model's `done`. */
  readonly progress: number
  readonly status?: string
  /** `init_modal.js:fixApp` deleted the databases and restarted; here it reloads the app. */
  readonly onFix: () => void
}

/**
 * `initializing.tpl` with `init_modal.js`: the boot splash (logo, progress bar, status) and
 * the "Loading stuck?" link that appears when boot takes longer than seven seconds.
 */
export function Initializing({ progress, status, onFix }: InitializingProps) {
  const { t } = useTranslation()
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setWaiting(true), 7000)
    return () => window.clearTimeout(timer)
  }, [])

  const fix = (event: MouseEvent) => {
    event.preventDefault()
    onFix()
  }

  return (
    <div className="init-container">
      <img className="icon-begin" src={iconUrl} alt="" />
      <img className="init-icon-title" src="images/popcorn-time-logo.svg" alt="Popcorn Time" />
      <div className="init-geek-line">
        {t('Made with')} <span className="heart">&#10084;</span>{' '}
        {t('by a bunch of geeks from All Around The World')}
      </div>
      <div className="text-begin">
        <div className="init-text">
          {t('Initializing {{0}}. Please Wait...', { 0: 'Popcorn Time' })}
        </div>
        <div className="init-progressbar">
          <div id="initbar-contents" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div id="init-status" className="init-status">
          {status === undefined ? null : t('Status: {{0}} ...', { 0: status })}
        </div>
        <p id="cancel-block">
          <a href="#" className="cancel" onClick={fix}>
            {t('Cancel')}
          </a>
        </p>
      </div>
      {waiting ? (
        <p id="waiting-block">
          <a href="#" className="fixApp" onClick={fix}>
            {t('Loading stuck ? Click here !')}
          </a>
        </p>
      ) : null}
    </div>
  )
}
