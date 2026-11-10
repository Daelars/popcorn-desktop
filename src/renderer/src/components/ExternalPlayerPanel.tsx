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
  /** A dropped local file; served over loopback when present instead of a torrent. */
  readonly localPath?: string
}

/**
 * The legacy "streaming to an external player" flow: start the loopback session, hand it to
 * the chosen target, and keep the torrent alive until the player exits. The session closes
 * itself when the player exits (PlaybackTargets), so no stream is left running behind it.
 * Local files take the same road through `local:serve` plus a bare-URL `playback:play`.
 */
export function ExternalPlayerPanel({
  source,
  title,
  fileIndex,
  targetId,
  localPath,
}: ExternalPlayerPanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [streamingTo, setStreamingTo] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const sessionId = useRef<string | undefined>(undefined)
  const localPort = useRef<number | undefined>(undefined)

  // The target is already chosen; start it as soon as the panel mounts. Plain async with
  // a per-run cancellation (like PlayerPage) instead of a mutation object, whose identity
  // changes every render and re-fired this effect into duplicate sessions.
  useEffect(() => {
    const bridge = popcorn()
    let cancelled = false
    const stopSession = (id: string) => bridge.invoke('stream:stop', { id })
    const stopLocal = (port: number) => bridge.invoke('local:stop', { port })
    const run = async () => {
      try {
        if (localPath !== undefined && localPath !== '') {
          const served = await bridge.invoke('local:serve', {
            path: localPath,
            origin: window.location.origin,
          })
          if (cancelled) {
            void stopLocal(served.port).catch(() => undefined)
            return
          }
          localPort.current = served.port
          await bridge.invoke('playback:play', {
            targetId,
            url: served.url,
            title,
            ...(served.subtitle === undefined ? {} : { subtitle: served.subtitle }),
          })
        } else {
          const session = await bridge.invoke('stream:start', {
            torrentId: source,
            fileIndex,
            origin: window.location.origin,
          })
          if (cancelled) {
            void stopSession(session.id).catch(() => undefined)
            return
          }
          sessionId.current = session.id
          await bridge.invoke('playback:play', { targetId, sessionId: session.id, title })
        }
        if (!cancelled) setStreamingTo(targetId)
      } catch (error) {
        if (!cancelled) {
          setFailure(failureText(error))
          notify(failureText(error))
        }
      }
    }
    void run()
    return () => {
      cancelled = true
      const id = sessionId.current
      const port = localPort.current
      sessionId.current = undefined
      localPort.current = undefined
      if (id !== undefined) void stopSession(id).catch(() => undefined)
      if (port !== undefined) void stopLocal(port).catch(() => undefined)
    }
  }, [source, localPath, fileIndex, targetId, title])

  const stop = () => {
    const id = sessionId.current
    const port = localPort.current
    sessionId.current = undefined
    localPort.current = undefined
    if (id !== undefined) void popcorn().invoke('stream:stop', { id })
    if (port !== undefined) void popcorn().invoke('local:stop', { port })
    setStreamingTo(undefined)
  }

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
            {failure === undefined ? null : <div className="player-failure value">{failure}</div>}
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
