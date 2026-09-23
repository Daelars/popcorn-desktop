import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

interface KeyRow {
  readonly keys: ReadonlyArray<{ readonly label: string; readonly className?: string }>
  readonly action: string
}

const CONTROL = { label: 'ctrl', className: 'control' }
const SPACE = { label: 'space', className: 'spacebar' }
const ARROW = (symbol: string) => ({ label: symbol, className: 'arrow' })

/** Only the shortcuts the rebuild actually binds; the legacy table listed many more. */
const GLOBAL: ReadonlyArray<KeyRow> = [
  { keys: [{ label: '?' }, { label: '/' }], action: 'Open this screen' },
  { keys: [CONTROL, { label: ',' }], action: 'Open Settings' },
]

const PLAYER: ReadonlyArray<KeyRow> = [
  { keys: [SPACE, { label: 'k' }], action: 'Play/Pause' },
  { keys: [{ label: 'f' }], action: 'Toggle Fullscreen' },
  { keys: [{ label: 'm' }], action: 'Mute' },
  { keys: [ARROW('\u2192')], action: 'Seek Forward 10s' },
  { keys: [ARROW('\u2190')], action: 'Seek Backward 10s' },
  { keys: [ARROW('\u2191')], action: 'Increase Volume' },
  { keys: [ARROW('\u2193')], action: 'Decrease Volume' },
]

function Table({ title, rows }: { title: string; rows: ReadonlyArray<KeyRow> }) {
  const { t } = useTranslation()
  return (
    <table className="keyboard-table">
      <tbody>
        <tr>
          <th />
          <th>{title}</th>
        </tr>
        {rows.map((row) => (
          <tr key={row.action}>
            <td>
              {row.keys.map((key, index) => (
                <span key={`${row.action}-${key.label}`}>
                  {index > 0 ? '+' : ''}
                  <span className={key.className === undefined ? 'key' : `key ${key.className}`}>
                    {t(key.label)}
                  </span>
                </span>
              ))}
            </td>
            <td>{t(row.action)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The legacy keyboard shortcut overlay, restricted to the bindings that exist. */
export function KeyboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div className="keyboard-container">
      <button
        type="button"
        className="close-icon"
        aria-label={t('Close')}
        onClick={() => navigate(-1)}
      >
        <X size={25} aria-hidden />
      </button>
      <div className="overlay-content" />
      <div className="content">
        <h1>{t('Keyboard Shortcuts')}</h1>
        <hr />
        <div className="keyboard-outer">
          <div className="fix-float">
            <Table title={t('Global shortcuts')} rows={GLOBAL} />
            <Table title={t('Video Player')} rows={PLAYER} />
          </div>
        </div>
      </div>
    </div>
  )
}
