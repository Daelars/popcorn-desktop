import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { popcorn } from '../bridge'
import { notify, notifyAction } from '../notify'
import { useSetting } from '../settings'
import { consumeManualCheck } from '../updates'

/**
 * Auto-update prompts. `updater.js` published these through the global vent, so they show
 * wherever the user is — the About page only owns the manual "Check for updates" button.
 */
export function UpdatePrompt() {
  const { t } = useTranslation()
  const projectName = useSetting('projectName').data ?? 'Popcorn Time'
  const accepted = useRef(false)
  // The listener subscribes once; the latest values come from refs.
  const projectNameRef = useRef(projectName)
  projectNameRef.current = projectName
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    const bridge = popcorn()
    return bridge.onUpdateStatus((status) => {
      const translate = tRef.current
      switch (status.state) {
        case 'available':
          notifyAction(
            `${translate('New version available !')} ${translate('Exit {{0}} and download now ?', { 0: projectNameRef.current })}`,
            [
              {
                label: translate('Yes'),
                onClick: () => {
                  accepted.current = true
                  void bridge.invoke('updates:download', {})
                },
              },
              { label: translate('No'), onClick: () => undefined },
            ],
          )
          return
        case 'ready':
          // `autoInstallOnAppQuit` covers a plain quit; an accepted update installs now.
          if (accepted.current) void bridge.invoke('updates:install', {})
          return
        case 'latest':
          if (consumeManualCheck()) notify(translate('Already using the latest version'))
          return
        case 'unsupported':
        case 'error':
          if (consumeManualCheck()) notify(translate('Failed to check for new version'))
          return
        default:
          return
      }
    })
  }, [])

  return null
}
