import { cpSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { Effect, Layer } from 'effect'
import { MigrationError } from '../shared/errors'
import { Sqlite } from './database'
import { LegacyMigration } from './legacy-migration'

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

/** The result when migration does not run: no profile found, or it failed and startup recovered. */
export const NOT_MIGRATED: MigrationResult = {
  migrated: false,
  counts: EMPTY_COUNTS,
  malformedLines: 0,
  skipped: [],
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
 * Keys the runtime derives from the environment, so a stale legacy row must never win over
 * the current value. Migration drops each of these instead of importing them:
 * `version`, `os`, `arch`, `releaseName`, `tmpLocation`, `databaseLocation`, `ipAddress`.
 */
const RUNTIME_KEYS: ReadonlySet<string> = new Set([
  'version',
  'os',
  'arch',
  'releaseName',
  'tmpLocation',
  'databaseLocation',
  'ipAddress',
])

/**
 * Synchronous migration body. It throws `MigrationError`; `migrateLegacy` turns that into an
 * Effect failure so a defect can never reject startup.
 */
function runMigration(
  db: SqliteDatabase,
  legacyRoot: string,
  options: MigrationOptions,
): MigrationResult {
  if (isMigrated(db)) {
    return { migrated: false, counts: EMPTY_COUNTS, malformedLines: 0, skipped: [] }
  }

  const dataDir = join(legacyRoot, 'data')

  if (options.backupDir !== undefined && existsSync(dataDir)) {
    try {
      cpSync(dataDir, options.backupDir, { recursive: true })
    } catch (cause) {
      throw new MigrationError({
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
    const insertMeta = db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)')
    for (const record of settings.records) {
      const key = text(record.key)
      if (key === undefined || record.value === undefined) continue
      // Runtime-derived keys are dropped rather than imported (see RUNTIME_KEYS).
      if (RUNTIME_KEYS.has(key)) continue
      insertSetting.run(key, JSON.stringify(record.value))
      // The port reads the disclaimer from `meta`, not settings; carry the legacy acceptance
      // over so a migrated profile does not see it again.
      if (key === 'disclaimerAccepted' && (record.value === true || record.value === 1)) {
        insertMeta.run('disclaimerAccepted', JSON.stringify(true))
      }
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
    throw new MigrationError({
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

/**
 * Runs the migration as an `Effect`: failures are the tagged `MigrationError`, never a
 * defect that could reject startup.
 */
export function migrateLegacy(
  db: SqliteDatabase,
  legacyRoot: string,
  options: MigrationOptions = {},
): Effect.Effect<MigrationResult, MigrationError> {
  return Effect.try({
    try: () => runMigration(db, legacyRoot, options),
    catch: (cause) =>
      cause instanceof MigrationError
        ? cause
        : new MigrationError({
            message: 'legacy migration failed; legacy data is untouched',
            operation: 'migrate',
            cause,
          }),
  })
}

export interface LegacyMigrationLayerOptions {
  /** The resolved NW.js profile, or undefined when none was found. */
  readonly legacyRoot: string | undefined
  readonly backupDir?: string
  /** Called when the migration fails; startup continues with an empty database. */
  readonly onError?: (error: MigrationError) => void
}

/**
 * The migration as a Layer that Settings depends on: building the layer runs it (once, guarded
 * by the marker in `meta`) before any settings are read. A failure is reported and swallowed so
 * startup never depends on a readable legacy profile.
 */
export const LegacyMigrationLive = (options: LegacyMigrationLayerOptions) =>
  Layer.effect(
    LegacyMigration,
    Effect.gen(function* () {
      const db = yield* Sqlite
      if (options.legacyRoot === undefined) {
        return LegacyMigration.of({ result: NOT_MIGRATED })
      }
      const result = yield* migrateLegacy(db, options.legacyRoot, {
        ...(options.backupDir === undefined ? {} : { backupDir: options.backupDir }),
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            options.onError?.(error)
            return NOT_MIGRATED
          }),
        ),
      )
      return LegacyMigration.of({ result })
    }),
  )
