// The synchronisation engine (ADR 0044), the same on the PC and on the phone.
// It only reads and writes the base: the network is someone else's job.
//
// - Every change of a synchronised module goes to its journal
//   (`<module>__changes`) with an HLC, its origin and a local order (`seq`);
//   SyncStore writes them, and the clock of each field (`<module>__field_clock`).
// - A batch is the journal since a cursor (what the other device has not
//   seen). Applying one is all or nothing (one transaction), and idempotent
//   (a change already in the journal is skipped).
// - Field by field, the most recent HLC wins. When both devices changed the
//   same field since their last exchange, the other value is kept in
//   `core__sync_conflicts` (nothing is lost in silence).
// - A deletion is a tombstone (`deleted_at`), a field like the others:
//   deleted on one side and changed on the other, the row stays deleted with
//   the changes in it (restorable), and it is listed in « Conflits ».
// - Two rows that the base cannot hold together (a unique key: a week, a
//   tag's name) keep the PC's; the module says what goes with it
//   (`sync.onDuplicate`). Two rows of the same NAME are never merged alone:
//   listed in « Conflits », with « Fusionner » when the module has a merge.
// - Only the tables of the modules that declare `sync`: never the music, the
//   archives `*_v1` nor `legacy_ids`.
// Portable: no Node import (it also runs in the phone's Worker).
import type {
  ModuleDatabase,
  ModuleSync,
  SettingValue,
  SyncDuplicate,
  SyncTools,
} from '../../../packages/sdk/core';
import { SyncStore } from '../../../packages/sdk/sync';
import { Hlc, hlcFromIso } from './hlc';

/** What the engine needs of a SQLite connection (better-sqlite3, or the phone's adapter). */
export interface EngineDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  transaction(fn: () => void): () => void;
}

export type Role = 'pc' | 'phone';

/** A module whose data is synchronised. */
export interface SyncedModule {
  id: string;
  sync: ModuleSync;
  /** Its ctx.db (prefixed, with the clock): for onDuplicate's tools. */
  db: ModuleDatabase;
}

/** The settings that are synchronised (`sync: true` in the manifest). */
export interface SyncedSettings {
  /** The synchronised keys of each scope. */
  keys(): Record<string, string[]>;
  read(scope: string, key: string): SettingValue;
  /** Writes without journaling it again (the engine journals). */
  write(scope: string, key: string, value: SettingValue): void;
}

export interface EngineOptions {
  db: EngineDatabase;
  role: Role;
  /** The synchronised modules (more are added as they register: addModule). */
  modules?: SyncedModule[];
  settings?: SyncedSettings;
  randomId(): string;
  now?: () => number;
}

/** A change as it travels between two devices. */
export interface WireChange {
  scope: string;
  id: string;
  at: string;
  entity: string;
  entity_id: string;
  op: 'create' | 'update' | 'delete' | 'restore' | 'set';
  data: Record<string, unknown> | null;
  hlc: string;
  origin: string;
  /** Its order on the device that sends it. */
  seq: number;
}

export interface Batch {
  /** The sending device. */
  device: string;
  changes: WireChange[];
  /** The sender's last order number per scope (read up to there). */
  upTo: Record<string, number>;
}

export interface ConflictRow {
  id: string;
  created_at: string;
  kind: 'field' | 'deleted-edited' | 'duplicate' | 'name';
  scope: string;
  entity: string;
  row_id: string;
  other_id: string | null;
  field: string | null;
  label: string;
  kept: string | null;
  discarded: string | null;
  kept_device: string | null;
  discarded_device: string | null;
  kept_hlc: string | null;
  discarded_hlc: string | null;
  resolved_at: string | null;
  resolution: string | null;
}

export interface ApplySummary {
  /** Changes applied (new to this device). */
  applied: number;
  /** Already known (a batch played twice). */
  skipped: number;
  /** Conflicts written by this batch. */
  conflicts: ConflictRow[];
}

/** One table of a snapshot: its rows and the clock of their fields. */
export interface SnapshotTable {
  rows: Record<string, unknown>[];
  clocks: { row_id: string; field: string; hlc: string }[];
  /** Device that created each row (first journal entry), when known. */
  creators: Record<string, string>;
}

/** Everything a device holds of the synchronised data (first synchronisation). */
export interface Snapshot {
  device: string;
  versions: Record<string, number>;
  scopes: Record<string, { tables: Record<string, SnapshotTable> }>;
  settings: Record<string, Record<string, { value: SettingValue; hlc: string | null }>>;
  /** Last order number of each journal. */
  upTo: Record<string, number>;
}

export interface PreviewTable {
  scope: string;
  entity: string;
  /** Rows only on this device (would go to the other). */
  onlyHere: number;
  /** Rows only on the other device (would come here). */
  onlyThere: number;
  /** Same rows with different values (the most recent field wins). */
  different: number;
}

export interface Preview {
  tables: PreviewTable[];
  names: { scope: string; label: string; name: string }[];
}

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

const IDENT = /^[a-z][a-z0-9_]*$/;
const BASE_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);
const prefixOf = (scope: string) => `${scope.replace(/-/g, '_')}__`;
/** Names compared like the modules do: no case, no accents, spaces trimmed. */
export const foldName = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

interface Clock {
  hlc: string;
  seq: number;
}
interface UniqueIndex {
  columns: string[];
  partial: boolean;
}

export class SyncEngine {
  readonly device: string;
  readonly role: Role;
  private readonly hlc: Hlc;
  private readonly db: EngineDatabase;
  private readonly modules: Map<string, SyncedModule>;
  private readonly options: EngineOptions;
  private readonly columnsCache = new Map<string, Set<string>>();
  private readonly uniqueCache = new Map<string, UniqueIndex[]>();

  constructor(options: EngineOptions) {
    this.options = options;
    this.db = options.db;
    this.role = options.role;
    this.modules = new Map((options.modules ?? []).map((m) => [m.id, m]));
    this.device = this.meta('device') ?? this.setMeta('device', options.randomId());
    this.hlc = new Hlc(this.device, options.now ?? (() => Date.now()), this.meta('hlc'));
    this.clock.device = this.device;
  }

