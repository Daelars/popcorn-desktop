import { cpSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { DbError } from '../shared/errors'

const MIGRATION_MARKER = 'legacy_migration'

export interface MigrationCounts {
  readonly bookmarks: number
  readonly watchedMovies: number
  readonly watchedEpisodes: number
  readonly settings: number
  readonly movies: number
  readonly shows: number
}

export interface MigrationResult {
  readonly migrated: boolean
  readonly counts: MigrationCounts
  readonly malformedLines: number
  readonly skipped: ReadonlyArray<string>
}

export interface MigrationOptions {
  /** Where the legacy data directory is copied before anything is written. */
  readonly backupDir?: string
}

const EMPTY_COUNTS: MigrationCounts = {
  bookmarks: 0,
  watchedMovies: 0,
  watchedEpisodes: 0,
  settings: 0,
  movies: 0,
  shows: 0,
}

const LEGACY_APP_NAME = 'Popcorn-Time'

/**
 * NW.js stores its profile in the platform's application-data root, but the exact
 * subdirectory moved across 0.5.x builds. Candidates, most specific first:
 *
 * - Windows: `%LOCALAPPDATA%\Popcorn-Time\{User Data\Default, User\Default}`,
 *   verified on a real 0.5.1 profile, then the bare app directory.
 * - macOS: `~/Library/Application Support/Popcorn-Time/{Default, User Data/Default}`.
 * - Linux: `~/.config/Popcorn-Time/{Default, User Data/Default}`.
 *
 * The bare app directory is the path `nw.App.dataPath` returns per the NW.js docs.
 * The legacy NeDB files live in `<profile>/data`.
 */
export function legacyProfileCandidates(
  appDataRoot: string,
  platform: NodeJS.Platform,
): ReadonlyArray<string> {
  const base = join(appDataRoot, LEGACY_APP_NAME)
  const nested =
    platform === 'win32'
      ? [join(base, 'User Data', 'Default'), join(base, 'User', 'Default')]
      : [join(base, 'Default'), join(base, 'User Data', 'Default')]
  return [...nested, base]
}

export interface LegacyRootResolution {
  /** The first candidate holding a `data/` directory, or undefined if none do. */
  readonly root: string | undefined
  /** Every candidate checked, in order, so the caller can log them. */
  readonly checked: ReadonlyArray<string>
}

/**
 * Finds the NW.js profile that actually contains the legacy NeDB database.
 * `exists` is injectable so tests don't touch the filesystem.
 */
export function resolveLegacyProfileRoot(
  appDataRoot: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): LegacyRootResolution {
  const checked = legacyProfileCandidates(appDataRoot, platform)
  for (const candidate of checked) {
    if (exists(join(candidate, 'data'))) return { root: candidate, checked }
  }
  return { root: undefined, checked }
}

/**
 * NeDB files are JSON-lines. Corrupt lines are counted and skipped rather than
 * aborting the migration — a half-written legacy file must not lose the rest.
 */
export function parseNedbFile(file: string): {
  records: ReadonlyArray<Record<string, unknown>>
  malformed: number
} {
  if (!existsSync(file)) return { records: [], malformed: 0 }
  const records: Array<Record<string, unknown>> = []
  let malformed = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        records.push(parsed as Record<string, unknown>)
      } else {
        malformed += 1
      }
    } catch {
      malformed += 1
    }
  }
  return { records, malformed }
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function isMigrated(db: SqliteDatabase): boolean {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(MIGRATION_MARKER)
  return row !== undefined
}

/**
 * Moves a legacy profile (NeDB files under `<data_path>/data`) into SQLite. Runs once,
 * records its marker in the same transaction, and never writes to the legacy files.
 */
