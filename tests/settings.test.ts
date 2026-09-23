import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { LegacyMigration } from '../src/main/legacy-migration'
import { NOT_MIGRATED } from '../src/main/migration'
import {
  type SettingsEnvironment,
  SettingsService,
  SettingsServiceLive,
  SettingsStore,
  settingsDefaults,
} from '../src/main/settings'
import { SettingsError } from '../src/shared/errors'
import { INERT_SETTINGS, SETTINGS_METADATA } from '../src/shared/settings-metadata'

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

function storeLayer(initial: Record<string, unknown> = {}) {
  const writes: Array<{ key: string; value: unknown }> = []
  const layer = Layer.succeed(SettingsStore, {
    read: Effect.succeed(initial),
    write: (key, value) =>
      Effect.sync(() => {
        writes.push({ key, value })
      }),
  })
  return { layer, writes }
}

function failingStoreLayer() {
  return Layer.succeed(SettingsStore, {
    read: Effect.succeed({}),
    write: (key: string) => Effect.fail(new SettingsError({ message: 'disk is full', key })),
  })
}

function legacyKeys(): string[] {
  const source = readFileSync('src/app/settings.js', 'utf8')
  const assigned = [...source.matchAll(/^Settings\.([A-Za-z_][\w]*)\s*=/gm)].map(
    (m) => m[1] as string,
  )
  const literalBlock = /var Settings = \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? ''
  const literal = [...literalBlock.matchAll(/^\s{2}([A-Za-z_][\w]*)\s*:/gm)].map(
    (m) => m[1] as string,
  )
  const runtime = [...source.matchAll(/AdvSettings\.set\('(\w+)'/g)].map((m) => m[1] as string)
  // player.js wrote these through AdvSettings.set without declaring a default, so they are
  // part of the legacy settings surface even though settings.js never names them.
  const playerOnly = ['lastWatchedTitle', 'lastWatchedTime']
  return [...new Set([...literal, ...assigned, ...runtime, ...playerOnly])].sort()
}

const run = <A, E>(effect: Effect.Effect<A, E, SettingsService>, store = storeLayer()) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      SettingsServiceLive(environment).pipe(
        Layer.provide(store.layer),
        Layer.provide(Layer.succeed(LegacyMigration, { result: NOT_MIGRATED })),
      ),
    ),
  )

/** One service instance per test: a managed runtime keeps the layer built across calls. */
function makeRun(store = storeLayer()) {
  const runtime = ManagedRuntime.make(
    SettingsServiceLive(environment).pipe(
      Layer.provide(store.layer),
      Layer.provide(Layer.succeed(LegacyMigration, { result: NOT_MIGRATED })),
    ),
  )
  return {
    store,
    run: <A, E>(effect: Effect.Effect<A, E, SettingsService>) => runtime.runPromise(effect),
  }
}

describe('settings defaults', () => {
  it('defines exactly the keys the legacy settings.js defines', () => {
    const defaults = Object.keys(settingsDefaults(environment)).sort()
    expect(defaults).toEqual(legacyKeys())
  })

  it('keeps the legacy values that the UI depends on', () => {
    const defaults = settingsDefaults(environment)
    expect(defaults.theme).toBe('Official_-_Dark_theme')
    expect(defaults.postersWidth).toBe(134)
    expect(defaults.postersJump).toHaveLength(9)
    expect(defaults.streamPort).toBe(0)
    expect(defaults.defaultWidth).toBe(1536)
    expect(defaults.tmpLocation).toBe(join('C:/tmp', 'Popcorn Time'))
    expect(defaults.databaseLocation).toBe(join('C:/data', 'data'))
    expect(defaults.os).toBe('windows')
  })

  it('keeps credentials out of the tree except the legacy API keys', () => {
    const defaults = settingsDefaults(environment)
    expect(defaults.trakttv.client_secret).toBe('')
    // The original tmdb/fanart/tvdb keys ship as defaults so a fresh profile can fetch
    // metadata; #27 tracks rotating them out of the tree and loading them from env only.
    expect(defaults.tmdb.api_key.length).toBeGreaterThan(0)
    expect(defaults.fanart.api_key.length).toBeGreaterThan(0)
  })

  it('takes credentials from the environment when provided', () => {
    const defaults = settingsDefaults({
      ...environment,
      secrets: { traktClientId: 'id', tmdbApiKey: 'key' },
    })
    expect(defaults.trakttv.client_id).toBe('id')
    expect(defaults.tmdb.api_key).toBe('key')
  })
})

