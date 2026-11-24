// v0.47.0 (Expérimental): restore ToolBox from a copy of its database (ADR
// 0063) — an automatic backup, or a copy chosen by Thomas (the Coffre's disk
// keeps one in ToolBox-Coffre/_ToolBox/Base/hub.db).
//   1. Preview (read only): when, the app version that wrote it, its modules
//      and how many elements each has. A base written by a NEWER ToolBox (a
//      migration this app does not know, or a higher app version) is refused.
//   2. Confirmed: the current base is saved first (backups/), the copy is put
//      aside (restore/pending.db) — nothing is replaced while ToolBox runs.
//   3. At the next start, BEFORE the base is opened: the current base moves to
//      restore/before.db, the copy takes its place; the normal migrations bring
//      an older base up to date. Any failure (unreadable, a migration that
//      fails): the base of before comes back by itself, and Réglages says why.
//   4. Synchronisation: each journal's numbering continues after the highest
//      number the phone may have seen (no change of the PC skipped).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createAutomaticBackup } from './backups';
import type { SqliteDatabase } from './database';

const DIR = 'restore';
const SIDE_FILES = ['', '-wal', '-shm'];

export interface RestoreModuleInfo {
  scope: string;
  name: string;
  /** Its last migration in the copy. */
  version: number;
  /** Its rows (not deleted), the journals and the derived tables left out. */
  items: number;
}

export interface RestorePreview {
  file: string;
  size: number;
  /** The file's date (when it was written). */
  modifiedAt: string;
  /** The ToolBox that last opened it (v0.47.0 on; null for an older one). */
  appVersion: string | null;
  modules: RestoreModuleInfo[];
  /** Why it cannot be restored (written by a newer ToolBox, unreadable…), or null. */
  refused: string | null;
}

export interface PendingRestore {
  source: string;
  stagedAt: string;
  /** The automatic backup of the base of before (backups/). */
  backup: string;
  appVersion: string | null;
  /** Each journal's highest number in the base of before (the synchronisation's floor). */
  seqFloors: Record<string, number>;
}

export interface RestoreResult {
  ok: boolean;
  at: string;
  source: string;
  /** Why it was undone (the base of before came back). */
  reason?: string;
}

const dirOf = (dataDir: string) => path.join(dataDir, DIR);
const pendingDb = (dataDir: string) => path.join(dirOf(dataDir), 'pending.db');
const pendingJson = (dataDir: string) => path.join(dirOf(dataDir), 'pending.json');
const beforeDb = (dataDir: string) => path.join(dirOf(dataDir), 'before.db');
const resultJson = (dataDir: string) => path.join(dirOf(dataDir), 'result.json');

/** « 0.46.0 » < « 0.47.0 »: -1, 0, 1. */
export function compareAppVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++)
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  return 0;
}

const isDerived = (name: string) =>
  /__(changes|field_clock)$/.test(name) || /_(data|idx|content|docsize|config)$/.test(name);