  /** A synchronised module registered (its tables exist: migrated). */
  addModule(module: SyncedModule) {
    this.modules.set(module.id, module);
  }

  /** The synchronised settings (given by the host once its settings exist). */
  setSettings(settings: SyncedSettings) {
    this.options.settings = settings;
  }

  // --- Clock -----------------------------------------------------------------

  private meta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM core__meta WHERE key = ?').get(`sync.${key}`) as
      { value: string } | undefined;
    return row?.value ?? null;
  }
  private setMeta(key: string, value: string): string {
    this.db
      .prepare(
        'INSERT INTO core__meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(`sync.${key}`, value);
    return value;
  }

  /** The clock given to the modules (ModuleDatabase.syncClock). */
  readonly clock: { device: string; next(): string } = {
    device: '',
    next: (): string => {
      const value = this.hlc.next();
      this.setMeta('hlc', value);
      return value;
    },
  };

  private receive(hlc: string) {
    this.hlc.receive(hlc);
    this.setMeta('hlc', this.hlc.current());
  }

  // --- Scopes, tables, columns --------------------------------------------------

  /** The synchronised scopes: the core (settings) and the modules that declare `sync`. */
  scopes(): string[] {
    return ['core', ...this.modules.keys()];
  }

  private journal(scope: string) {
    return `${prefixOf(scope)}changes`;
  }
  private fieldClock(scope: string) {
    return `${prefixOf(scope)}field_clock`;
  }

  private columns(table: string): Set<string> {
    let cols = this.columnsCache.get(table);
    if (!cols) {
      cols = new Set(
        (this.db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(
          (c) => c.name,
        ),
      );
      this.columnsCache.set(table, cols);
    }
    return cols;
  }

  /** The synchronised tables of a module, by short name (never the journal, `*_v1`, `legacy_ids`). */
  tables(scope: string): string[] {
    if (scope === 'core' || !this.modules.has(scope)) return [];
    const prefix = prefixOf(scope);
    return (
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[]
    )
      .map((t) => t.name)
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length))
      .filter(
        (short) =>
          short !== 'changes' &&
          short !== 'field_clock' &&
          short !== 'legacy_ids' &&
          !short.endsWith('_v1') &&
          [...BASE_COLUMNS].every((c) => this.columns(prefix + short).has(c)),
      );
  }

  private uniques(table: string): UniqueIndex[] {
    let list = this.uniqueCache.get(table);
    if (!list) {
      list = (
        this.db.prepare(`PRAGMA index_list("${table}")`).all() as {
          name: string;
          unique: number;
          origin: string;
          partial: number;
        }[]
      )
        .filter((i) => i.unique && i.origin !== 'pk')
        .map((i) => ({
          columns: (
            this.db.prepare(`PRAGMA index_info("${i.name}")`).all() as { name: string }[]
          ).map((c) => c.name),
          partial: Boolean(i.partial),
        }));
      this.uniqueCache.set(table, list);
    }
    return list;
  }

  // --- Versions -------------------------------------------------------------------

  /** The base's version: the last migration of the core and of each synchronised module. */
  versions(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const scope of this.scopes()) {
      const row = this.db
        .prepare('SELECT MAX(version) AS v FROM core__migrations WHERE scope = ?')
        .get(scope) as { v: number | null };
      out[scope] = row.v ?? 0;
    }
    return out;
  }

  // --- Journal ----------------------------------------------------------------------

  private nextSeq(scope: string): number {
    return (
      (
        this.db.prepare(`SELECT COALESCE(MAX(seq), 0) AS n FROM ${this.journal(scope)}`).get() as {
          n: number;
        }
      ).n + 1
    );
  }

  /** Last order number of each journal. */
  upTo(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const scope of this.scopes()) out[scope] = this.nextSeq(scope) - 1;
    return out;
  }

  /** A synchronised setting changed on this device: journaled like a field. */
  logSetting(scope: string, key: string, value: SettingValue): void {
    const hlc = this.clock.next();
    const seq = this.nextSeq('core');
    const at = new Date(this.options.now?.() ?? Date.now()).toISOString();
    this.db
      .prepare(
        'INSERT INTO core__changes (id, at, entity, entity_id, op, data, hlc, origin, seq) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
      )
      .run(
        this.options.randomId(),
        at,
        'settings',
        scope,
        'set',
        JSON.stringify({ [key]: value }),
        hlc,
        seq,
      );
    this.setClock('core', 'settings', scope, key, hlc, seq);
  }

  /** The changes the other device has not seen: after its cursor, not coming from it. */
  prepareBatch(peer: string, since: Record<string, number>): Batch {
    const changes: WireChange[] = [];
    const upTo: Record<string, number> = {};
    for (const scope of this.scopes()) {
      const rows = this.db
        .prepare(
          `SELECT * FROM ${this.journal(scope)} WHERE seq > ? AND hlc IS NOT NULL AND COALESCE(origin, '') <> ? ORDER BY seq`,
        )
        .all(since[scope] ?? 0, peer) as {
        id: string;
        at: string;
        entity: string;
        entity_id: string;
        op: WireChange['op'];
        data: string | null;
        hlc: string;
        origin: string | null;
        seq: number;
      }[];
      for (const r of rows)
        changes.push({
          scope,
          id: r.id,
          at: r.at,
          entity: r.entity,
          entity_id: r.entity_id,
          op: r.op,
          data: r.data === null ? null : (JSON.parse(r.data) as Record<string, unknown>),
          hlc: r.hlc,
          origin: r.origin ?? this.device,
          seq: r.seq,
        });
      upTo[scope] = this.nextSeq(scope) - 1;
    }
    return { device: this.device, changes, upTo };
  }

  // --- Applying a batch -----------------------------------------------------------

  /** Refuses anything that is not a change of a synchronised table or setting. */
  private check(c: WireChange) {
    const fail = (why: string) => {
      throw new SyncError(`Changement refusé (${why}) : ${c.scope}/${c.entity}`);
    };
    if (!this.scopes().includes(c.scope)) fail('module non synchronisé');
    if (typeof c.id !== 'string' || typeof c.entity_id !== 'string' || !c.entity_id)
      fail('identifiant');
    if (typeof c.hlc !== 'string' || !/^\d{18}\.\d{5}\..+$/.test(c.hlc)) fail('horloge');
    if (c.scope === 'core') {
      if (c.entity !== 'settings' || c.op !== 'set') fail('réglage');
      const keys = this.options.settings?.keys()[c.entity_id] ?? [];
      for (const k of Object.keys(c.data ?? {})) if (!keys.includes(k)) fail(`réglage ${k}`);
      return;
    }
    if (!IDENT.test(c.entity) || !this.tables(c.scope).includes(c.entity)) fail('table');
    if (!['create', 'update', 'delete', 'restore'].includes(c.op)) fail('opération');
    const cols = this.columns(prefixOf(c.scope) + c.entity);
    for (const k of Object.keys(c.data ?? {}))
      if (!IDENT.test(k) || !cols.has(k) || BASE_COLUMNS.has(k)) fail(`colonne ${k}`);
  }

  private getClock(scope: string, entity: string, rowId: string, field: string): Clock | null {
    return (
      (this.db
        .prepare(
          `SELECT hlc, seq FROM ${this.fieldClock(scope)} WHERE entity = ? AND row_id = ? AND field = ?`,
        )
        .get(entity, rowId, field) as Clock | undefined) ?? null
    );
  }
  private setClock(
    scope: string,
    entity: string,
    rowId: string,
    field: string,
    hlc: string,
    seq: number,
  ) {
    this.db
      .prepare(
        `INSERT INTO ${this.fieldClock(scope)} (entity, row_id, field, hlc, seq) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (entity, row_id, field) DO UPDATE SET hlc = excluded.hlc, seq = excluded.seq`,
      )
      .run(entity, rowId, field, hlc, seq);
  }

  /** The local value of a field was set by a change the other device has not seen. */
  private concurrent(scope: string, clock: Clock | null, peer: string, peerHas: number): boolean {
    if (!clock || clock.seq <= peerHas) return false;
    const row = this.db
      .prepare(`SELECT origin FROM ${this.journal(scope)} WHERE seq = ?`)
      .get(clock.seq) as { origin: string | null } | undefined;
    return (row?.origin ?? this.device) !== peer;
  }

  /** The device that created a row (its first journal entry), or null when unknown. */
  creator(scope: string, entity: string, id: string): string | null {
    const row = this.db
      .prepare(
        `SELECT origin FROM ${this.journal(scope)} WHERE entity = ? AND entity_id = ? ORDER BY seq LIMIT 1`,
      )
      .get(entity, id) as { origin: string | null } | undefined;
    if (!row) return null;
    return row.origin ?? this.device;
  }

  private changeCount(scope: string, entity: string, id: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${this.journal(scope)} WHERE entity = ? AND entity_id = ?`,
        )
        .get(entity, id) as { n: number }
    ).n;
  }

  private pcDevice(peer: string): string {
    return this.role === 'pc' ? this.device : peer;
  }

  private conflictsAdded: ConflictRow[] = [];
  private pendingDuplicates: { scope: string; peer: string; event: SyncDuplicate }[] = [];

  private runDuplicates() {
    const pending = this.pendingDuplicates.splice(0);
    if (this.role !== 'pc') return;
    for (const p of pending)
      this.modules.get(p.scope)?.sync.onDuplicate?.(p.event, this.tools(p.scope, p.peer));
  }

  private addConflict(c: Omit<ConflictRow, 'id' | 'created_at' | 'resolved_at' | 'resolution'>) {
    // The same thing is never listed twice (a batch played again, both devices).
    const exists = this.db
      .prepare(
        `SELECT 1 FROM core__sync_conflicts WHERE kind = ? AND entity = ? AND row_id = ?
           AND COALESCE(other_id, '') = ? AND COALESCE(field, '') = ? AND COALESCE(discarded_hlc, '') = ?`,
      )
      .get(
        c.kind,
        `${c.scope}/${c.entity}`,
        c.row_id,
        c.other_id ?? '',
        c.field ?? '',
        c.discarded_hlc ?? '',
      );
    if (exists) return;
    const row: ConflictRow = {
      ...c,
      entity: `${c.scope}/${c.entity}`,
      id: this.options.randomId(),
      created_at: new Date(this.options.now?.() ?? Date.now()).toISOString(),
      resolved_at: null,
      resolution: null,
    };
    this.insertConflict(row);
    this.conflictsAdded.push(row);
  }

  private insertConflict(row: ConflictRow) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO core__sync_conflicts (id, created_at, kind, scope, entity, row_id, other_id, field, label,
           kept, discarded, kept_device, discarded_device, kept_hlc, discarded_hlc, resolved_at, resolution)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.created_at,
        row.kind,
        row.scope,
        row.entity,
        row.row_id,
        row.other_id,
        row.field,
        row.label,
        row.kept,
        row.discarded,
        row.kept_device,
        row.discarded_device,
        row.kept_hlc,
        row.discarded_hlc,
        row.resolved_at,
        row.resolution,
      );
  }

  /** Conflicts found by the other device (it sends them back): listed here too. */
  importConflicts(rows: ConflictRow[]) {
    for (const r of rows) this.insertConflict(r);
  }

  private rowLabel(
    scope: string,
    entity: string,
    row: Record<string, unknown> | undefined,
  ): string {
    const name = row && (row.name ?? row.title ?? row.week ?? row.date);
    return `${scope} › ${entity}${name ? ` « ${String(name)} »` : ''}`;
  }

  private tools(scope: string, peer: string): SyncTools {
    const module = this.modules.get(scope)!;
    return {
      db: module.db,
      creator: (table, id) => this.creator(scope, table, id),
      changes: (table, id) => this.changeCount(scope, table, id),
      remove: (table, id) => new SyncStore(module.db).remove(table, id),
      conflict: (c) =>
        this.addConflict({
          kind: 'duplicate',
          scope,
          entity: c.table,
          row_id: c.id,
          other_id: null,
          field: null,
          label: `${c.label} — ${c.detail}`,
          kept: null,
          discarded: null,
          kept_device: this.pcDevice(peer),
          discarded_device: null,
          kept_hlc: null,
          discarded_hlc: null,
        }),
    };
  }

  /**
   * A row that the base cannot hold next to `local` (same unique key): the
   * PC's stays; if both or none come from the PC, the one created first.
   * Returns true when the incoming row is kept (the local one takes its id).
   */
  private incomingWins(
    scope: string,
    entity: string,
    local: Record<string, unknown>,
    incomingId: string,
    incomingCreator: string,
    incomingAt: string,
    peer: string,
  ): boolean {
    const pc = this.pcDevice(peer);
    const localCreator = this.creator(scope, entity, String(local.id)) ?? this.device;
    const iPc = incomingCreator === pc;
    const lPc = localCreator === pc;
    if (iPc !== lPc) return iPc;
    if (incomingAt !== String(local.created_at)) return incomingAt < String(local.created_at);
    return incomingId < String(local.id);
  }

  /** The live (or any) row that holds the same unique key as `values`, other than `id`. */
  private collision(table: string, id: string, values: Record<string, unknown>, live: boolean) {
    for (const u of this.uniques(table)) {
      if (u.partial && !live) continue;
      if (u.columns.some((c) => !(c in values))) continue;
      const where = u.columns.map((c) => `"${c}" = ?`).join(' AND ');
      const row = this.db
        .prepare(
          `SELECT * FROM ${table} WHERE ${where} AND id <> ?${u.partial ? ' AND deleted_at IS NULL' : ''}`,
        )
        .get(...u.columns.map((c) => values[c]), id) as Record<string, unknown> | undefined;
      if (row) return { row, key: Object.fromEntries(u.columns.map((c) => [c, values[c]])) };
    }
    return null;
  }

  /**
   * Field by field: the most recent HLC wins. `rowFallback` is the HLC of a
   * field that has no clock yet (data from before the synchronisation).
   */
  private mergeFields(
    scope: string,
    entity: string,
    rowId: string,
    incoming: Record<string, unknown>,
    hlc: string,
    origin: string,
    seq: number,
    peer: string,
    peerHas: number,
    localRow: Record<string, unknown>,
    fallback: { local: string; incoming: Record<string, string> | null },
  ): boolean {
    const table = prefixOf(scope) + entity;
    const set: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(incoming)) {
      const clock = this.getClock(scope, entity, rowId, field);
      const localHlc = clock?.hlc ?? fallback.local;
      const incomingHlc = fallback.incoming?.[field] ?? hlc;
      const same = JSON.stringify(localRow[field] ?? null) === JSON.stringify(value ?? null);
      const isConcurrent = this.concurrent(scope, clock, peer, peerHas);
      if (incomingHlc > localHlc) {
        set[field] = value;
        this.setClock(scope, entity, rowId, field, incomingHlc, seq);
        if (isConcurrent && !same)
          this.addConflict({
            kind: field === 'deleted_at' ? 'deleted-edited' : 'field',
            scope,
            entity,
            row_id: rowId,
            other_id: null,
            field,
            label: this.rowLabel(scope, entity, localRow),
            kept: JSON.stringify(value ?? null),
            discarded: JSON.stringify(localRow[field] ?? null),
            kept_device: origin,
            discarded_device: this.device,
            kept_hlc: incomingHlc,
            discarded_hlc: localHlc,
          });
      } else if (isConcurrent && !same) {
        this.addConflict({
          kind: field === 'deleted_at' ? 'deleted-edited' : 'field',
          scope,
          entity,
          row_id: rowId,
          other_id: null,
          field,
          label: this.rowLabel(scope, entity, localRow),
          kept: JSON.stringify(localRow[field] ?? null),
          discarded: JSON.stringify(value ?? null),
          kept_device: this.device,
          discarded_device: origin,
          kept_hlc: localHlc,
          discarded_hlc: incomingHlc,
        });
      }
    }
    // Changed on one side while deleted on the other: kept (in the tombstone), and said.
    const deletedHere = localRow.deleted_at !== null && localRow.deleted_at !== undefined;
    if (deletedHere && !('deleted_at' in incoming) && Object.keys(set).length > 0) {
      const clock = this.getClock(scope, entity, rowId, 'deleted_at');
      if (this.concurrent(scope, clock, peer, peerHas))
        this.addConflict({
          kind: 'deleted-edited',
          scope,
          entity,
          row_id: rowId,
          other_id: null,
          field: Object.keys(set).join(', '),
          label: `${this.rowLabel(scope, entity, localRow)} : supprimé ici, modifié sur l’autre appareil (les modifications sont gardées, l’élément reste supprimé et restaurable)`,
          kept: null,
          discarded: null,
          kept_device: this.device,
          discarded_device: origin,
          kept_hlc: clock?.hlc ?? null,
          discarded_hlc: hlc,
        });
    }
    const keys = Object.keys(set);
    if (keys.length === 0) return false;
    this.db
      .prepare(`UPDATE ${table} SET ${keys.map((k) => `"${k}" = ?`).join(', ')} WHERE id = ?`)
      .run(...keys.map((k) => set[k] as never), rowId);
    return true;
  }

  private touch(table: string, id: string, at: string) {
    this.db
      .prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ? AND updated_at < ?`)
      .run(at, id, at);
  }

  private applyRow(c: WireChange, seq: number, peer: string, peerHas: number) {
    const table = prefixOf(c.scope) + c.entity;
    const local = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(c.entity_id) as
      Record<string, unknown> | undefined;
    const fields: Record<string, unknown> =
      c.op === 'delete'
        ? { deleted_at: c.at }
        : c.op === 'restore'
          ? { deleted_at: null }
          : { ...(c.data ?? {}) };
    if (!local) {
      if (c.op !== 'create') return; // A row this device never had (or dropped as a duplicate).
      const values = { ...fields, deleted_at: null };
      const hit = this.collision(table, c.entity_id, values, true);
      if (hit) {
        if (!this.incomingWins(c.scope, c.entity, hit.row, c.entity_id, c.origin, c.at, peer)) {
          this.duplicate(
            c.scope,
            c.entity,
            String(hit.row.id),
            c.entity_id,
            hit.key,
            c.origin,
            peer,
            hit.row,
          );
          return;
        }
        // The incoming row is kept: the local one takes its id and its values.
        const oldId = String(hit.row.id);
        const localCreator = this.creator(c.scope, c.entity, oldId) ?? this.device;
        this.adopt(
          c.scope,
          c.entity,
          oldId,
          c.entity_id,
          { ...fields, deleted_at: null },
          c.at,
          c.hlc,
          seq,
          hit.row,
          c.origin,
        );
        const moved = { ...hit.row, ...fields, id: c.entity_id };
        this.duplicate(c.scope, c.entity, c.entity_id, oldId, hit.key, localCreator, peer, moved);
        return;
      }
      const cols = ['id', 'created_at', 'updated_at', 'deleted_at', ...Object.keys(fields)];
      this.db
        .prepare(
          `INSERT INTO ${table} (${cols.map((x) => `"${x}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        )
        .run(c.entity_id, c.at, c.at, null, ...Object.values(fields).map((v) => v as never));
      for (const f of [...Object.keys(fields), 'deleted_at'])
        this.setClock(c.scope, c.entity, c.entity_id, f, c.hlc, seq);
      return;
    }
    // A restore or a changed key must not break a unique key: the field stays, and it is said.
    const keyFields = this.uniques(table).flatMap((u) => u.columns);
    const after = { ...local, ...fields };
    if (Object.keys(fields).some((f) => keyFields.includes(f) || f === 'deleted_at')) {
      const hit = this.collision(table, c.entity_id, after, after.deleted_at === null);
      if (hit) {
        for (const f of Object.keys(fields))
          if (keyFields.includes(f) || f === 'deleted_at') delete fields[f];
        this.addConflict({
          kind: 'duplicate',
          scope: c.scope,
          entity: c.entity,
          row_id: c.entity_id,
          other_id: String(hit.row.id),
          field: null,
          label: `${this.rowLabel(c.scope, c.entity, local)} : même clé qu’un autre élément, changement non appliqué`,
          kept: null,
          discarded: JSON.stringify(hit.key),
          kept_device: this.device,
          discarded_device: c.origin,
          kept_hlc: null,
          discarded_hlc: c.hlc,
        });
      }
    }
    if (
      this.mergeFields(
        c.scope,
        c.entity,
        c.entity_id,
        fields,
        c.hlc,
        c.origin,
        seq,
        peer,
        peerHas,
        local,
        {
          local: hlcFromIso(String(local.updated_at), this.device),
          incoming: null,
        },
      )
    )
      this.touch(table, c.entity_id, c.at);
  }

  /**
   * The local row gives way to the incoming one (same unique key): it takes
   * its id and all its values, as the other device keeps them. What it had
   * that differs is kept in « Conflits ».
   */
  private adopt(
    scope: string,
    entity: string,
    oldId: string,
    newId: string,
    fields: Record<string, unknown>,
    at: string,
    hlc: string,
    seq: number,
    local: Record<string, unknown>,
    origin: string,
    clocks: Record<string, string> = {},
  ) {
    const table = prefixOf(scope) + entity;
    const keys = Object.keys(fields);
    this.db
      .prepare(
        `UPDATE ${table} SET id = ?, created_at = ?, updated_at = ?${keys.map((k) => `, "${k}" = ?`).join('')} WHERE id = ?`,
      )
      .run(newId, at, at, ...keys.map((k) => fields[k] as never), oldId);
    this.db
      .prepare(`DELETE FROM ${this.fieldClock(scope)} WHERE entity = ? AND row_id = ?`)
      .run(entity, oldId);
    for (const k of keys) this.setClock(scope, entity, newId, k, clocks[k] ?? hlc, seq);
    const lost = keys.filter(
      (k) => JSON.stringify(local[k] ?? null) !== JSON.stringify(fields[k] ?? null),
    );
    if (lost.length)
      this.addConflict({
        kind: 'field',
        scope,
        entity,
        row_id: newId,
        other_id: oldId,
        field: lost.join(', '),
        label: `${this.rowLabel(scope, entity, local)} : existait aussi ici, la version du PC est gardée`,
        kept: JSON.stringify(Object.fromEntries(lost.map((k) => [k, fields[k] ?? null]))),
        discarded: JSON.stringify(Object.fromEntries(lost.map((k) => [k, local[k] ?? null]))),
        kept_device: origin,
        discarded_device: this.device,
        kept_hlc: hlc,
        discarded_hlc: null,
      });
  }

  private duplicate(
    scope: string,
    entity: string,
    kept: string,
    dropped: string,
    key: Record<string, unknown>,
    droppedDevice: string,
    peer: string,
    keptRow: Record<string, unknown>,
  ) {
    this.addConflict({
      kind: 'duplicate',
      scope,
      entity,
      row_id: kept,
      other_id: dropped,
      field: null,
      label: `${this.rowLabel(scope, entity, keptRow)} existait sur les deux appareils : celui du PC est gardé`,
      kept: JSON.stringify(key),
      discarded: JSON.stringify(key),
      kept_device: this.pcDevice(peer),
      discarded_device: droppedDevice,
      kept_hlc: null,
      discarded_hlc: null,
    });
    // What goes with it (e.g. the sessions of a week filled twice) is decided
    // at the end of the batch (after all its changes), and by the PC only: it
    // always receives the phone's changes first, and its decisions go back to
    // the phone in the same exchange (one truth, no second round).
    this.pendingDuplicates.push({
      scope,
      peer,
      event: { table: entity, kept, dropped, key, droppedDevice },
    });
  }

  private applySetting(c: WireChange, seq: number, peer: string, peerHas: number) {
    const settings = this.options.settings!;
    for (const [key, value] of Object.entries(c.data ?? {})) {
      const clock = this.getClock('core', 'settings', c.entity_id, key);
      const current = settings.read(c.entity_id, key);
      const concurrent = this.concurrent('core', clock, peer, peerHas);
      const same = JSON.stringify(current) === JSON.stringify(value);
      const win = c.hlc > (clock?.hlc ?? '');
      if (win) {
        settings.write(c.entity_id, key, value as SettingValue);
        this.setClock('core', 'settings', c.entity_id, key, c.hlc, seq);
      }
      if (concurrent && !same)
        this.addConflict({
          kind: 'field',
          scope: 'core',
          entity: 'settings',
          row_id: c.entity_id,
          other_id: null,
          field: key,
          label: `Réglage ${c.entity_id} › ${key}`,
          kept: JSON.stringify(win ? value : current),
          discarded: JSON.stringify(win ? current : value),
          kept_device: win ? c.origin : this.device,
          discarded_device: win ? this.device : c.origin,
          kept_hlc: win ? c.hlc : (clock?.hlc ?? null),
          discarded_hlc: win ? (clock?.hlc ?? null) : c.hlc,
        });
    }
  }

  /**
   * Applies a batch of the other device, all or nothing. `peerHas`: how far
   * the other device has received this device's changes (per scope), to
   * know which local changes it had not seen (a conflict) and which it had.
   */
  applyBatch(peer: string, batch: Batch, peerHas: Record<string, number>): ApplySummary {
    if (batch.device !== peer) throw new SyncError('Lot d’un autre appareil');
    for (const c of batch.changes) this.check(c);
    let applied = 0;
    let skipped = 0;
    this.conflictsAdded = [];
    this.pendingDuplicates = [];
    this.db.transaction(() => {
      for (const c of batch.changes) {
        const journal = this.journal(c.scope);
        if (this.db.prepare(`SELECT 1 FROM ${journal} WHERE id = ?`).get(c.id)) {
          skipped++;
          continue;
        }
        this.receive(c.hlc);
        const seq = this.nextSeq(c.scope);
        this.db
          .prepare(
            `INSERT INTO ${journal} (id, at, entity, entity_id, op, data, hlc, origin, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            c.id,
            c.at,
            c.entity,
            c.entity_id,
            c.op,
            c.data === null ? null : JSON.stringify(c.data),
            c.hlc,
            c.origin === this.device ? null : c.origin,
            seq,
          );
        if (c.scope === 'core') this.applySetting(c, seq, peer, peerHas.core ?? 0);
        else this.applyRow(c, seq, peer, peerHas[c.scope] ?? 0);
        applied++;
      }
      this.runDuplicates();
      this.detectNames(peer);
      for (const [scope, upTo] of Object.entries(batch.upTo))
        if (this.scopes().includes(scope)) this.setCursor(peer, scope, { received: upTo });
    })();
    return { applied, skipped, conflicts: this.conflictsAdded };
  }

  // --- Names created on both devices ----------------------------------------------

  /** Same name (no case, no accents) on rows created by different devices: listed, never merged. */
  private detectNames(peer: string) {
    for (const module of this.modules.values())
      for (const n of module.sync.names ?? []) {
        const table = prefixOf(module.id) + n.table;
        if (!this.tables(module.id).includes(n.table)) continue;
        const rows = this.db
          .prepare(
            `SELECT id, "${n.column}" AS name, created_at FROM ${table} WHERE deleted_at IS NULL`,
          )
          .all() as { id: string; name: string; created_at: string }[];
        const groups = new Map<string, typeof rows>();
        for (const r of rows) {
          const k = foldName(String(r.name ?? ''));
          if (!k) continue;
          groups.set(k, [...(groups.get(k) ?? []), r]);
        }
        for (const group of groups.values()) {
          if (group.length < 2) continue;
          // No journal entry here: received whole (first synchronisation), so from elsewhere.
          const creators = new Set(
            group.map((r) => this.creator(module.id, n.table, r.id) ?? `?${r.id}`),
          );
          if (creators.size < 2) continue; // Already twice on one device: not the synchronisation's doing.
          const sorted = [...group].sort(
            (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
          );
          for (const other of sorted.slice(1)) {
            const already = this.db
              .prepare(
                `SELECT 1 FROM core__sync_conflicts WHERE kind = 'name' AND entity = ? AND
                   ((row_id = ? AND other_id = ?) OR (row_id = ? AND other_id = ?))`,
              )
              .get(`${module.id}/${n.table}`, sorted[0]!.id, other.id, other.id, sorted[0]!.id);
            if (already) continue;
            this.addConflict({
              kind: 'name',
              scope: module.id,
              entity: n.table,
              row_id: sorted[0]!.id,
              other_id: other.id,
              field: n.column,
              label: `${n.label} « ${sorted[0]!.name} » existe deux fois (créé sur chaque appareil)`,
              kept: sorted[0]!.name,
              discarded: other.name,
              kept_device: this.creator(module.id, n.table, sorted[0]!.id) ?? this.device,
              discarded_device: this.creator(module.id, n.table, other.id) ?? this.device,
              kept_hlc: null,
              discarded_hlc: null,
            });
          }
        }
      }
    void peer;
  }

  // --- Cursors, peers ------------------------------------------------------------------

  cursors(peer: string): Record<string, { sent: number; received: number }> {
    const rows = this.db
      .prepare('SELECT scope, sent_seq, received_seq FROM core__sync_cursors WHERE peer = ?')
      .all(peer) as { scope: string; sent_seq: number; received_seq: number }[];
    const out: Record<string, { sent: number; received: number }> = {};
    for (const scope of this.scopes()) out[scope] = { sent: 0, received: 0 };
    for (const r of rows) out[r.scope] = { sent: r.sent_seq, received: r.received_seq };
    return out;
  }

  setCursor(peer: string, scope: string, v: { sent?: number; received?: number }) {
    this.db
      .prepare(
        `INSERT INTO core__sync_cursors (peer, scope, sent_seq, received_seq) VALUES (?, ?, ?, ?)
         ON CONFLICT (peer, scope) DO UPDATE SET
           sent_seq = CASE WHEN ? IS NULL THEN sent_seq ELSE ? END,
           received_seq = CASE WHEN ? IS NULL THEN received_seq ELSE ? END`,
      )
      .run(
        peer,
        scope,
        v.sent ?? 0,
        v.received ?? 0,
        v.sent ?? null,
        v.sent ?? null,
        v.received ?? null,
        v.received ?? null,
      );
  }

  // --- Snapshot (first synchronisation) -----------------------------------------------

  snapshot(): Snapshot {
    const scopes: Snapshot['scopes'] = {};
    for (const scope of this.modules.keys()) {
      const tables: Record<string, SnapshotTable> = {};
      for (const entity of this.tables(scope)) {
        const rows = this.db
          .prepare(`SELECT * FROM ${prefixOf(scope)}${entity} ORDER BY rowid`)
          .all() as Record<string, unknown>[];
        const clocks = this.db
          .prepare(`SELECT row_id, field, hlc FROM ${this.fieldClock(scope)} WHERE entity = ?`)
          .all(entity) as SnapshotTable['clocks'];
        const creators: Record<string, string> = {};
        for (const r of this.db
          .prepare(
            `SELECT entity_id, COALESCE(origin, ?) AS origin FROM ${this.journal(scope)} WHERE entity = ? AND op = 'create'`,
          )
          .all(this.device, entity) as { entity_id: string; origin: string }[])
          creators[r.entity_id] = r.origin;
        tables[entity] = { rows, clocks, creators };
      }
      scopes[scope] = { tables };
    }
    const settings: Snapshot['settings'] = {};
    for (const [scope, keys] of Object.entries(this.options.settings?.keys() ?? {})) {
      settings[scope] = {};
      for (const key of keys)
        settings[scope][key] = {
          value: this.options.settings!.read(scope, key),
          hlc: this.getClock('core', 'settings', scope, key)?.hlc ?? null,
        };
    }
    return { device: this.device, versions: this.versions(), scopes, settings, upTo: this.upTo() };
  }

  /** What a first synchronisation would do, without writing anything. */
  preview(remote: Snapshot): Preview {
    const tables: PreviewTable[] = [];
    const names: Preview['names'] = [];
    const mine = this.snapshot();
    for (const scope of this.modules.keys()) {
      const all = new Set([
        ...Object.keys(mine.scopes[scope]?.tables ?? {}),
        ...Object.keys(remote.scopes[scope]?.tables ?? {}),
      ]);
      for (const entity of all) {
        const here = new Map(
          (mine.scopes[scope]?.tables[entity]?.rows ?? []).map((r) => [String(r.id), r]),
        );
        const there = new Map(
          (remote.scopes[scope]?.tables[entity]?.rows ?? []).map((r) => [String(r.id), r]),
        );
        let onlyHere = 0;
        let onlyThere = 0;
        let different = 0;
        for (const [id, r] of here)
          if (!there.has(id)) onlyHere += r.deleted_at === null ? 1 : 0;
          else if (
            JSON.stringify({ ...r, updated_at: 0 }) !==
            JSON.stringify({ ...there.get(id)!, updated_at: 0 })
          )
            different++;
        for (const [id, r] of there) if (!here.has(id)) onlyThere += r.deleted_at === null ? 1 : 0;
        if (onlyHere || onlyThere || different)
          tables.push({ scope, entity, onlyHere, onlyThere, different });
      }
      for (const n of this.modules.get(scope)!.sync.names ?? []) {
        const live = (rows: Record<string, unknown>[] | undefined) =>
          new Map(
            (rows ?? [])
              .filter((r) => r.deleted_at === null)
              .map((r) => [foldName(String(r[n.column] ?? '')), r] as const),
          );
        const a = live(mine.scopes[scope]?.tables[n.table]?.rows);
        const b = live(remote.scopes[scope]?.tables[n.table]?.rows);
        for (const [k, r] of a) {
          const o = b.get(k);
          if (k && o && o.id !== r.id)
            names.push({ scope, label: n.label, name: String(r[n.column]) });
        }
      }
    }
    return { tables, names };
  }

  /**
   * First synchronisation, from the other device's snapshot:
   * - `merge`: every row of both devices is kept; the same row on both:
   *   the most recent field wins (a field with no clock: the row's last change);
   * - `replace` (the phone only, « Partir des données du PC »): the data of
   *   the synchronised modules here is replaced by the snapshot's (after the
   *   copy « avant-synchro » the app takes first).
   * No journal entry: the cursors start after what each device has now.
   */
  applySnapshot(peer: string, remote: Snapshot, mode: 'merge' | 'replace'): ApplySummary {
    if (remote.device !== peer) throw new SyncError('Données d’un autre appareil');
    if (mode === 'replace' && this.role !== 'phone')
      throw new SyncError('Seul le téléphone peut repartir des données du PC');
    let applied = 0;
    this.conflictsAdded = [];
    // Everything is checked before anything is written.
    for (const scope of Object.keys(remote.scopes)) {
      if (!this.modules.has(scope)) throw new SyncError(`Module non synchronisé : ${scope}`);
      for (const [entity, t] of Object.entries(remote.scopes[scope]!.tables)) {
        if (!this.tables(scope).includes(entity))
          throw new SyncError(`Table refusée : ${scope}/${entity}`);
        const cols = this.columns(prefixOf(scope) + entity);
        for (const r of t.rows)
          for (const k of Object.keys(r))
            if (!IDENT.test(k) || !cols.has(k)) throw new SyncError(`Colonne refusée : ${k}`);
      }
    }
    this.db.transaction(() => {
      if (mode === 'replace') {
        for (const scope of this.modules.keys()) {
          for (const entity of this.tables(scope))
            this.db.exec(`DELETE FROM ${prefixOf(scope)}${entity}`);
          this.db.exec(`DELETE FROM ${this.journal(scope)}`);
          this.db.exec(`DELETE FROM ${this.fieldClock(scope)}`);
        }
        this.db.exec("DELETE FROM core__field_clock WHERE entity = 'settings'");
      }
      for (const [scope, { tables }] of Object.entries(remote.scopes)) {
        for (const [entity, t] of Object.entries(tables)) {
          const table = prefixOf(scope) + entity;
          const clocks = new Map<string, Record<string, string>>();
          for (const c of t.clocks)
            clocks.set(c.row_id, { ...(clocks.get(c.row_id) ?? {}), [c.field]: c.hlc });
          for (const row of t.rows) {
            const id = String(row.id);
            const rowClocks = clocks.get(id) ?? {};
            const fallback = hlcFromIso(String(row.updated_at), peer);
            const local = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
              Record<string, unknown> | undefined;
            const fields = Object.fromEntries(
              Object.entries(row).filter(([k]) => !['id', 'created_at', 'updated_at'].includes(k)),
            );
            if (!local) {
              const hit =
                mode === 'merge' ? this.collision(table, id, row, row.deleted_at === null) : null;
              if (hit) {
                const creator = t.creators[id] ?? peer;
                if (
                  !this.incomingWins(
                    scope,
                    entity,
                    hit.row,
                    id,
                    creator,
                    String(row.created_at),
                    peer,
                  )
                ) {
                  this.duplicate(
                    scope,
                    entity,
                    String(hit.row.id),
                    id,
                    hit.key,
                    creator,
                    peer,
                    hit.row,
                  );
                  continue;
                }
                const oldId = String(hit.row.id);
                const localCreator = this.creator(scope, entity, oldId) ?? this.device;
                this.adopt(
                  scope,
                  entity,
                  oldId,
                  id,
                  fields,
                  String(row.created_at),
                  fallback,
                  0,
                  hit.row,
                  creator,
                  rowClocks,
                );
                this.duplicate(scope, entity, id, oldId, hit.key, localCreator, peer, {
                  ...hit.row,
                  id,
                });
                applied++;
                continue;
              }
              const cols = Object.keys(row);
              this.db
                .prepare(
                  `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
                )
                .run(...cols.map((c) => row[c] as never));
              for (const [f, h] of Object.entries(rowClocks))
                this.setClock(scope, entity, id, f, h, 0);
              applied++;
              continue;
            }
            // The same row on both devices: field by field, the most recent wins.
            const incoming = Object.fromEntries(
              Object.keys(fields).map((f) => [f, rowClocks[f] ?? fallback]),
            );
            const localFallback = hlcFromIso(String(local.updated_at), this.device);
            const changed = this.mergeFields(
              scope,
              entity,
              id,
              fields,
              fallback,
              peer,
              0,
              peer,
              Number.MAX_SAFE_INTEGER,
              local,
              {
                local: localFallback,
                incoming,
              },
            );
            // Clocks written for every field (both devices then compare the same values).
            for (const f of Object.keys(fields)) {
              const winner =
                (incoming[f] ?? '') > (this.getClock(scope, entity, id, f)?.hlc ?? localFallback)
                  ? incoming[f]!
                  : (this.getClock(scope, entity, id, f)?.hlc ?? localFallback);
              this.setClock(scope, entity, id, f, winner, 0);
            }
            if (changed) {
              this.touch(table, id, String(row.updated_at));
              applied++;
            }
          }
        }
      }
      // Settings: the most recent wins (a setting never changed: the other device's if replacing).
      for (const [scope, keys] of Object.entries(remote.settings)) {
        const allowed = this.options.settings?.keys()[scope] ?? [];
        for (const [key, s] of Object.entries(keys)) {
          if (!allowed.includes(key)) continue;
          const mine = this.getClock('core', 'settings', scope, key)?.hlc ?? '';
          if (mode === 'replace' || (s.hlc ?? '') > mine) {
            this.options.settings!.write(scope, key, s.value);
            if (s.hlc) this.setClock('core', 'settings', scope, key, s.hlc, 0);
          }
        }
      }
      this.runDuplicates();
      this.detectNames(peer);
    })();
    return { applied, skipped: 0, conflicts: this.conflictsAdded };
  }

  // --- Conflicts ---------------------------------------------------------------------

  conflicts(includeResolved = false): ConflictRow[] {
    return this.db
      .prepare(
        `SELECT * FROM core__sync_conflicts ${includeResolved ? '' : 'WHERE resolved_at IS NULL'} ORDER BY created_at DESC, id`,
      )
      .all() as ConflictRow[];
  }

  resolveConflict(id: string, resolution: string) {
    this.db
      .prepare(
        'UPDATE core__sync_conflicts SET resolved_at = ?, resolution = ? WHERE id = ? AND resolved_at IS NULL',
      )
      .run(new Date(this.options.now?.() ?? Date.now()).toISOString(), resolution, id);
  }

  conflict(id: string): ConflictRow | null {
    return (
      (this.db.prepare('SELECT * FROM core__sync_conflicts WHERE id = ?').get(id) as
        ConflictRow | undefined) ?? null
    );
  }

  /** The merge a name conflict offers (the module's own route), or null. */
  mergeFor(c: ConflictRow): { scope: string; route: string; body: unknown } | null {
    if (c.kind !== 'name' || !c.other_id) return null;
    const [scope, entity] = c.entity.split('/');
    const n = this.modules.get(scope!)?.sync.names?.find((x) => x.table === entity);
    if (!n?.merge) return null;
    // The second one goes into the first (the oldest, kept).
    return { scope: scope!, route: n.merge.route, body: n.merge.body(c.other_id, c.row_id) };
  }
}

/** Two bases' versions: the same, or which device has to update. */
export function compareVersions(
  mine: Record<string, number>,
  theirs: Record<string, number>,
): 'same' | 'mine-older' | 'theirs-older' | 'mixed' {
  let older = false;
  let newer = false;
  for (const scope of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const a = mine[scope] ?? 0;
    const b = theirs[scope] ?? 0;
    if (a < b) older = true;
    if (a > b) newer = true;
  }
  if (older && newer) return 'mixed';
  if (older) return 'mine-older';
  if (newer) return 'theirs-older';
  return 'same';
}
