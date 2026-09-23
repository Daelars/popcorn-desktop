import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { failureText } from '../failure'

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

/** The legacy file selector: lists the files in a torrent so one can be streamed. */
export function FileSelectorPage() {
  const [params] = useSearchParams()
  const source = params.get('source') ?? ''
  const title = params.get('title') ?? ''
  const quality = params.get('quality') ?? ''
  const navigate = useNavigate()
  const { t } = useTranslation()

  const files = useQuery({
    queryKey: ['streamFiles', source],
    queryFn: async () => {
      const bridge = window.popcorn
      if (bridge === undefined) return { infoHash: '', files: [] }
      return bridge.invoke('stream:files', { torrentId: source })
    },
    enabled: source !== '',
  })

  const target = (index: number) => {
    const query = new URLSearchParams({ source, title, quality, file: String(index) })
    for (const key of ['backdrop', 'imdbId', 'tvdbId', 'season', 'episode', 'subtitleLang']) {
      const value = params.get(key)
      if (value !== null && value !== '') query.set(key, value)
    }
    return `#/player?${query.toString()}`
  }

  return (
    <div className="file-selector-container">
      <div className="file-selector-backdrop" />
      <div className="file-selector-backdrop-overlay" />
      <button
        type="button"
        className="close-icon"
        aria-label={t('Close')}
        onClick={() => navigate(-1)}
      >
        <X size={25} aria-hidden />
      </button>

      <div className="title">{t('Please select a file to play')}</div>
      <div className="content">
        <ul className="file-list">
          {files.data?.files.map((file) => (
            <li key={file.index} className="file-item" data-index={file.index}>
              <span>{formatSize(file.length)}</span>
              <a href={target(file.index)}>{file.name}</a>
            </li>
          ))}
          {files.isPending ? <li style={{ marginTop: 30 }}>{t('Loading...')}</li> : null}
          {files.isError ? (
            <li style={{ marginTop: 30 }}>
              {t('Playback failed')}: {failureText(files.error)}
            </li>
          ) : null}
          {files.data !== undefined && files.data.files.length === 0 ? (
            <li style={{ marginTop: 30 }}>{t('No results found')}</li>
          ) : null}
          {source === '' ? <li style={{ marginTop: 30 }}>{t('No results found')}</li> : null}
        </ul>
      </div>
      <div className="fakeskan" />
    </div>
  )
}
