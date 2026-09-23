import BetterSqlite3, { type Database as SqliteDatabase } from 'better-sqlite3'
import { Context, Effect, Layer } from 'effect'
import { DbError, SettingsError } from '../shared/errors'
import { SettingsStore } from './settings'

export class Sqlite extends Context.Tag('Sqlite')<Sqlite, SqliteDatabase>() {}

const SCHEMA_VERSION = 2

/** Creates the tables the app owns; safe to run on every boot. */
export function ensureSchema(db: SqliteDatabase): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version >= SCHEMA_VERSION) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      imdb_id TEXT PRIMARY KEY,
      type TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watched_movies (
      imdb_id TEXT PRIMARY KEY,
      watched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watched_episodes (
      tvdb_id TEXT NOT NULL,
      imdb_id TEXT NOT NULL,
      season TEXT NOT NULL,
      episode TEXT NOT NULL,
      watched_at TEXT NOT NULL,
      PRIMARY KEY (tvdb_id, season, episode)
    );
    CREATE TABLE IF NOT EXISTS movies (
      imdb_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shows (
      imdb_id TEXT PRIMARY KEY,
      tvdb_id TEXT,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS torrent_collection (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source TEXT NOT NULL UNIQUE,
      added_at TEXT NOT NULL
    );
  `)
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
}

export function openDatabase(file: string): SqliteDatabase {
  const db = new BetterSqlite3(file)
  db.pragma('journal_mode = WAL')
  ensureSchema(db)
  return db
}

export const SqliteLive = (file: string) =>
  Layer.scoped(
    Sqlite,
    Effect.acquireRelease(
      Effect.try({
        try: () => openDatabase(file),
        catch: (cause) =>
          new DbError({ message: `cannot open database at ${file}`, operation: 'open', cause }),
      }),
      (db) => Effect.sync(() => db.close()),
    ),
  )

function tryDb<A>(operation: string, run: () => A): Effect.Effect<A, DbError> {
  return Effect.try({
    try: run,
    catch: (cause) => new DbError({ message: `database ${operation} failed`, operation, cause }),
  })
}

export interface Bookmark {
  readonly imdbId: string
  readonly type: string
}

export interface EpisodeRef {
  readonly tvdbId: string
  readonly imdbId: string
  readonly season: string
  readonly episode: string
}

export interface WatchedEpisode extends EpisodeRef {
  readonly watchedAt: string
}

/** A magnet or torrent file kept in the torrent collection. */
export interface SavedTorrent {
  readonly id: number
  readonly name: string
  readonly source: string
  readonly addedAt: string
}

export interface DatabaseServiceShape {
  readonly bookmarks: {
    readonly add: (imdbId: string, type: string) => Effect.Effect<void, DbError>
    readonly remove: (imdbId: string) => Effect.Effect<void, DbError>
    readonly list: (type?: string) => Effect.Effect<ReadonlyArray<Bookmark>, DbError>
  }
  readonly watched: {
    readonly markMovie: (imdbId: string) => Effect.Effect<void, DbError>
    readonly unmarkMovie: (imdbId: string) => Effect.Effect<void, DbError>
    readonly markEpisode: (episode: EpisodeRef) => Effect.Effect<void, DbError>
    readonly unmarkEpisode: (episode: EpisodeRef) => Effect.Effect<void, DbError>
    readonly isEpisodeWatched: (episode: EpisodeRef) => Effect.Effect<boolean, DbError>
    readonly movies: Effect.Effect<ReadonlyArray<string>, DbError>
    readonly episodesFor: (tvdbId?: string) => Effect.Effect<ReadonlyArray<WatchedEpisode>, DbError>
  }
  /** Small app-level flags that are not user settings (the legacy AdvSettings store). */
  readonly meta: {
    readonly get: (key: string) => Effect.Effect<unknown, DbError>
    readonly set: (key: string, value: unknown) => Effect.Effect<void, DbError>
  }
  readonly collection: {
    readonly list: Effect.Effect<ReadonlyArray<SavedTorrent>, DbError>
    readonly add: (name: string, source: string) => Effect.Effect<void, DbError>
    readonly remove: (id: number) => Effect.Effect<void, DbError>
    readonly rename: (id: number, name: string) => Effect.Effect<void, DbError>
  }
  readonly media: {
    readonly putMovie: (imdbId: string, payload: unknown) => Effect.Effect<void, DbError>
    readonly getMovie: (imdbId: string) => Effect.Effect<unknown, DbError>
    readonly putShow: (
      imdbId: string,
      tvdbId: string,
      payload: unknown,
    ) => Effect.Effect<void, DbError>
    readonly getShow: (imdbId: string) => Effect.Effect<unknown, DbError>
  }
}

export class DatabaseService extends Context.Tag('DatabaseService')<
  DatabaseService,
  DatabaseServiceShape
>() {}

export const DatabaseServiceLive = Layer.effect(
  DatabaseService,
  Effect.map(Sqlite, (db) => {
    const now = () => new Date().toISOString()

    const payload = (value: string | undefined): unknown =>
      value === undefined ? undefined : (JSON.parse(value) as unknown)

    return DatabaseService.of({
      bookmarks: {
        add: (imdbId, type) =>
          tryDb('bookmarks.add', () => {
            db.prepare('INSERT OR REPLACE INTO bookmarks (imdb_id, type) VALUES (?, ?)').run(
              imdbId,
              type,
            )
          }),
        remove: (imdbId) =>
          tryDb('bookmarks.remove', () => {
            db.prepare('DELETE FROM bookmarks WHERE imdb_id = ?').run(imdbId)
          }),
        list: (type) =>
          tryDb('bookmarks.list', () => {
            const rows =
              type === undefined
                ? db.prepare('SELECT imdb_id, type FROM bookmarks ORDER BY imdb_id').all()
                : db
                    .prepare('SELECT imdb_id, type FROM bookmarks WHERE type = ? ORDER BY imdb_id')
                    .all(type)
            return (rows as Array<{ imdb_id: string; type: string }>).map((row) => ({
              imdbId: row.imdb_id,
              type: row.type,
            }))
          }),
      },
      watched: {
        markMovie: (imdbId) =>
          tryDb('watched.markMovie', () => {
            db.prepare(
              'INSERT OR REPLACE INTO watched_movies (imdb_id, watched_at) VALUES (?, ?)',
            ).run(imdbId, now())
          }),
        unmarkMovie: (imdbId) =>
          tryDb('watched.unmarkMovie', () => {
            db.prepare('DELETE FROM watched_movies WHERE imdb_id = ?').run(imdbId)
          }),
        markEpisode: (episode) =>
          tryDb('watched.markEpisode', () => {
            db.prepare(
              `INSERT OR REPLACE INTO watched_episodes (tvdb_id, imdb_id, season, episode, watched_at)
               VALUES (?, ?, ?, ?, ?)`,
            ).run(episode.tvdbId, episode.imdbId, episode.season, episode.episode, now())
          }),
        unmarkEpisode: (episode) =>
          tryDb('watched.unmarkEpisode', () => {
            db.prepare(
              'DELETE FROM watched_episodes WHERE tvdb_id = ? AND season = ? AND episode = ?',
            ).run(episode.tvdbId, episode.season, episode.episode)
          }),
        isEpisodeWatched: (episode) =>
          tryDb('watched.isEpisodeWatched', () => {
            const row = db
              .prepare(
                'SELECT 1 FROM watched_episodes WHERE tvdb_id = ? AND season = ? AND episode = ?',
              )
              .get(episode.tvdbId, episode.season, episode.episode)
            return row !== undefined
          }),
        movies: tryDb('watched.movies', () => {
          const rows = db.prepare('SELECT imdb_id FROM watched_movies ORDER BY imdb_id').all()
          return (rows as Array<{ imdb_id: string }>).map((row) => row.imdb_id)
        }),
        episodesFor: (tvdbId) =>
          tryDb('watched.episodesFor', () => {
            const rows =
              tvdbId === undefined
                ? db
                    .prepare('SELECT * FROM watched_episodes ORDER BY tvdb_id, season, episode')
                    .all()
                : db
                    .prepare(
                      'SELECT * FROM watched_episodes WHERE tvdb_id = ? ORDER BY season, episode',
                    )
                    .all(tvdbId)
            return (
              rows as Array<{
                tvdb_id: string
                imdb_id: string
                season: string
                episode: string
                watched_at: string
              }>
            ).map((row) => ({
              tvdbId: row.tvdb_id,
              imdbId: row.imdb_id,
              season: row.season,
              episode: row.episode,
              watchedAt: row.watched_at,
            }))
          }),
      },
      meta: {
        get: (key) =>
          tryDb('meta.get', () => {
            const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
              | { value: string }
              | undefined
            return payload(row?.value)
          }),
        set: (key, value) =>
          tryDb('meta.set', () => {
            db.prepare(
              'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            ).run(key, JSON.stringify(value))
          }),
      },
      collection: {
        list: tryDb('collection.list', () => {
          const rows = db
            .prepare(
              'SELECT id, name, source, added_at FROM torrent_collection ORDER BY added_at DESC',
            )
            .all()
          return (
            rows as Array<{ id: number; name: string; source: string; added_at: string }>
          ).map((row) => ({
            id: row.id,
            name: row.name,
            source: row.source,
            addedAt: row.added_at,
          }))
        }),
        add: (name, source) =>
          tryDb('collection.add', () => {
            db.prepare(
              'INSERT OR REPLACE INTO torrent_collection (name, source, added_at) VALUES (?, ?, ?)',
            ).run(name, source, now())
          }),
        remove: (id) =>
          tryDb('collection.remove', () => {
            db.prepare('DELETE FROM torrent_collection WHERE id = ?').run(id)
          }),
        rename: (id, name) =>
          tryDb('collection.rename', () => {
            db.prepare('UPDATE torrent_collection SET name = ? WHERE id = ?').run(name, id)
          }),
      },
      media: {
        putMovie: (imdbId, value) =>
          tryDb('media.putMovie', () => {
            db.prepare('INSERT OR REPLACE INTO movies (imdb_id, payload) VALUES (?, ?)').run(
              imdbId,
              JSON.stringify(value),
            )
          }),
        getMovie: (imdbId) =>
          tryDb('media.getMovie', () => {
            const row = db.prepare('SELECT payload FROM movies WHERE imdb_id = ?').get(imdbId) as
              | { payload: string }
              | undefined
            return payload(row?.payload)
          }),
        putShow: (imdbId, tvdbId, value) =>
          tryDb('media.putShow', () => {
            db.prepare(
              'INSERT OR REPLACE INTO shows (imdb_id, tvdb_id, payload) VALUES (?, ?, ?)',
            ).run(imdbId, tvdbId, JSON.stringify(value))
          }),
        getShow: (imdbId) =>
          tryDb('media.getShow', () => {
            const row = db.prepare('SELECT payload FROM shows WHERE imdb_id = ?').get(imdbId) as
              | { payload: string }
              | undefined
            return payload(row?.payload)
          }),
      },
    })
  }),
)

/** Settings persistence failures must surface as SettingsError; DbError is an implementation detail here. */
const asSettingsError =
  (key: string) =>
  (error: DbError): SettingsError =>
    new SettingsError({ message: error.message, key, cause: error })

/** Settings persisted as JSON values keyed by name — the store SettingsService expects. */
export const SqliteSettingsStoreLive = Layer.effect(
  SettingsStore,
  Effect.map(Sqlite, (db) => ({
    read: tryDb('settings.read', () => {
      const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
        key: string
        value: string
      }>
      const values: Record<string, unknown> = {}
      for (const row of rows) {
        try {
          values[row.key] = JSON.parse(row.value) as unknown
        } catch {
          // A corrupt row falls back to its default; the service validates per key.
        }
      }
      return values
    }).pipe(Effect.mapError(asSettingsError('settings'))),
    write: (key: string, value: unknown) =>
      tryDb('settings.write', () => {
        db.prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ).run(key, JSON.stringify(value))
      }).pipe(Effect.mapError(asSettingsError(key))),
  })),
)
