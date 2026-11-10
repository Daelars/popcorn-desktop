import { useMutation } from '@tanstack/react-query'
import { ExternalLink, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { popcorn } from '../bridge'
import { failureText } from '../failure'
import { notify } from '../notify'

interface ExternalPlayerPanelProps {
  readonly source: string
  readonly title: string
  readonly fileIndex: number
  /** The external target id chosen in the chooser. */
  readonly targetId: string
}

/**
 * The legacy "streaming to an external player" flow: start the loopback session, hand it to
 * the chosen target, and keep the torrent alive until the player exits. The session closes
 * itself when the player exits (PlaybackTargets), so no stream is left running behind it.
 */
export function ExternalPlayerPanel({
  source,
  title,
  fileIndex,
  targetId,
}: ExternalPlayerPanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [streamingTo, setStreamingTo] = useState<string>()
  const sessionId = useRef<string | undefined>(undefined)

  const stop = () => {
    const id = sessionId.current
    sessionId.current = undefined
    if (id !== undefined) void popcorn().invoke('stream:stop', { id })
    setStreamingTo(undefined)
  }

  const play = useMutation({
    mutationFn: async () => {
      const bridge = popcorn()
      const session = await bridge.invoke('stream:start', {
        torrentId: source,
        fileIndex,
        origin: window.location.origin,
      })
      sessionId.current = session.id
      await bridge.invoke('playback:play', { targetId, sessionId: session.id, title })
      setStreamingTo(targetId)
    },
    onError: (error) => {
      stop()
      notify(failureText(error))
    },
  })

  // The target is already chosen; start it as soon as the panel mounts.
  useEffect(() => {
    play.mutate()
  }, [play])

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
        <div className="state-flex">
          <div className="state">
            <div className="external-play">
              {t('Streaming to')} <span className="player-name">{streamingTo ?? targetId}</span>
            </div>
            <div id="cancel-button" className="cancel-button button">
              <button type="button" className="cancel-button-text" onClick={stop}>
                {t('Cancel')}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="fakeskan" />
      <div className="external-hint">
        <ExternalLink size={14} aria-hidden /> {t('Playback continues in the external player')}
      </div>
    </div>
  )
}
