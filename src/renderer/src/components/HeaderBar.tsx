import { useTranslation } from 'react-i18next'

function control(channel: 'window:minimize' | 'window:maximize' | 'window:close'): void {
  void window.popcorn?.invoke(channel, {}).catch(() => undefined)
}

/**
 * The legacy header bar for macOS and Linux (`nav.btn-set` + OS buttons + fullscreen).
 * Windows uses the titlebar variant instead.
 */
export function HeaderBar() {
  const { t } = useTranslation()
  return (
    <header id="header">
      <nav className="btn-set">
        <button
          type="button"
          className="btn-os os-minimize"
          aria-label={t('Minimize')}
          onClick={() => control('window:minimize')}
        />
        <button
          type="button"
          className="btn-os os-maximize"
          aria-label={t('Maximize')}
          onClick={() => control('window:maximize')}
        />
        <button
          type="button"
          className="btn-os os-close"
          aria-label={t('Close')}
          onClick={() => control('window:close')}
        />
      </nav>
      <nav className="btn-set">
        <button
          type="button"
          className="btn-os fullscreen"
          aria-label={t('Toggle Fullscreen')}
          onClick={() => {
            void window.popcorn?.invoke('window:maximize', {}).catch(() => undefined)
          }}
        />
      </nav>
      <h1>
        Popcorn Time
        <div className="events" />
      </h1>
    </header>
  )
}
