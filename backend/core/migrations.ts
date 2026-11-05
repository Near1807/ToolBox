// Migration runner, PC entry point: the portable runner (./migrations-core.ts,
// also used by the phone) with the Node functions it takes from its platform.
import { randomUUID } from 'node:crypto';
import type { Migration } from '../../packages/sdk/backend';
import type { SqliteDatabase } from './database';
import { legacyUuid } from './legacy-id';
import { applyMigrations as applyWith } from './migrations-core';

export {
  assertNotSchemaChange,
  ensureMigrationsTable,
  findForeignSchemaChanges,
  getAppliedVersion,
  getPendingMigrations,
  MigrationError,
  prefixedTable,
  tablePrefix,
  validateMigrationList,
} from './migrations-core';

/** The PC's runtime: Node's random UUID and the sha256-based legacy ids. */
const NODE_RUNTIME = { randomId: () => randomUUID(), legacyUuid };

/**
 * Applies the given (pending) migrations, each in its own transaction.
 * A migration may only create, change or drop objects named with the scope's prefix.
 * Throws MigrationError on the first failure (that migration is rolled back).
 */
export function applyMigrations(db: SqliteDatabase, scope: string, pending: Migration[]): void {
  applyWith(db, scope, pending, NODE_RUNTIME);
}
