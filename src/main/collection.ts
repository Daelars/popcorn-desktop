import { copyFile, mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Context, Effect, Layer } from 'effect'
import { DbError } from '../shared/errors'
import { DatabaseService } from './database'
import { FilePickerService } from './file-picker'
import { SettingsService } from './settings'

export interface CollectionShape {
  /** `collection:import`: copies the picked `.torrent` into the collection directory. */
  readonly import: () => Effect.Effect<void, DbError>
}

export class CollectionService extends Context.Tag('CollectionService')<
  CollectionService,
  CollectionShape
>() {}

export const CollectionServiceLive = Layer.effect(
  CollectionService,
  Effect.gen(function* () {
    const files = yield* FilePickerService
    const settings = yield* SettingsService
    const database = yield* DatabaseService

    return CollectionService.of({
      import: () =>
        Effect.gen(function* () {
          const picked = yield* files.pickTorrent()
          if (picked === undefined) return
          const dataDir = yield* settings.get('databaseLocation')
          const name = basename(picked, '.torrent')
          const target = join(dataDir, 'TorrentCollection', `${name}.torrent`)
          yield* Effect.tryPromise({
            try: async () => {
              await mkdir(dirname(target), { recursive: true })
              await copyFile(picked, target)
            },
            catch: (cause) =>
              new DbError({
                message: `cannot import torrent file ${picked}`,
                operation: 'collection.import',
                cause,
              }),
          })
          yield* database.collection.add(name, `file:${target}`)
        }),
    })
  }),
)
