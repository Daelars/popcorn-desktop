import { useTranslation } from 'react-i18next'
import iconUrl from '../assets/icon.png'

function control(channel: 'window:minimize' | 'window:maximize' | 'window:close'): void {
  void window.popcorn?.invoke(channel, {}).catch(() => undefined)
}

/** The legacy Windows titlebar: icon, title, events indicator, window controls. */
export function TitleBar() {
  const { t } = useTranslation()
  return (
    <header className="windows-titlebar">
      <img className="icon" src={iconUrl} alt="" />
      <h1 className="windows-titlebar-title">Popcorn Time</h1>
      <div className="events" />
      <div className="window-controls">
        <button
          type="button"
          className="window-control"
          aria-label={t('Minimize')}
          onClick={() => control('window:minimize')}
        >
          <div className="control-icon window-minimize-icon" />
        </button>
        <button
          type="button"
          className="window-control"
          aria-label={t('Maximize')}
          onClick={() => control('window:maximize')}
        >
          <div className="control-icon window-maximize-icon" />
        </button>
        <button
          type="button"
          className="window-control"
          aria-label={t('Close')}
          onClick={() => control('window:close')}
        >
          <div className="control-icon window-close-icon" />
        </button>
      </div>
    </header>
  )
}
