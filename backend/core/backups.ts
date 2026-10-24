import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseHandle, SqliteDatabase } from './database';

/**
 * Automatic backups in <userData>/backups/, two separate rotations so that a
 * series of deletions never pushes out the backups taken before migrations:
 * - « migration »: before each database migration (hub-<timestamp>-avant-<scope>-v<N>.db);
 * - « module »: requested by a module before deleting data (ctx.db.backup,
 *   hub-<timestamp>-<module>-<reason>.db).
 */
export type BackupKind = 'migration' | 'module';
export const KEPT_BACKUPS: Record<BackupKind, number> = { migration: 10, module: 10 };
const AUTOMATIC_PREFIX = 'hub-';
const MIGRATION_NAME = /^hub-[0-9T-]+Z-avant-.+-v\d+\.db$/;

/** Which rotation a backup file belongs to (from its name, also for older files). */
export function backupKind(name: string): BackupKind {
  return MIGRATION_NAME.test(name) ? 'migration' : 'module';
}

export interface BackupInfo {
  file: string;
  name: string;
  kind: BackupKind;
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
 * Automatic backup: <backupsDir>/hub-<timestamp>-<reason>.db. `kind` says
 * which rotation it joins; only that one is pruned (KEPT_BACKUPS most recent).
 */
export function createAutomaticBackup(
  db: SqliteDatabase,
  backupsDir: string,
  reason: string,
  kind: BackupKind,
  now = new Date(),
): string {
  const safeReason = reason.replace(/[^a-z0-9-]+/gi, '-').slice(0, 60);
  const file = path.join(backupsDir, `${AUTOMATIC_PREFIX}${timestamp(now)}-${safeReason}.db`);
  snapshotDatabase(db, file);
  pruneAutomaticBackups(backupsDir, kind);
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
      return {
        file,
        name,
        kind: backupKind(name),
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function pruneAutomaticBackups(
  backupsDir: string,
  kind: BackupKind,
  keep = KEPT_BACKUPS[kind],
): void {
  const ofKind = listAutomaticBackups(backupsDir).filter((backup) => backup.kind === kind);
  for (const backup of ofKind.slice(keep)) rmSync(backup.file, { force: true });
}

/** Replaces the live database with a backup (connection closed and reopened). */
export function restoreBackup(handle: DatabaseHandle, backupFile: string): void {
  handle.reopenAfter(() => {
    for (const suffix of ['-wal', '-shm']) rmSync(handle.file + suffix, { force: true });
    copyFileSync(backupFile, handle.file);
  });
}
