import { useQuery } from '@tanstack/react-query'
import type { Settings, SettingsKey } from '../../shared/settings'
import { popcorn } from './bridge'

/**
 * Reads the whole settings snapshot over the typed IPC bridge. Query-backed so a write can
 * invalidate it. The bridge validates the snapshot against the shared schema.
 */
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: (): Promise<Partial<Settings>> => popcorn().invoke('settings:all', {}),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Reads one setting out of the shared snapshot; the value type comes from the schema. */
export function useSetting<K extends SettingsKey>(key: K) {
  const query = useSettings()
  return { ...query, data: query.data?.[key] }
}
