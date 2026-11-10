import { Context } from 'effect'
import type { MigrationResult } from './migration'

/**
 * Marks that the one-time legacy migration has run. It exists as a leaf module so `Settings`
 * can depend on the tag without importing the migration implementation (which imports the
 * database, which imports `Settings` — a cycle).
 */
export interface LegacyMigrationShape {
  readonly result: MigrationResult
}

export class LegacyMigration extends Context.Tag('LegacyMigration')<
  LegacyMigration,
  LegacyMigrationShape
>() {}
