import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, HardDrive, Pause, Play, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IpcResponse } from '../../../shared/ipc'

type TorrentSummary = IpcResponse<'torrents:list'>[number]

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

/** The seedbox: every live torrent with its speeds, files and progress. */
export function SeedboxPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [selected, setSelected] = useState<string>()

  const torrents = useQuery({
    queryKey: ['torrents'],
    queryFn: async (): Promise<ReadonlyArray<TorrentSummary>> => {
      const bridge = window.popcorn
      if (bridge === undefined) return []
      return bridge.invoke('torrents:list', {})
    },
    refetchInterval: 1000,
  })

  const control = useMutation({
    mutationFn: async ({
      action,
      infoHash,
    }: {
      action: 'torrents:pause' | 'torrents:resume' | 'torrents:remove'
      infoHash: string
    }) => {
      await window.popcorn?.invoke(action, { infoHash })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['torrents'] })
    },
  })

  const list = torrents.data ?? []
  const current = list.find((torrent) => torrent.infoHash === selected) ?? list[0]
  const percent = current === undefined ? 0 : Math.round(current.progress * 100)

  return (
    <div className="seedbox-container">
      <div className="spinner" style={torrents.isPending ? { display: 'block' } : undefined}>
        <div className="loading-container">
          <div className="ball" />
          <div className="ball1" />
        </div>
      </div>
      <div className="margintop" />
      <div className="content">
        <div className="seedbox-details">
          <div className="seedbox-torrents">
            <div className="seedbox-torrent-title">{t('Download list')}</div>
            {list.length === 0 && !torrents.isPending ? (
              <div className="notorrents-info">
                <div className="notorrents-frame">
                  <span className="notorrents-message">{t('Download list is empty...')}</span>
                </div>
              </div>
            ) : null}
            <div className="seedbox-torrent-list">
              <ul className="file-list">
                {list.map((torrent) => {
                  const active = torrent.infoHash === current?.infoHash
                  return (
                    <li
                      key={torrent.infoHash}
                      id={torrent.infoHash}
                      className={active ? 'tab-torrent active' : 'tab-torrent'}
                    >
                      <button
                        type="button"
                        className="watched pause-torrent"
                        aria-label={torrent.paused ? t('Resume') : t('Pause')}
                        onClick={() =>
                          control.mutate({
                            action: torrent.paused ? 'torrents:resume' : 'torrents:pause',
                            infoHash: torrent.infoHash,
                          })
                        }
                      >
                        {torrent.paused ? (
                          <Play size={16} aria-hidden />
                        ) : (
                          <Pause size={16} aria-hidden />
                        )}
                      </button>
                      <button
                        type="button"
                        className="torrent-name"
                        onClick={() => setSelected(torrent.infoHash)}
                      >
                        {torrent.name === '' ? t('connecting') : torrent.name}
                      </button>
                      <span className="watched">
                        <Download size={14} aria-hidden /> {formatSize(torrent.downloadSpeed)}/s
                      </span>
                      <span className="watched">
                        <Upload size={14} aria-hidden /> {formatSize(torrent.uploadSpeed)}/s
                      </span>
                      <button
                        type="button"
                        className="watched trash-torrent"
                        aria-label={t('Remove')}
                        onClick={() =>
                          control.mutate({ action: 'torrents:remove', infoHash: torrent.infoHash })
                        }
                      >
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
          {current === undefined ? null : (
            <div className="seedbox-overview">
              <div className="seedbox-infos">
                <b>
                  <div className="seedbox-infos-title">{current.name}</div>
                </b>
                <div className="seedbox-infos-aired">
                  <i className="watched seedbox-totalsize">
                    <HardDrive size={14} aria-hidden /> {formatSize(current.length)}
                  </i>
                  <i className="watched seedbox-downloaded">
                    <Download size={14} aria-hidden /> {formatSize(current.downloaded)}
                  </i>
                  <i className="watched seedbox-uploaded">
                    <Upload size={14} aria-hidden /> {formatSize(current.uploaded)}
                  </i>
                </div>
                <div className="seedbox-infos-synopsis">
                  <div className="torrents-info">
                    <ul className="file-list">
                      {current.files.map((file) => (
                        <li key={file.index} className="file-item">
                          <span className="file-name">{file.name}</span>
                          <span className="filesize">{formatSize(file.length)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="progress-wrapper">
                  <div className="progress-info">
                    <div className="progress-label">
                      <span>
                        {current.paused
                          ? t('Paused')
                          : `${formatSize(current.downloadSpeed)}/s · ${current.peers} ${t('peers')}`}
                      </span>
                    </div>
                    <div className="progress-percentage">
                      <span>{percent}%</span>
                    </div>
                  </div>
                  <div className="progress">
                    <div
                      className={percent >= 100 ? 'progress-bar done' : 'progress-bar'}
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