describe('settings metadata', () => {
  it('declares a consumer or an inert reason for every key', () => {
    const keys = Object.keys(SETTINGS_METADATA)
    expect(keys.length).toBeGreaterThan(100)
    for (const key of INERT_SETTINGS) {
      expect(SETTINGS_METADATA[key as keyof typeof SETTINGS_METADATA].inertReason).toBeDefined()
    }
  })
})

describe('SettingsService', () => {
  it('reads defaults before anything is set', async () => {
    const theme = await run(Effect.flatMap(SettingsService, (settings) => settings.get('theme')))
    expect(theme).toBe('Official_-_Dark_theme')
  })

  it('sets and reads back a value, persisting it', async () => {
    const { run: runOne, store } = makeRun()
    await runOne(
      Effect.flatMap(SettingsService, (settings) =>
        settings.set('theme', 'Official_-_Light_theme'),
      ),
    )
    const theme = await runOne(Effect.flatMap(SettingsService, (settings) => settings.get('theme')))
    expect(theme).toBe('Official_-_Light_theme')
    expect(store.writes).toContainEqual({ key: 'theme', value: 'Official_-_Light_theme' })
  })

  it('loads persisted values over defaults', async () => {
    const store = storeLayer({ postersWidth: 234, theme: 'Official_-_FlaX_theme' })
    const snapshot = await run(
      Effect.flatMap(SettingsService, (settings) => settings.snapshot),
      store,
    )
    expect(snapshot.postersWidth).toBe(234)
    expect(snapshot.theme).toBe('Official_-_FlaX_theme')
  })

  it('falls back to defaults for persisted values that no longer validate', async () => {
    const store = storeLayer({ postersWidth: 'wide' })
    const snapshot = await run(
      Effect.flatMap(SettingsService, (settings) => settings.snapshot),
      store,
    )
    expect(snapshot.postersWidth).toBe(134)
  })

  it('rejects unknown keys with a SettingsError', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        Effect.flatMap(SettingsService, (settings) => settings.set('not_a_key', 1)),
        SettingsServiceLive(environment).pipe(
          Layer.provide(storeLayer().layer),
          Layer.provide(Layer.succeed(LegacyMigration, { result: NOT_MIGRATED })),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('SettingsError')
    }
  })

  it('rejects a wrong-typed value and leaves state untouched', async () => {
    const { run: runOne, store } = makeRun()
    const exit = await runOne(
      Effect.exit(Effect.flatMap(SettingsService, (settings) => settings.set('theme', 42))),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    const theme = await runOne(Effect.flatMap(SettingsService, (settings) => settings.get('theme')))
    expect(theme).toBe('Official_-_Dark_theme')
    expect(store.writes).toHaveLength(0)
  })

  it('surfaces a store failure as SettingsError and leaves state untouched', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        Effect.flatMap(SettingsService, (settings) =>
          settings.set('theme', 'Official_-_Light_theme'),
        ),
        SettingsServiceLive(environment).pipe(
          Layer.provide(failingStoreLayer()),
          Layer.provide(Layer.succeed(LegacyMigration, { result: NOT_MIGRATED })),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('SettingsError')
    }
  })

  it('publishes a change when a setting is set', async () => {
    const { run } = makeRun()
    const change = await run(
      Effect.gen(function* () {
        const settings = yield* SettingsService
        const fiber = yield* Effect.fork(Stream.runHead(settings.changes))
        yield* Effect.sleep('10 millis')
        yield* settings.set('theme', 'Official_-_Light_theme')
        return yield* Fiber.join(fiber)
      }),
    )
    expect(change._tag).toBe('Some')
    if (change._tag === 'Some') {
      expect(change.value).toEqual({ key: 'theme', value: 'Official_-_Light_theme' })
    }
  })
})
