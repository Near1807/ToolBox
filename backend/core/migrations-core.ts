// Migration runner, PORTABLE part (ADR 0044): no Node import, so that the
// phone runs the modules' migrations with exactly the same code as the PC.
// The PC entry point is ./migrations.ts (which gives the Node functions).
import type { Migration, MigrationDatabase } from '../../packages/sdk/core';

/**
 * What the runner needs of a SQLite connection: better-sqlite3 on the PC,
 * the sqlite-wasm adapter on the phone (packages/phone/database.ts).
 */
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  /** Wraps fn in a transaction (nested: a savepoint), like better-sqlite3. */
  transaction(fn: () => void): () => void;
}

/** The functions the runner takes from its platform. */
export interface MigrationRuntime {
  /** A random UUID (the installation's id). */
  randomId(): string;
  /** The UUID of a row that had a number before (see backend/core/legacy-id.ts). */
  legacyUuid(seed: string, kind: string, oldId: number): string;
}

const MIGRATIONS_TABLE = 'core__migrations';
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

/** "music-library" → "music_library__". Module ids only use [a-z0-9-], so this is unique. */
export function tablePrefix(scope: string): string {
  return `${scope.replace(/-/g, '_')}__`;
}

export function prefixedTable(scope: string, name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`Nom de table invalide « ${name} » (minuscules, chiffres et _ uniquement)`);
  }
  return tablePrefix(scope) + name;
}

export class MigrationError extends Error {
  constructor(
    readonly scope: string,
    readonly version: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function ensureMigrationsTable(db: SqliteDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    scope TEXT NOT NULL,
    version INTEGER NOT NULL,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    PRIMARY KEY (scope, version)
  )`);
}

export function getAppliedVersion(db: SqliteDatabase, scope: string): number {
  const row = db
    .prepare(`SELECT MAX(version) AS version FROM ${MIGRATIONS_TABLE} WHERE scope = ?`)
    .get(scope) as { version: number | null };
  return row.version ?? 0;
}

/** Versions must be 1, 2, 3… in order. */
export function validateMigrationList(scope: string, migrations: Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError(
        scope,
        migration.version,
        `Migrations de « ${scope} » mal numérotées : attendu ${index + 1}, trouvé ${migration.version}`,
      );
    }
  });
}

export function getPendingMigrations(
  db: SqliteDatabase,
  scope: string,
  migrations: Migration[],
): Migration[] {
  validateMigrationList(scope, migrations);
  const applied = getAppliedVersion(db, scope);
  if (applied > migrations.length) {
    throw new MigrationError(
      scope,
      applied,
      `La base contient la version ${applied} du schéma de « ${scope} », mais ce module ne connaît que ` +
        `${migrations.length} migration(s). Une version plus récente de l'app a utilisé ces données : ` +
        `module désactivé pour les protéger.`,
    );
  }
  return migrations.slice(applied);
}

type SchemaSnapshot = Map<string, string>;

function snapshotSchema(db: SqliteDatabase): SchemaSnapshot {
  const rows = db
    .prepare(
      "SELECT type, name, IFNULL(sql, '') AS sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
    )
    .all() as { type: string; name: string; sql: string }[];
  return new Map(rows.map((row) => [`${row.type}:${row.name}`, row.sql]));
}

/** Lists schema objects a migration created, changed or dropped outside its prefix. */
export function findForeignSchemaChanges(
  before: SchemaSnapshot,
  after: SchemaSnapshot,
  prefix: string,
): string[] {
  const touched = new Set<string>();
  for (const [key, sql] of after) if (before.get(key) !== sql) touched.add(key);
  for (const key of before.keys()) if (!after.has(key)) touched.add(key);
  return [...touched]
    .map((key) => key.slice(key.indexOf(':') + 1))
    .filter((name) => !name.startsWith(prefix));
}

/**
 * The installation's id (`core__meta`), created the first time a migration
 * needs it, in the same transaction (rolled back with it on failure).
 */
function installationSeed(db: SqliteDatabase, runtime: MigrationRuntime): string {
  const row = db.prepare("SELECT value FROM core__meta WHERE key = 'installation'").get() as
    { value: string } | undefined;
  if (row) return row.value;
  const value = runtime.randomId();
  db.prepare("INSERT INTO core__meta (key, value) VALUES ('installation', ?)").run(value);
  return value;
}

function migrationDatabase(
  db: SqliteDatabase,
  scope: string,
  runtime: MigrationRuntime,
): MigrationDatabase {
  let seed: string | null = null;
  return {
    exec: (sql) => void db.exec(sql),
    prepare: (sql) => db.prepare(sql) as ReturnType<MigrationDatabase['prepare']>,
    table: (name) => prefixedTable(scope, name),
    legacyId: (kind, oldId) =>
      runtime.legacyUuid((seed ??= installationSeed(db, runtime)), kind, oldId),
  };
}

/**
 * Applies the given (pending) migrations, each in its own transaction.
 * A migration may only create, change or drop objects named with the scope's prefix.
 * Throws MigrationError on the first failure (that migration is rolled back).
 */
export function applyMigrations(
  db: SqliteDatabase,
  scope: string,
  pending: Migration[],
  runtime: MigrationRuntime,
): void {
  const prefix = tablePrefix(scope);
  const record = db.prepare(
    `INSERT INTO ${MIGRATIONS_TABLE} (scope, version, description, applied_at) VALUES (?, ?, ?, ?)`,
  );

  for (const migration of pending) {
    try {
      db.transaction(() => {
        const before = snapshotSchema(db);
        if (typeof migration.up === 'string') db.exec(migration.up);
        else migration.up(migrationDatabase(db, scope, runtime));
        const foreign = findForeignSchemaChanges(before, snapshotSchema(db), prefix);
        if (foreign.length > 0) {
          throw new Error(
            `elle modifie des objets hors de son préfixe « ${prefix} » : ${foreign.join(', ')}`,
          );
        }
        record.run(scope, migration.version, migration.description, new Date().toISOString());
      })();
    } catch (error) {
      if (error instanceof MigrationError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new MigrationError(
        scope,
        migration.version,
        `La migration ${migration.version} (« ${migration.description} ») de « ${scope} » a échoué : ${reason}`,
      );
    }
  }
}

/** Refuses schema changes outside migrations (CREATE / ALTER / DROP …). */
export function assertNotSchemaChange(sql: string): void {
  const statement = sql.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '');
  if (/^(CREATE|ALTER|DROP)\b/i.test(statement)) {
    throw new Error(
      'Les changements de schéma (CREATE, ALTER, DROP) passent obligatoirement par une migration',
    );
  }
}