/** What a copy holds (read only: opened read only, nothing written). */
export function inspectBackup(
  file: string,
  current: {
    appVersion: string;
    known: ReadonlyMap<string, number>;
    nameOf: (scope: string) => string;
  },
): RestorePreview {
  if (!path.isAbsolute(file) || !existsSync(file)) throw new Error('Fichier introuvable');
  const st = statSync(file);
  const base: Omit<RestorePreview, 'appVersion' | 'modules' | 'refused'> = {
    file,
    size: st.size,
    modifiedAt: st.mtime.toISOString(),
  };
  let db: SqliteDatabase;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch (error) {
    return {
      ...base,
      appVersion: null,
      modules: [],
      refused: `Fichier illisible : ${String(error)}`,
    };
  }
  try {
    const check = db.prepare('PRAGMA quick_check').pluck().get() as string;
    if (check !== 'ok')
      return { ...base, appVersion: null, modules: [], refused: `Base abîmée (${check})` };
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
      sql: string | null;
    }[];
    if (!tables.some((t) => t.name === 'core__migrations'))
      return {
        ...base,
        appVersion: null,
        modules: [],
        refused: 'Ce n’est pas une base de ToolBox',
      };
    const versions = db
      .prepare('SELECT scope, MAX(version) AS v FROM core__migrations GROUP BY scope')
      .all() as { scope: string; v: number }[];
    const appVersion = tables.some((t) => t.name === 'core__meta')
      ? ((db.prepare("SELECT value FROM core__meta WHERE key = 'app_version'").pluck().get() as
          string | undefined) ?? null)
      : null;
    const virtual = new Set(
      tables.filter((t) => /^CREATE VIRTUAL/i.test(t.sql ?? '')).map((t) => t.name),
    );
    const modules: RestoreModuleInfo[] = [];
    for (const { scope, v } of versions) {
      const prefix = `${scope.replace(/-/g, '_')}__`;
      let items = 0;
      if (scope !== 'core')
        for (const t of tables) {
          if (!t.name.startsWith(prefix) || isDerived(t.name) || virtual.has(t.name)) continue;
          if ([...virtual].some((vt) => t.name.startsWith(`${vt}_`))) continue;
          const live = /\bdeleted_at\b/.test(t.sql ?? '') ? ' WHERE deleted_at IS NULL' : '';
          items +=
            (db.prepare(`SELECT COUNT(*) FROM "${t.name}"${live}`).pluck().get() as number) ?? 0;
        }
      modules.push({
        scope,
        name: scope === 'core' ? 'Socle' : current.nameOf(scope),
        version: v,
        items,
      });
    }
    // Written by a newer ToolBox: a migration this one does not know, or a higher version.
    const newer = versions.filter((x) => (current.known.get(x.scope) ?? Infinity) < x.v);
    let refused: string | null = null;
    if (appVersion && compareAppVersions(appVersion, current.appVersion) > 0)
      refused = `Écrite par ToolBox ${appVersion}, plus récent que celui-ci (${current.appVersion}) : mets d’abord ToolBox à jour.`;
    else if (newer.length)
      refused = `Écrite par un ToolBox plus récent (${newer
        .map((x) => `${current.nameOf(x.scope)} v${x.v} > v${current.known.get(x.scope)}`)
        .join(', ')}) : mets d’abord ToolBox à jour.`;
    return {
      ...base,
      appVersion,
      modules: modules.sort((a, b) =>
        a.scope === 'core' ? -1 : b.scope === 'core' ? 1 : a.name.localeCompare(b.name, 'fr'),
      ),
      refused,
    };
  } finally {
    db.close();
  }
}

/** Each journal's highest number (the synchronisation's floor after a restore). */
export function journalFloors(db: SqliteDatabase): Record<string, number> {
  const out: Record<string, number> = {};
  const journals = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%\\_\\_changes' ESCAPE '\\'",
    )
    .pluck()
    .all() as string[];
  for (const j of journals) {
    const cols = db.prepare(`PRAGMA table_info("${j}")`).all() as { name: string }[];
    if (!cols.some((c) => c.name === 'seq')) continue;
    out[j] = (db.prepare(`SELECT COALESCE(MAX(seq), 0) FROM "${j}"`).pluck().get() as number) ?? 0;
  }
  return out;
}

/**
 * Confirmed: the current base saved (an automatic backup), the copy put aside
 * (a consistent copy of it), the rest at the next start. Nothing replaced now.
 */
export function stageRestore(
  db: SqliteDatabase,
  dataDir: string,
  backupsDir: string,
  preview: RestorePreview,
): PendingRestore {
  if (preview.refused) throw new Error(preview.refused);
  mkdirSync(dirOf(dataDir), { recursive: true });
  const backup = createAutomaticBackup(db, backupsDir, 'avant-restauration', 'module');
  const target = pendingDb(dataDir);
  rmSync(target, { force: true });
  const source = new Database(preview.file, { readonly: true, fileMustExist: true });
  try {
    source.prepare('VACUUM INTO ?').run(target);
  } finally {
    source.close();
  }
  const pending: PendingRestore = {
    source: preview.file,
    stagedAt: new Date().toISOString(),
    backup,
    appVersion: preview.appVersion,
    seqFloors: journalFloors(db),
  };
  writeFileSync(pendingJson(dataDir), JSON.stringify(pending, null, 2));
  return pending;
}

export function pendingRestore(dataDir: string): PendingRestore | null {
  try {
    if (!existsSync(pendingDb(dataDir))) return null;
    return JSON.parse(readFileSync(pendingJson(dataDir), 'utf8')) as PendingRestore;
  } catch {
    return null;
  }
}

