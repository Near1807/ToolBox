import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseHandle, SqliteDatabase } from './database';

/** Number of automatic backups kept in <userData>/backups/. */
export const MAX_AUTOMATIC_BACKUPS = 10;
const AUTOMATIC_PREFIX = 'hub-';

export interface BackupInfo {
  file: string;
  name: string;
  size: number;
  createdAt: string;
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** Writes a consistent, compacted copy of the database to `target`. */
export function snapshotDatabase(db: SqliteDatabase, target: string): void {
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { force: true });
  db.prepare('VACUUM INTO ?').run(target);
}

/**
 * Automatic backup taken before migrations: <backupsDir>/hub-<timestamp>-<reason>.db.
 * Keeps the MAX_AUTOMATIC_BACKUPS most recent ones.
 */
export function createAutomaticBackup(
  db: SqliteDatabase,
  backupsDir: string,
  reason: string,
  now = new Date(),
): string {
  const safeReason = reason.replace(/[^a-z0-9-]+/gi, '-').slice(0, 60);
  const file = path.join(backupsDir, `${AUTOMATIC_PREFIX}${timestamp(now)}-${safeReason}.db`);
  snapshotDatabase(db, file);
  pruneAutomaticBackups(backupsDir);
  return file;
}

export function listAutomaticBackups(backupsDir: string): BackupInfo[] {
  let names: string[];
  try {
    names = readdirSync(backupsDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith(AUTOMATIC_PREFIX) && name.endsWith('.db'))
    .map((name) => {
      const file = path.join(backupsDir, name);
      const stats = statSync(file);
      return { file, name, size: stats.size, createdAt: stats.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function pruneAutomaticBackups(backupsDir: string, keep = MAX_AUTOMATIC_BACKUPS): void {
  for (const backup of listAutomaticBackups(backupsDir).slice(keep)) {
    rmSync(backup.file, { force: true });
  }
}

/** Replaces the live database with a backup (connection closed and reopened). */
export function restoreBackup(handle: DatabaseHandle, backupFile: string): void {
  handle.reopenAfter(() => {
    for (const suffix of ['-wal', '-shm']) rmSync(handle.file + suffix, { force: true });
    copyFileSync(backupFile, handle.file);
  });
}
