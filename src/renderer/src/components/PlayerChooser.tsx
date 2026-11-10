import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IpcResponse } from '../../../shared/ipc'
import { popcorn } from '../bridge'
import { notify } from '../notify'
import { useSetting } from '../settings'

type PlaybackTarget = IpcResponse<'playback:targets'>[number]

interface ChooserItem {
  readonly id: string
  readonly name: string
  readonly type: string
}

/** `images/icons/<type>-icon.png`, the naming `ext_player.js` used for its device list. */
function iconOf(item: ChooserItem): string {
  return `images/icons/${item.type}-icon.png`
}

/**
 * `player-chooser.tpl` with the device chooser from `generic.js`/`ext_player.js`: Watch Now
 * starts the selected device, the caret lists every playback target, and the choice is
 * persisted as `chosenPlayer` (a target id).
 */
export function PlayerChooser({ onWatch }: { readonly onWatch: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const chosen = useSetting('chosenPlayer').data ?? 'local'
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const targets = useQuery({
    queryKey: ['playback-targets'],
    queryFn: async (): Promise<ReadonlyArray<PlaybackTarget>> =>
      popcorn().invoke('playback:targets', {}),
  })

  const items: ReadonlyArray<ChooserItem> = (targets.data ?? []).map((target) => ({
    id: target.id,
    name: target.name,
    type: target.kind === 'local' ? 'local' : `external-${target.type}`,
  }))
  const selected = items.find((item) => item.id === chosen) ?? items[0]
  if (selected === undefined) return null

  const choose = (id: string) => {
    void popcorn().invoke('settings:set', { key: 'chosenPlayer', value: id })
    setOpen(false)
  }

  const refresh = () => {
    setRefreshing(true)
    void queryClient.invalidateQueries({ queryKey: ['playback-targets'] }).finally(() => {
      window.setTimeout(() => setRefreshing(false), 800)
    })
  }

  const help = () => {
    notify(`${t('Popcorn Time currently supports')} ${items.map((item) => item.name).join(', ')}.`)
  }

  return (
    <div className={`button dropup${open ? ' open' : ''}`}>
      <div id="watch-now" className="left startStreaming" onClick={onWatch}>
        {t('Watch Now')}
      </div>
      <div
        className="dropdown-toggle left playerchoice"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') setOpen(!open)
        }}
      >
        <img className="imgplayerchoice" src={iconOf(selected)} alt="" />
        <span className="caret" />
      </div>
      <ul className="dropdown-menu playerchoicemenu" role="menu">
        <span className="playerchoicetoolbar">
          <span
            className={`fa fa-rotate playerchoicerefresh${refreshing ? ' fa-spin fa-spinner spin' : ''}`}
            title={t('Refresh')}
            onClick={refresh}
          />
          <span
            className="fa fa-question-circle playerchoicehelp"
            title={t('Help')}
            onClick={help}
          />
        </span>
        {items.map((item) => (
          <li key={item.id} id={`player-${item.id}`}>
            <a
              href="#"
              className={item.id === selected.id ? 'active' : undefined}
              onClick={(event) => {
                event.preventDefault()
                choose(item.id)
              }}
            >
              {item.name}
              <img className="playerchoiceicon" src={iconOf(item)} alt="" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
