import { Layer } from 'effect'
import type { UpdateStatus } from '../shared/ipc'
import { CatalogServiceLive } from './catalog'
import { CollectionServiceLive } from './collection'
import { DatabaseServiceLive, SqliteLive, SqliteSettingsStoreLive } from './database'
import { FilePickerServiceLive } from './file-picker'
import { LocalFilesLive } from './localfiles'
import { LegacyMigrationLive } from './migration'
import { PlaybackTargetsLive } from './playback-targets'
import { PlayersServiceLive } from './players'
import { ProvidersServiceLive } from './providers/registry'
import { SearchServiceLive } from './search'
import { type SettingsEnvironment, SettingsServiceLive } from './settings'
import { SettingsEffectsLive } from './settings-effects'
import { StreamSessionLive } from './stream-session'
import { SubtitlesServiceLive } from './subtitles/service'
import { type UpdatePort, UpdatesServiceLive } from './updates'
import { WebTorrentEngineLive } from './webtorrent-engine'
import { WindowServiceLive } from './window'

/** What the process entry point knows and the services cannot read for themselves. */
export interface AppLayerInput {
  readonly settings: SettingsEnvironment
  readonly sqliteFile: string
  readonly legacyRoot: string | undefined
  readonly backupDir: string
  readonly platform: NodeJS.Platform
  readonly environment: Record<string, string | undefined>
  readonly updatePort: UpdatePort | undefined
  readonly publishUpdate: (status: UpdateStatus) => void
  readonly onMigrationError?: (error: unknown) => void
}

/**
 * The one Layer graph. Dependencies — not imperative ordering — decide what runs first:
 * migration before Settings, Settings before the torrent engine and the catalog.
 */
export const makeAppLayer = (input: AppLayerInput) => {
  const sqlite = SqliteLive(input.sqliteFile)
  const migration = LegacyMigrationLive({
    legacyRoot: input.legacyRoot,
    backupDir: input.backupDir,
    onError: (error) => input.onMigrationError?.(error),
  }).pipe(Layer.provide(sqlite))
  const settings = SettingsServiceLive(input.settings).pipe(
    Layer.provide(SqliteSettingsStoreLive.pipe(Layer.provide(sqlite))),
    Layer.provide(migration),
  )
  const database = DatabaseServiceLive.pipe(Layer.provide(sqlite))
  const core = Layer.mergeAll(settings, database, sqlite, LocalFilesLive, migration)
  const streams = StreamSessionLive.pipe(Layer.provide(WebTorrentEngineLive), Layer.provide(core))
  const search = SearchServiceLive.pipe(Layer.provide(settings))
  const providers = ProvidersServiceLive.pipe(Layer.provide(settings))
  const players = PlayersServiceLive({
    platform: input.platform,
    environment: input.environment,
  })
  const updates = UpdatesServiceLive(input.updatePort, input.publishUpdate)
  const catalog = CatalogServiceLive.pipe(Layer.provide(Layer.mergeAll(providers, database)))
  const subtitles = SubtitlesServiceLive.pipe(
    Layer.provide(Layer.mergeAll(settings, LocalFilesLive)),
  )
  const collection = CollectionServiceLive.pipe(
    Layer.provide(Layer.mergeAll(FilePickerServiceLive, settings, database)),
  )
  const settingsEffects = SettingsEffectsLive.pipe(
    Layer.provide(Layer.mergeAll(settings, WindowServiceLive)),
  )
  // Playback targets read the external players and the live sessions.
  const playbackTargets = PlaybackTargetsLive.pipe(Layer.provide(Layer.mergeAll(players, streams)))

  return Layer.mergeAll(
    core,
    streams,
    search,
    providers,
    players,
    updates,
    catalog,
    subtitles,
    collection,
    settingsEffects,
    playbackTargets,
    WindowServiceLive,
    FilePickerServiceLive,
  )
}