/** « Annuler » before the restart: the copy put aside is removed, nothing else changes. */
export function cancelRestore(dataDir: string): void {
  rmSync(pendingDb(dataDir), { force: true });
  rmSync(pendingJson(dataDir), { force: true });
}

/**
 * At the start, BEFORE the base is opened: the copy takes its place, the
 * current base goes aside (restore/before.db). Returns what is being restored.
 */
export function applyPendingRestore(dataDir: string): PendingRestore | null {
  const pending = pendingRestore(dataDir);
  if (!pending) return null;
  const hub = path.join(dataDir, 'hub.db');
  for (const s of SIDE_FILES) rmSync(beforeDb(dataDir) + s, { force: true });
  for (const s of SIDE_FILES) if (existsSync(hub + s)) renameSync(hub + s, beforeDb(dataDir) + s);
  renameSync(pendingDb(dataDir), hub);
  return pending;
}

/** It failed: the base of before comes back (the restored one is dropped). */
export function rollbackRestore(dataDir: string, pending: PendingRestore, reason: string): void {
  const hub = path.join(dataDir, 'hub.db');
  for (const s of SIDE_FILES) rmSync(hub + s, { force: true });
  for (const s of SIDE_FILES)
    if (existsSync(beforeDb(dataDir) + s)) renameSync(beforeDb(dataDir) + s, hub + s);
  // No base of before (first start): its automatic backup, if any.
  if (!existsSync(hub) && existsSync(pending.backup)) copyFileSync(pending.backup, hub);
  rmSync(pendingJson(dataDir), { force: true });
  writeResult(dataDir, { ok: false, at: new Date().toISOString(), source: pending.source, reason });
}

/** It worked: the base of before is dropped (its automatic backup stays in backups/). */
export function finishRestore(dataDir: string, pending: PendingRestore): void {
  for (const s of SIDE_FILES) rmSync(beforeDb(dataDir) + s, { force: true });
  rmSync(pendingJson(dataDir), { force: true });
  writeResult(dataDir, { ok: true, at: new Date().toISOString(), source: pending.source });
}

function writeResult(dataDir: string, result: RestoreResult): void {
  mkdirSync(dirOf(dataDir), { recursive: true });
  writeFileSync(resultJson(dataDir), JSON.stringify(result, null, 2));
}

export function restoreResult(dataDir: string): RestoreResult | null {
  try {
    return JSON.parse(readFileSync(resultJson(dataDir), 'utf8')) as RestoreResult;
  } catch {
    return null;
  }
}

export function dismissRestoreResult(dataDir: string): void {
  rmSync(resultJson(dataDir), { force: true });
}

/**
 * After a restore, the phone and the PC no longer agree on what each has seen:
 * the next synchronisation is a FIRST one again (its preview, « Fusionner »:
 * both devices' data put together by their clocks), never a plain exchange
 * that would skip what the copy did not hold.
 */
export function resetSyncAfterRestore(db: SqliteDatabase): void {
  const has = (t: string) =>
    Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  db.transaction(() => {
    if (has('core__sync_peers'))
      db.prepare('UPDATE core__sync_peers SET first_sync_at = NULL').run();
    if (has('core__sync_cursors'))
      db.prepare('UPDATE core__sync_cursors SET sent_seq = 0, received_seq = 0').run();
  })();
}

/**
 * After a restore: each journal continues after the highest number of the
 * base of before (a marker row, never sent: no clock), so the phone, which
 * knows those numbers, never skips a new change of the PC.
 */
export function raiseJournalFloors(
  db: SqliteDatabase,
  floors: Record<string, number>,
  newId: () => string,
): void {
  const now = journalFloors(db);
  db.transaction(() => {
    for (const [journal, floor] of Object.entries(floors)) {
      if (!(journal in now) || now[journal]! >= floor) continue;
      db.prepare(
        `INSERT INTO "${journal}" (id, at, entity, entity_id, op, data, hlc, origin, seq) VALUES (?, ?, '__restore', '', 'restore', NULL, NULL, NULL, ?)`,
      ).run(newId(), new Date().toISOString(), floor);
    }
  })();
}
