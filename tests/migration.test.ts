import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { openDatabase, Sqlite } from '../src/main/database'
import { LegacyMigration } from '../src/main/legacy-migration'
import {
  LegacyMigrationLive,
  legacyCollectionCandidates,
  migrateLegacy,
  readLegacyCollection,
  resolveLegacyCollection,
  resolveLegacyProfileRoot,
} from '../src/main/migration'
import { MigrationError } from '../src/shared/errors'

function fixtureProfile(): { legacyRoot: string; backupDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'popcorn-legacy-'))
  const dataDir = join(root, 'data')
  mkdirSync(dataDir, { recursive: true })

  writeFileSync(
    join(dataDir, 'bookmarks.db'),
    [
      JSON.stringify({ imdb_id: 'tt0111161', type: 'movie', _id: 'a1' }),
      JSON.stringify({ imdb_id: 'tt0944947', type: 'tvshow', _id: 'a2' }),
    ].join('\n'),
  )
  writeFileSync(
    join(dataDir, 'watched.db'),
    [
      JSON.stringify({
        movie_id: 'tt0111161',
        date: '2020-01-01T00:00:00.000Z',
        type: 'movie',
        _id: 'w1',
      }),
      JSON.stringify({
        tvdb_id: 3254641,
        imdb_id: 'tt0944947',
        season: 1,
        episode: 1,
        type: 'episode',
        date: '2020-01-02T00:00:00.000Z',
        _id: 'w2',
      }),
      'this line is not json',
    ].join('\n'),
  )
  writeFileSync(
    join(dataDir, 'settings.db'),
    [
      JSON.stringify({ key: 'theme', value: 'Official_-_Light_theme', _id: 's1' }),
      JSON.stringify({ key: 'postersWidth', value: 234, _id: 's2' }),
      JSON.stringify({ key: 'disclaimerAccepted', value: 1, _id: 's3' }),
    ].join('\n'),
  )
  writeFileSync(
    join(dataDir, 'movies.db'),
    JSON.stringify({ imdb_id: 'tt0111161', title: 'Shawshank' }),
  )
  writeFileSync(
    join(dataDir, 'shows.db'),
    JSON.stringify({ imdb_id: 'tt0944947', tvdb_id: 121361, title: 'Game of Thrones' }),
  )

  // The legacy collection: a magnet stored as a text file, a `.torrent` file, a non-magnet
  // text file and a directory whose name contains `.torrent`.
  const collectionDir = join(dataDir, 'TorrentCollection')
  mkdirSync(collectionDir, { recursive: true })
  writeFileSync(
    join(collectionDir, 'Some Movie 2020'),
    'magnet:?xt=urn:btih:AAAABBBBCCCCDDDDEEEEFFFF0000111122223333&dn=Some+Movie+2020',
  )
  writeFileSync(join(collectionDir, 'Series Pack.torrent'), 'd8:announce0:4:infod4:name...')
  writeFileSync(join(collectionDir, 'notes.txt'), 'not a magnet link')
  mkdirSync(join(collectionDir, 'nested.torrent'), { recursive: true })
  mkdirSync(join(root, 'Local Storage', 'leveldb'), { recursive: true })

  return { legacyRoot: root, backupDir: join(root, 'backup-legacy') }
}

describe('migrateLegacy', () => {
  it('migrates bookmarks, watch history, settings and caches', () => {
    const { legacyRoot, backupDir } = fixtureProfile()
    const db = openDatabase(':memory:')

    const result = Effect.runSync(migrateLegacy(db, legacyRoot, { backupDir }))

    expect(result.migrated).toBe(true)
    expect(result.counts).toEqual({
      bookmarks: 2,
      watchedMovies: 1,
      watchedEpisodes: 1,
      settings: 3,
      movies: 1,
      shows: 1,
      collection: 2,
    })
    expect(result.malformedLines).toBe(1)
    expect(result.skipped).toContain(
      'Local Storage (LevelDB): window geometry and regenerable caches only',
    )

    expect(db.prepare('SELECT COUNT(*) AS c FROM bookmarks').get()).toEqual({ c: 2 })
    expect(db.prepare('SELECT imdb_id FROM watched_movies').all()).toEqual([
      { imdb_id: 'tt0111161' },
    ])
    expect(db.prepare('SELECT season, episode FROM watched_episodes').all()).toEqual([
      { season: '1', episode: '1' },
    ])
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('postersWidth')).toEqual({
      value: '234',
    })
    // The port reads the disclaimer from `meta`; the legacy acceptance must carry over.
    expect(db.prepare('SELECT value FROM meta WHERE key = ?').get('disclaimerAccepted')).toEqual({
      value: 'true',
    })
    // The magnet keeps its link; the `.torrent` file is referenced by path.
    expect(db.prepare('SELECT name, source FROM torrent_collection ORDER BY name').all()).toEqual([
      {
        name: 'Series Pack.torrent',
        source: `file:${join(legacyRoot, 'data', 'TorrentCollection', 'Series Pack.torrent')}`,
      },
      {
        name: 'Some Movie 2020',
        source: 'magnet:?xt=urn:btih:AAAABBBBCCCCDDDDEEEEFFFF0000111122223333&dn=Some+Movie+2020',
      },
    ])
    expect(existsSync(join(backupDir, 'bookmarks.db'))).toBe(true)
    expect(existsSync(join(backupDir, 'TorrentCollection', 'Series Pack.torrent'))).toBe(true)
  })

  it('runs once and is idempotent', () => {
    const { legacyRoot, backupDir } = fixtureProfile()
    const db = openDatabase(':memory:')

    const first = Effect.runSync(migrateLegacy(db, legacyRoot, { backupDir }))
    const second = Effect.runSync(migrateLegacy(db, legacyRoot, { backupDir }))

    expect(first.migrated).toBe(true)
    expect(second.migrated).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS c FROM bookmarks').get()).toEqual({ c: 2 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM watched_episodes').get()).toEqual({ c: 1 })
  })

  it('tolerates a missing legacy profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'popcorn-empty-'))
    const db = openDatabase(':memory:')

    const result = Effect.runSync(migrateLegacy(db, root))

    expect(result.migrated).toBe(true)
    expect(result.counts.bookmarks).toBe(0)
    expect(result.counts.collection).toBe(0)
    expect(result.skipped).toEqual([])
  })
})