export function migrateLegacy(
  db: SqliteDatabase,
  legacyRoot: string,
  options: MigrationOptions = {},
): MigrationResult {
  if (isMigrated(db)) {
    return { migrated: false, counts: EMPTY_COUNTS, malformedLines: 0, skipped: [] }
  }

  const dataDir = join(legacyRoot, 'data')

  if (options.backupDir !== undefined && existsSync(dataDir)) {
    try {
      cpSync(dataDir, options.backupDir, { recursive: true })
    } catch (cause) {
      throw new DbError({
        message: `could not back up legacy data to ${options.backupDir}; migration aborted`,
        operation: 'migrate.backup',
        cause,
      })
    }
  }

  const bookmarks = parseNedbFile(join(dataDir, 'bookmarks.db'))
  const watched = parseNedbFile(join(dataDir, 'watched.db'))
  const settings = parseNedbFile(join(dataDir, 'settings.db'))
  const movies = parseNedbFile(join(dataDir, 'movies.db'))
  const shows = parseNedbFile(join(dataDir, 'shows.db'))
  const malformedLines =
    bookmarks.malformed +
    watched.malformed +
    settings.malformed +
    movies.malformed +
    shows.malformed

  const counts: {
    bookmarks: number
    watchedMovies: number
    watchedEpisodes: number
    settings: number
    movies: number
    shows: number
  } = { ...EMPTY_COUNTS }

  const migrate = db.transaction(() => {
    const insertBookmark = db.prepare(
      'INSERT OR IGNORE INTO bookmarks (imdb_id, type) VALUES (?, ?)',
    )
    for (const record of bookmarks.records) {
      const imdbId = text(record.imdb_id)
      if (imdbId === undefined) continue
      insertBookmark.run(imdbId, text(record.type) ?? 'movie')
      counts.bookmarks += 1
    }

    const insertMovie = db.prepare(
      'INSERT OR IGNORE INTO watched_movies (imdb_id, watched_at) VALUES (?, ?)',
    )
    const insertEpisode = db.prepare(
      'INSERT OR IGNORE INTO watched_episodes (tvdb_id, imdb_id, season, episode, watched_at) VALUES (?, ?, ?, ?, ?)',
    )
    for (const record of watched.records) {
      const watchedAt = text(record.date) ?? new Date(0).toISOString()
      if (text(record.type) === 'episode' || record.tvdb_id !== undefined) {
        const tvdbId = text(record.tvdb_id)
        const imdbId = text(record.imdb_id)
        const season = text(record.season)
        const episode = text(record.episode)
        if (
          tvdbId === undefined ||
          imdbId === undefined ||
          season === undefined ||
          episode === undefined
        )
          continue
        insertEpisode.run(tvdbId, imdbId, season, episode, watchedAt)
        counts.watchedEpisodes += 1
      } else {
        const movieId = text(record.movie_id) ?? text(record.imdb_id)
        if (movieId === undefined) continue
        insertMovie.run(movieId, watchedAt)
        counts.watchedMovies += 1
      }
    }

    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    for (const record of settings.records) {
      const key = text(record.key)
      if (key === undefined || record.value === undefined) continue
      insertSetting.run(key, JSON.stringify(record.value))
      counts.settings += 1
    }

    const insertCachedMovie = db.prepare(
      'INSERT OR IGNORE INTO movies (imdb_id, payload) VALUES (?, ?)',
    )
    for (const record of movies.records) {
      const imdbId = text(record.imdb_id)
      if (imdbId === undefined) continue
      insertCachedMovie.run(imdbId, JSON.stringify(record))
      counts.movies += 1
    }

    const insertCachedShow = db.prepare(
      'INSERT OR IGNORE INTO shows (imdb_id, tvdb_id, payload) VALUES (?, ?, ?)',
    )
    for (const record of shows.records) {
      const imdbId = text(record.imdb_id)
      if (imdbId === undefined) continue
      insertCachedShow.run(imdbId, text(record.tvdb_id) ?? null, JSON.stringify(record))
      counts.shows += 1
    }

    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
      MIGRATION_MARKER,
      new Date().toISOString(),
    )
  })

  try {
    migrate()
  } catch (cause) {
    throw new DbError({
      message: 'legacy migration failed; legacy data is untouched',
      operation: 'migrate',
      cause,
    })
  }

  const skipped: string[] = []
  if (existsSync(join(legacyRoot, 'Local Storage'))) {
    skipped.push('Local Storage (LevelDB): window geometry and regenerable caches only')
  }

  return { migrated: true, counts, malformedLines, skipped }
}
