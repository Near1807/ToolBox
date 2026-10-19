import { existsSync } from 'node:fs';
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

/**
 * Holds the open connection. The connection may be replaced once, at startup,
 * when a failed migration restores a backup: everything must read `.db` through
 * the handle instead of keeping its own reference.
 */
export class DatabaseHandle {
  private current: SqliteDatabase;
  /** True when hub.db did not exist before this run (nothing to back up yet). */
  readonly createdNow: boolean;

  constructor(readonly file: string) {
    this.createdNow = !existsSync(file);
    this.current = openDatabase(file);
  }

  get db(): SqliteDatabase {
    return this.current;
  }

  /** Closes the connection, lets `replace` swap the file, then reopens it. */
  reopenAfter(replace: () => void): void {
    this.current.close();
    replace();
    this.current = openDatabase(this.file);
  }

  close(): void {
    if (this.current.open) this.current.close();
  }
}