describe('legacy torrent collection', () => {
  it('prefers the data/ folder and falls back to the older root-level one', () => {
    const root = mkdtempSync(join(tmpdir(), 'popcorn-collection-'))
    const dataFolder = join(root, 'data', 'TorrentCollection')
    const rootFolder = join(root, 'TorrentCollection')
    const existsIn =
      (...paths: string[]) =>
      (candidate: string) =>
        paths.includes(candidate)

    expect(resolveLegacyCollection(root, existsIn(dataFolder)).folder).toBe(dataFolder)
    expect(resolveLegacyCollection(root, existsIn(rootFolder)).folder).toBe(rootFolder)
  })

  it('reports every checked path when the folder is absent', () => {
    const root = join('home', 'profile')
    const resolution = resolveLegacyCollection(root, () => false)
    expect(resolution.folder).toBeUndefined()
    expect(resolution.checked).toEqual([
      join(root, 'data', 'TorrentCollection'),
      join(root, 'TorrentCollection'),
    ])
    expect(legacyCollectionCandidates(root)).toEqual(resolution.checked)
  })

  it('maps magnets to their link, torrents to file: paths, and skips the rest', () => {
    const root = mkdtempSync(join(tmpdir(), 'popcorn-collection-'))
    const folder = join(root, 'data', 'TorrentCollection')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'A Movie'), 'magnet:?xt=urn:btih:ABCDEF')
    writeFileSync(join(folder, 'Pack.torrent'), 'binary-ish')
    writeFileSync(join(folder, 'readme.txt'), 'hello')
    mkdirSync(join(folder, 'weird.torrent'), { recursive: true })

    const entries = readLegacyCollection(folder)

    expect(
      [...entries]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => [entry.name, entry.source]),
    ).toEqual([
      ['A Movie', 'magnet:?xt=urn:btih:ABCDEF'],
      ['Pack.torrent', `file:${join(folder, 'Pack.torrent')}`],
    ])
    expect(entries.every((entry) => entry.addedAt !== '')).toBe(true)
  })
})

describe('resolveLegacyProfileRoot', () => {
  const appData = join('home', 'appdata')
  const base = join(appData, 'Popcorn-Time')
  const existsIn =
    (...paths: string[]) =>
    (candidate: string) =>
      paths.includes(candidate)

  it('prefers `User Data\\Default` on Windows when it holds data', () => {
    const resolution = resolveLegacyProfileRoot(
      appData,
      'win32',
      existsIn(join(base, 'User Data', 'Default', 'data'), join(base, 'data')),
    )
    expect(resolution.root).toBe(join(base, 'User Data', 'Default'))
  })

  it('falls back to `User\\Default` on Windows when the first candidate is empty', () => {
    const resolution = resolveLegacyProfileRoot(
      appData,
      'win32',
      existsIn(join(base, 'User', 'Default', 'data')),
    )
    expect(resolution.root).toBe(join(base, 'User', 'Default'))
  })

  it('falls back to the bare app directory on Windows', () => {
    const resolution = resolveLegacyProfileRoot(appData, 'win32', existsIn(join(base, 'data')))
    expect(resolution.root).toBe(base)
  })

  it('reports every checked path when no candidate exists', () => {
    const resolution = resolveLegacyProfileRoot(appData, 'win32', () => false)
    expect(resolution.root).toBeUndefined()
    expect(resolution.checked).toEqual([
      join(base, 'User Data', 'Default'),
      join(base, 'User', 'Default'),
      base,
    ])
  })

  it('uses the `Default` profile on macOS and Linux', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const resolution = resolveLegacyProfileRoot(
        appData,
        platform,
        existsIn(join(base, 'Default', 'data')),
      )
      expect(resolution.root).toBe(join(base, 'Default'))
    }
  })
})

describe('LegacyMigration layer', () => {
  it('keeps the backup, reports the error and recovers when migration fails', async () => {
    const { legacyRoot, backupDir } = fixtureProfile()
    const db = openDatabase(':memory:')
    // Break the schema so the migration transaction throws after the backup is taken.
    db.exec('DROP TABLE bookmarks')
    const errors: MigrationError[] = []
    const runtime = ManagedRuntime.make(
      LegacyMigrationLive({ legacyRoot, backupDir, onError: (error) => errors.push(error) }).pipe(
        Layer.provide(Layer.succeed(Sqlite, db)),
      ),
    )

    const result = await runtime.runPromise(
      Effect.flatMap(LegacyMigration, (migration) => Effect.succeed(migration.result)),
    )

    expect(result.migrated).toBe(false)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(MigrationError)
    expect(existsSync(join(backupDir, 'bookmarks.db'))).toBe(true)
    await runtime.dispose()
  })
})
