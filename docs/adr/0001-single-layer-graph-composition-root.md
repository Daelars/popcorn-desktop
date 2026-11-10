# ADR-0001: Startup order is expressed only as Layer dependencies

## Status

Accepted.

## Context

The port moved the main process to Effect services, but the composition root in `src/main/index.ts`
still sequenced startup with imperative code: build a throwaway runtime to read settings, then
build the torrent engine from that snapshot, then read settings again, then run migration. Two
user-visible bugs came from that ordering — settings were read before migration, so migrated values
were ignored on first launch, and a throwing migration surfaced as a defect that rejected startup
instead of a recoverable error.

## Decision

Startup order is expressed only as dependencies in one Layer graph.

- A service that must run after another declares the other's `Context.Tag` in its own effect.
- Services never call each other through ad-hoc runtimes or module-level side effects.
- Failures that startup can recover from are tagged errors on the error channel, handled where the
  Layer is built; they are never defects.
- `Effect.runPromise` appears only at the IPC handler boundary and at the process entry point.

For example, `SettingsService` yields `LegacyMigration` before it reads persisted values, so the
graph guarantees migration runs first regardless of how the root wires the layers.

## Consequences

- The Layer graph is the single description of startup order; reading `index.ts` top to bottom no
  longer explains it.
- A missing dependency is a type error, not a runtime surprise.
- Components read their own inputs from the graph (for example, the torrent engine reads its
  connection settings from `SettingsService`), so no component needs a pre-built snapshot.
