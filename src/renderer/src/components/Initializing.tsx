import { useQuery } from '@tanstack/react-query'
import { type MouseEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import iconUrl from '../assets/icon.png'
import { popcorn } from '../bridge'
import { useSettings } from '../settings'

/**
 * `initializing.tpl` with `init_modal.js`: the boot splash (logo, progress bar, status) and the
 * "Loading stuck?" link that appears when boot takes longer than seven seconds.
 *
 * The bar tracks the two real boot steps — the database status read and the settings snapshot
 * the shell needs — so it only moves when one actually finishes. "Loading stuck?" runs
 * `init_modal.js:fixApp`: it repairs the databases before reloading, rather than only reloading.
 */
export function Initializing() {
  const { t } = useTranslation()
  const settings = useSettings()
  const database = useQuery({
    queryKey: ['database-status'],
    queryFn: () => popcorn().invoke('database:status', {}),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const [waiting, setWaiting] = useState(false)
  const [repairing, setRepairing] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setWaiting(true), 7000)
    return () => window.clearTimeout(timer)
  }, [])

  // Real milestones: the database answers first, then the settings snapshot. Nothing is faked.
  const progress = settings.isLoading ? (database.isSuccess ? 0.7 : 0.2) : 1
  const status = repairing
    ? t('Repairing databases')
    : database.isSuccess
      ? t('Database ready (schema v{{0}})', { 0: database.data.schemaVersion })
      : t('Loading database')

  const fix = async (event: MouseEvent) => {
    event.preventDefault()
    if (repairing) return
    setRepairing(true)
    try {
      // `fixApp`: clear the databases that can leave boot stuck, then restart cleanly.
      await popcorn().invoke('database:repair', {})
    } catch {
      // A repair failure must still restart; the next boot reports the database status again.
    } finally {
      window.location.reload()
    }
  }

  // `init_modal.js` left `.cancel` inert; restarting restores the pre-repair behaviour without
  // clearing the user's databases.
  const cancel = (event: MouseEvent) => {
    event.preventDefault()
    window.location.reload()
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
          {t('Status: {{0}} ...', { 0: status })}
        </div>
        <p id="cancel-block">
          <a href="#" className="cancel" onClick={cancel}>
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
