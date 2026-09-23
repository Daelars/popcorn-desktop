import { useEffect, useMemo, useState } from 'react'
import type { Torrent, TorrentsByQuality } from '../../../shared'
import { popcorn } from '../bridge'
import { fileSize } from '../format'
import { useSetting } from '../settings'

/** `Common.qualityCollator`: numeric-aware, case-insensitive quality ordering. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export interface QualitySelectorProps {
  readonly torrents: TorrentsByQuality
  readonly defaultQualityKey: 'movies_default_quality' | 'shows_default_quality'
  /** Qualities that stay visible but disabled when the provider has no torrent for them. */
  readonly required?: ReadonlyArray<string>
  readonly onSelect: (quality: string, torrent: Torrent) => void
}

/**
 * `quality-selector.tpl` with the selection rules from `quality_selector.js`: qualities are
 * sorted, missing required qualities render disabled, and the default quality from the
 * settings picks the initial chip.
 */
export function QualitySelector({
  torrents,
  defaultQualityKey,
  required = [],
  onSelect,
}: QualitySelectorProps) {
  const configured = useSetting(defaultQualityKey).data
  const [active, setActive] = useState<string>()

  const sorted = useMemo(() => {
    const entries: Array<[string, Torrent | undefined]> = required.map((key) => [key, undefined])
    const keys = Object.keys(torrents)
      .filter((key) => key !== '0')
      .sort(collator.compare)
    for (const key of keys) entries.push([key, torrents[key]])
    return entries
  }, [torrents, required])

  const apply = (quality: string, torrent: Torrent, persist: boolean) => {
    setActive(quality)
    if (persist) {
      void popcorn().invoke('settings:set', { key: defaultQualityKey, value: quality })
    }
    onSelect(quality, torrent)
  }

  // `initQuality`: the best quality at or below the configured default.
  useEffect(() => {
    if (active !== undefined) return
    let chosen: [string, Torrent] | undefined
    for (const [key, torrent] of sorted) {
      if (torrent === undefined) continue
      if (
        chosen === undefined ||
        configured === undefined ||
        collator.compare(key, configured) <= 0
      ) {
        chosen = [key, torrent]
      }
    }
    if (chosen !== undefined) apply(chosen[0], chosen[1], false)
  })

  return (
    <div className="sdow-quality">
      {sorted.map(([key, torrent]) =>
        torrent === undefined ? (
          <div key={key} className="disabled">
            {key}
          </div>
        ) : (
          <div
            key={key}
            className={`qselect${key === active ? ' active' : ''}`}
            title={fileSize(torrent.size)}
            onClick={() => apply(key, torrent, true)}
          >
            {key}
          </div>
        ),
      )}
    </div>
  )
}
