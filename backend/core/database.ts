import Database from 'better-sqlite3';

export type SqliteDatabase = Database.Database;

/** Opens (or creates) the hub database with sane defaults. */
export function openDatabase(file: string): SqliteDatabase {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function getSqliteVersion(db: SqliteDatabase): string {
  const row = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
  return row.version;
}
