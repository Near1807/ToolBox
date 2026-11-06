// « Prêt pour la synchro » (MODULES.md §6 bis): what every NEW module does so
// that its data can be synchronised later (Android version on the local
// network). Each item has a global UUID (never an auto-increment), its
// creation and last-change dates, a deletion is a tombstone (`deleted_at`),
// and every change is written to the module's journal (`<module>__changes`).
// Portable (no Node import): it runs wherever the modules run (ADR 0044).
import type { ModuleDatabase } from './core';

/** Columns of a synchronisable table (to put first in its CREATE TABLE). */
export const SYNC_COLUMNS =
  'id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT';

/** The journal table of a module (in its first migration): `changesTableSql('sport__changes')`. */
export function changesTableSql(table: string): string {
  return `CREATE TABLE ${table} (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL,
    data TEXT
  );
  CREATE INDEX ${table}_at ON ${table} (at);`;
}

/**
 * The synchronisation's columns of a journal (ADR 0044), added by a module
 * migration of each synchronised module: the HLC of the change, the device
 * it came from (`origin`, null: this device), a local order number (`seq`),
 * and the HLC of the last change of each field (`<module>__field_clock`).
 * The older entries get their order from the table's own order.
 */
export function syncJournalSql(prefix: string): string {
  return `ALTER TABLE ${prefix}changes ADD COLUMN hlc TEXT;
  ALTER TABLE ${prefix}changes ADD COLUMN origin TEXT;
  ALTER TABLE ${prefix}changes ADD COLUMN seq INTEGER;
  UPDATE ${prefix}changes SET seq = rowid;
  CREATE INDEX ${prefix}changes_seq ON ${prefix}changes (seq);
  CREATE TABLE ${prefix}field_clock (
    entity TEXT NOT NULL,
    row_id TEXT NOT NULL,
    field TEXT NOT NULL,
    hlc TEXT NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (entity, row_id, field)
  );`;
}

/** A random UUID (v4), by the Web Crypto API (Node, Electron, browsers, Workers). */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

let lastStamp = 0;
/** Now, as ISO, strictly increasing in this process (the journal is ordered by it). */
export function syncStamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

type SqlValue = string | number | null;
export type SyncOp = 'create' | 'update' | 'delete' | 'restore';

export interface SyncRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Writes synchronisable rows and journals them. Tables are given by their
 * short name (`ctx.db.table()` is applied); column names come from the
 * module's code, never from a request.
 */
export class SyncStore {
  private readonly journal: string;
  private synced: boolean | null = null;

  constructor(private readonly db: ModuleDatabase) {
    this.journal = db.table('changes');
  }

  /** The journal has the synchronisation's columns, and the hub gives a clock. */
  private isSynced(): boolean {
    if (this.synced === null) {
      const columns = this.db.syncClock
        ? (this.db.prepare(`PRAGMA table_info(${this.journal})`).all() as { name: string }[])
        : [];
      this.synced = columns.some((c) => c.name === 'hlc');
    }
    return this.synced;
  }

  private log(entity: string, entityId: string, op: SyncOp, data: unknown, at: string): void {
    const json = data === undefined ? null : JSON.stringify(data);
    if (!this.isSynced()) {
      this.db
        .prepare(
          `INSERT INTO ${this.journal} (id, at, entity, entity_id, op, data) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(newId(), at, entity, entityId, op, json);
      return;
    }
    const hlc = this.db.syncClock!.next();
    const seq =
      (
        this.db.prepare(`SELECT COALESCE(MAX(seq), 0) AS n FROM ${this.journal}`).get() as {
          n: number;
        }
      ).n + 1;
    this.db
      .prepare(
        `INSERT INTO ${this.journal} (id, at, entity, entity_id, op, data, hlc, origin, seq) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(newId(), at, entity, entityId, op, json, hlc, seq);
    // The clock of each field it changed (« the most recent wins, field by field »).
    const fields =
      op === 'create' || op === 'update'
        ? Object.keys(data as Record<string, unknown>).concat(op === 'create' ? ['deleted_at'] : [])
        : ['deleted_at'];
    const clock = this.db.prepare(
      `INSERT INTO ${this.db.table('field_clock')} (entity, row_id, field, hlc, seq) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (entity, row_id, field) DO UPDATE SET hlc = excluded.hlc, seq = excluded.seq`,
    );
    for (const field of fields) clock.run(entity, entityId, field, hlc, seq);
  }

  get<T extends SyncRow>(table: string, id: string, withDeleted = false): T | null {
    const row = this.db.prepare(`SELECT * FROM ${this.db.table(table)} WHERE id = ?`).get(id) as
      T | undefined;
    if (!row || (!withDeleted && row.deleted_at !== null)) return null;
    return row;
  }

  create<T extends SyncRow>(table: string, fields: Record<string, SqlValue>, id = newId()): T {
    const at = syncStamp();
    const columns = ['id', 'created_at', 'updated_at', ...Object.keys(fields)];
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO ${this.db.table(table)} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        )
        .run(id, at, at, ...Object.values(fields));
      this.log(table, id, 'create', fields, at);
    });
    return this.get<T>(table, id)!;
  }

  update<T extends SyncRow>(table: string, id: string, fields: Record<string, SqlValue>): T {
    const at = syncStamp();
    const keys = Object.keys(fields);
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE ${this.db.table(table)} SET ${[...keys.map((k) => `${k} = ?`), 'updated_at = ?'].join(', ')} WHERE id = ?`,
        )
        .run(...Object.values(fields), at, id);
      this.log(table, id, 'update', fields, at);
    });
    return this.get<T>(table, id, true)!;
  }

  /** A tombstone: the row stays (with `deleted_at`), hidden from the lists. */
  remove(table: string, id: string): void {
    const at = syncStamp();
    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE ${this.db.table(table)} SET deleted_at = ?, updated_at = ? WHERE id = ?`)
        .run(at, at, id);
      this.log(table, id, 'delete', undefined, at);
    });
  }

  restore(table: string, id: string): void {
    const at = syncStamp();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE ${this.db.table(table)} SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(at, id);
      this.log(table, id, 'restore', undefined, at);
    });
  }

  /** The journal since an ISO date (for the future synchronisation). */
  changesSince(since = ''): {
    id: string;
    at: string;
    entity: string;
    entity_id: string;
    op: SyncOp;
    data: string | null;
  }[] {
    return this.db
      .prepare(`SELECT * FROM ${this.journal} WHERE at > ? ORDER BY at, id`)
      .all(since) as never;
  }
}
