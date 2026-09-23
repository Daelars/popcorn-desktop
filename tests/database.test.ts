import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  DatabaseService,
  DatabaseServiceLive,
  SqliteLive,
  SqliteSettingsStoreLive,
} from '../src/main/database'
import { LegacyMigration } from '../src/main/legacy-migration'
import { NOT_MIGRATED } from '../src/main/migration'
import {
  type SettingsEnvironment,
  SettingsService,
  SettingsServiceLive,
} from '../src/main/settings'

const environment: SettingsEnvironment = {
  tempDir: 'C:/tmp',
  dataDir: 'C:/data',
  screen: { width: 1920, height: 1080 },
  windowFrame: false,
  arch: 'x64',
  platform: 'win32',
  appVersion: '0.5.1',
  releaseName: 'Now.. Bring me that Horizon',
}

function databaseRuntime() {
  return ManagedRuntime.make(DatabaseServiceLive.pipe(Layer.provide(SqliteLive(':memory:'))))
}

describe('DatabaseService', () => {
  it('adds, lists and removes bookmarks', async () => {
    const runtime = databaseRuntime()
    const run = <A, E>(effect: Effect.Effect<A, E, DatabaseService>) => runtime.runPromise(effect)

    await run(Effect.flatMap(DatabaseService, (db) => db.bookmarks.add('tt0111161', 'movie')))
    await run(Effect.flatMap(DatabaseService, (db) => db.bookmarks.add('tt0944947', 'tvshow')))
    const all = await run(Effect.flatMap(DatabaseService, (db) => db.bookmarks.list()))
    expect(all).toEqual([
      { imdbId: 'tt0111161', type: 'movie' },
      { imdbId: 'tt0944947', type: 'tvshow' },
    ])

    const moviesOnly = await run(
      Effect.flatMap(DatabaseService, (db) => db.bookmarks.list('movie')),
    )
    expect(moviesOnly).toHaveLength(1)

    await run(Effect.flatMap(DatabaseService, (db) => db.bookmarks.remove('tt0111161')))
    const remaining = await run(Effect.flatMap(DatabaseService, (db) => db.bookmarks.list()))
    expect(remaining).toHaveLength(1)
    await runtime.dispose()
  })

  it('keeps saved torrents, renaming and removing them', async () => {
    const runtime = databaseRuntime()
    const run = <A, E>(effect: Effect.Effect<A, E, DatabaseService>) => runtime.runPromise(effect)

    await run(
      Effect.flatMap(DatabaseService, (db) =>
        db.collection.add('Sintel', 'magnet:?xt=urn:btih:aaa&dn=Sintel'),
      ),
    )
    await run(
      Effect.flatMap(DatabaseService, (db) =>
        db.collection.add('Big Buck Bunny', 'magnet:?xt=urn:btih:bbb&dn=Big+Buck+Bunny'),
      ),
    )

    const saved = await run(Effect.flatMap(DatabaseService, (db) => db.collection.list))
    expect(saved.map((torrent) => torrent.name).sort()).toEqual(['Big Buck Bunny', 'Sintel'])
    const sintel = saved.find((torrent) => torrent.name === 'Sintel')
    expect(sintel?.source).toBe('magnet:?xt=urn:btih:aaa&dn=Sintel')

    await run(
      Effect.flatMap(DatabaseService, (db) => db.collection.rename(sintel?.id ?? 0, 'Sintel 2010')),
    )
    const renamed = await run(Effect.flatMap(DatabaseService, (db) => db.collection.list))
    expect(renamed.some((torrent) => torrent.name === 'Sintel 2010')).toBe(true)

    await run(Effect.flatMap(DatabaseService, (db) => db.collection.remove(sintel?.id ?? 0)))
    const remaining = await run(Effect.flatMap(DatabaseService, (db) => db.collection.list))
    expect(remaining).toHaveLength(1)
    await runtime.dispose()
  })

  it('tracks watched movies and episodes', async () => {
    const runtime = databaseRuntime()
    const run = <A, E>(effect: Effect.Effect<A, E, DatabaseService>) => runtime.runPromise(effect)
    const episode = { tvdbId: '3254641', imdbId: 'tt0944947', season: '1', episode: '1' }

    await run(Effect.flatMap(DatabaseService, (db) => db.watched.markMovie('tt0111161')))
    await run(Effect.flatMap(DatabaseService, (db) => db.watched.markEpisode(episode)))

    expect(await run(Effect.flatMap(DatabaseService, (db) => db.watched.movies))).toEqual([
      'tt0111161',
    ])
    expect(
      await run(Effect.flatMap(DatabaseService, (db) => db.watched.isEpisodeWatched(episode))),
    ).toBe(true)
    expect(
      await run(
        Effect.flatMap(DatabaseService, (db) =>
          db.watched.isEpisodeWatched({ ...episode, episode: '2' }),
        ),
      ),
    ).toBe(false)

    await run(Effect.flatMap(DatabaseService, (db) => db.watched.unmarkMovie('tt0111161')))
    expect(await run(Effect.flatMap(DatabaseService, (db) => db.watched.movies))).toEqual([])

    const episodes = await run(
      Effect.flatMap(DatabaseService, (db) => db.watched.episodesFor('3254641')),
    )
    expect(episodes).toHaveLength(1)
    expect(episodes[0]?.imdbId).toBe('tt0944947')
    await runtime.dispose()
  })

  it('caches movie and show payloads', async () => {
    const runtime = databaseRuntime()
    const run = <A, E>(effect: Effect.Effect<A, E, DatabaseService>) => runtime.runPromise(effect)

    await run(
      Effect.flatMap(DatabaseService, (db) =>
        db.media.putMovie('tt0111161', { title: 'Shawshank' }),
      ),
    )
    await run(
      Effect.flatMap(DatabaseService, (db) =>
        db.media.putShow('tt0944947', '121361', { title: 'GoT' }),
      ),
    )

    expect(
      await run(Effect.flatMap(DatabaseService, (db) => db.media.getMovie('tt0111161'))),
    ).toEqual({
      title: 'Shawshank',
    })
    expect(
      await run(Effect.flatMap(DatabaseService, (db) => db.media.getShow('tt0944947'))),
    ).toEqual({
      title: 'GoT',
    })
    expect(
      await run(Effect.flatMap(DatabaseService, (db) => db.media.getMovie('tt0000000'))),
    ).toBeUndefined()
    await runtime.dispose()
  })
})

describe('SqliteSettingsStore', () => {
  it('persists settings across service restarts', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'popcorn-db-')), 'app.sqlite')

    const layers = SettingsServiceLive(environment).pipe(
      Layer.provide(SqliteSettingsStoreLive.pipe(Layer.provide(SqliteLive(file)))),
      Layer.provide(Layer.succeed(LegacyMigration, { result: NOT_MIGRATED })),
    )

    const first = ManagedRuntime.make(layers)
    await first.runPromise(
      Effect.flatMap(SettingsService, (settings) =>
        settings.set('theme', 'Official_-_Light_theme'),
      ),
    )
    await first.dispose()

    const second = ManagedRuntime.make(layers)
    const theme = await second.runPromise(
      Effect.flatMap(SettingsService, (settings) => settings.get('theme')),
    )
    expect(theme).toBe('Official_-_Light_theme')
    await second.dispose()
  })
})
