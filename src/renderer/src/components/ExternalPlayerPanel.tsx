import { useMutation, useQuery } from '@tanstack/react-query'
import { ExternalLink, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { IpcResponse } from '../../../shared/ipc'
import { popcorn } from '../bridge'

type ExternalPlayer = IpcResponse<'players:list'>[number]

interface ExternalPlayerPanelProps {
  readonly source: string
  readonly title: string
  readonly fileIndex: number
}

/**
 * The legacy "streaming to an external player" flow: start the loopback stream, hand its
 * URL to the chosen player, and keep the torrent alive until the user stops it.
 */
export function ExternalPlayerPanel({ source, title, fileIndex }: ExternalPlayerPanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [streamingTo, setStreamingTo] = useState<string>()
  const sessionPort = useRef<number | undefined>(undefined)

  const players = useQuery({
    queryKey: ['players'],
    queryFn: async (): Promise<ReadonlyArray<ExternalPlayer>> => {
      const bridge = popcorn()
      return bridge.invoke('players:list', {})
    },
  })

  const play = useMutation({
    mutationFn: async (player: ExternalPlayer) => {
      const bridge = popcorn()
      const session = await bridge.invoke('stream:start', {
        torrentId: source,
        fileIndex,
        origin: window.location.origin,
      })
      sessionPort.current = session.port
      await bridge.invoke('players:play', { playerId: player.id, url: session.url, title })
      setStreamingTo(player.id)
    },
  })

  const stop = () => {
    const port = sessionPort.current
    sessionPort.current = undefined
    if (port !== undefined) {
      void popcorn().invoke('stream:stop', { port })
    }
    setStreamingTo(undefined)
  }

  const list = players.data ?? []

  return (
    <div className="file-selector-container">
      <div className="file-selector-backdrop-overlay" />
      <button
        type="button"
        className="close-icon"
        aria-label={t('Close')}
        onClick={() => {
          stop()
          navigate(-1)
        }}
      >
        <X size={25} aria-hidden />
      </button>
      <div className="title">{t('External Player')}</div>
      <div className="content">
        {streamingTo === undefined ? (
          <ul className="file-list">
            {list.map((player) => (
              <li key={player.id} className="file-item">
                <button type="button" className="player-choice" onClick={() => play.mutate(player)}>
                  {player.id}
                </button>
              </li>
            ))}
            {players.data !== undefined && list.length === 0 ? (
              <li style={{ marginTop: 30 }}>{t('No results found')}</li>
            ) : null}
          </ul>
        ) : (
          <div className="state-flex">
            <div className="state">
              <div className="external-play">
                {t('Streaming to')} <span className="player-name">{streamingTo}</span>
              </div>
              <div id="cancel-button" className="cancel-button button">
                <button type="button" className="cancel-button-text" onClick={stop}>
                  {t('Cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="fakeskan" />
      <div className="external-hint">
        <ExternalLink size={14} aria-hidden /> {t('Playback continues in the external player')}
      </div>
    </div>
  )
}
