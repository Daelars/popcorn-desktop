import { useQuery } from '@tanstack/react-query'
import type { Settings, SettingsKey } from '../../shared/settings'

/**
 * Reads the whole settings snapshot over the typed IPC bridge. Query-backed so a write
 * can invalidate it. Returns undefined when the renderer runs outside Electron.
 */
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async (): Promise<Partial<Settings>> => {
      const bridge = window.popcorn
      if (bridge === undefined) return {}
      // The contract types settings values as unknown; the schema decides each type.
      return (await bridge.invoke('settings:all', {})) as Partial<Settings>
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Reads one setting out of the shared snapshot. */
export function useSetting<K extends SettingsKey>(key: K) {
  const query = useSettings()
  return { ...query, data: query.data?.[key] as Settings[K] | undefined }
}
