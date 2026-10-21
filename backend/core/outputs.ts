// Generated files of every module (videos, images…): one registry in the core,
// so that any of them can be listed, checked against the disk, sent to the
// Recycle Bin or forgotten from the interface, the same way for every module.
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  ModuleOutputs,
  OutputFilter,
  OutputRecord,
  OutputRemovedHandler,
} from '../../packages/sdk/backend';
import type { DatabaseHandle } from './database';
import type { HostAdapter } from './host';

interface OutputRow {
  id: number;
  module_id: string;
  ref: string;
  parent: string | null;
  subject: string | null;
  label: string;
  kind: string | null;
  file_path: string;
  created_at: string;
  missing_since: string | null;
}

/** Filter across modules (core routes); `moduleId` limits it to one module. */
export interface CoreOutputFilter extends OutputFilter {
  moduleId?: string;
  subject?: string;
  missing?: boolean;
}

/** Deleting needs an explicit target: an empty filter would mean « everything ». */
function assertNarrowed(filter: CoreOutputFilter): void {
  const { ids, refs, ref, parent, subject, missing } = filter;
  if (
    !ids &&
    !refs &&
    ref === undefined &&
    parent === undefined &&
    subject === undefined &&
    !missing
  ) {
    throw new Error('Suppression de fichiers générés sans critère : refusée');
  }
}

export class OutputStore {
  private readonly handlers = new Map<string, OutputRemovedHandler[]>();

  constructor(
    private readonly handle: DatabaseHandle,
    private readonly host: HostAdapter,
    private readonly mediaUrl: (file: string) => string,
  ) {}

  private toRecord(row: OutputRow): OutputRecord {
    const exists = existsSync(row.file_path);
    let url: string | null = null;
    if (exists) {
      try {
        url = this.mediaUrl(row.file_path);
      } catch {
        // Moved outside the hub's folders: listed, not playable.
      }
    }
    return {
      id: row.id,
      moduleId: row.module_id,
      ref: row.ref,
      parent: row.parent,
      subject: row.subject,
      label: row.label,
      kind: row.kind,
      path: row.file_path,
      fileName: path.basename(row.file_path),
      createdAt: row.created_at,
      exists,
      url,
    };
  }

  private rows(filter: CoreOutputFilter): OutputRow[] {
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, ...v: unknown[]) => {
      where.push(sql);
      values.push(...v);
    };
    if (filter.moduleId !== undefined) add('module_id = ?', filter.moduleId);
    if (filter.ids) add(`id IN (${filter.ids.map(() => '?').join(',') || 'NULL'})`, ...filter.ids);
    if (filter.refs) {
      add(`ref IN (${filter.refs.map(() => '?').join(',') || 'NULL'})`, ...filter.refs);
    }
    if (filter.ref !== undefined) add('ref = ?', filter.ref);
    if (filter.parent !== undefined) add('parent = ?', filter.parent);
    if (filter.subject !== undefined) add('subject = ?', filter.subject);
    const sql =
      'SELECT * FROM core__outputs' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY created_at DESC, id DESC';
    return this.handle.db.prepare(sql).all(...values) as OutputRow[];
  }

  register(moduleId: string, output: Parameters<ModuleOutputs['register']>[0]): OutputRecord {
    // Every generated element belongs to a project (docs/MODULES.md §5.13).
    if (typeof output.subject !== 'string' || output.subject.trim() === '') {
      throw new Error(
        `Fichier généré sans projet (subject manquant) : ${output.ref} — chaque élément doit être rattaché à un projet`,
      );
    }
    const file = path.resolve(output.path);
    this.handle.db
      .prepare(
        `INSERT INTO core__outputs (module_id, ref, parent, subject, label, kind, file_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (module_id, file_path) DO UPDATE SET ref = excluded.ref,
           parent = excluded.parent,
           subject = CASE WHEN core__outputs.subject_manual = 1 THEN core__outputs.subject
                          ELSE excluded.subject END,
           label = excluded.label,
           kind = excluded.kind, created_at = excluded.created_at, missing_since = NULL`,
      )
      .run(
        moduleId,
        output.ref,
        output.parent ?? null,
        output.subject,
        output.label,
        output.kind ?? null,
        file,
        output.createdAt ?? new Date().toISOString(),
      );
    const row = this.handle.db
      .prepare('SELECT * FROM core__outputs WHERE module_id = ? AND file_path = ?')
      .get(moduleId, file) as OutputRow;
    return this.toRecord(row);
  }

  /** Records matching the filter, with `exists` checked on disk right now. */
  list(filter: CoreOutputFilter = {}): OutputRecord[] {
    const records = this.rows(filter).map((row) => this.toRecord(row));
    return filter.missing ? records.filter((r) => !r.exists) : records;
  }

  /** Checks every file; remembers since when a file is missing. Returns the missing count. */
  sync(moduleId?: string): number {
    const now = new Date().toISOString();
    const mark = this.handle.db.prepare(
      'UPDATE core__outputs SET missing_since = ? WHERE id = ? AND missing_since IS NULL',
    );
    const clear = this.handle.db.prepare(
      'UPDATE core__outputs SET missing_since = NULL WHERE id = ? AND missing_since IS NOT NULL',
    );
    let missing = 0;
    for (const row of this.rows({ moduleId })) {
      if (existsSync(row.file_path)) {
        clear.run(row.id);
      } else {
        missing++;
        mark.run(now, row.id);
      }
    }
    return missing;
  }

  onRemoved(moduleId: string, handler: OutputRemovedHandler): void {
    this.handlers.set(moduleId, [...(this.handlers.get(moduleId) ?? []), handler]);
  }

  forgetModule(moduleId: string): void {
    this.handlers.delete(moduleId);
  }

  /**
   * Sends the files to the Recycle Bin (when they still exist), then forgets
   * the records and lets each owner module clean its own data.
   */
  async delete(filter: CoreOutputFilter): Promise<OutputRecord[]> {
    assertNarrowed(filter);
    const records = this.list(filter);
    const removed: OutputRecord[] = [];
    try {
      for (const record of records) {
        // The same file may be listed twice (e.g. re-registered): trash it once.
        if (existsSync(record.path)) await this.host.trashItem(record.path);
        removed.push(record);
      }
    } finally {
      this.drop(removed, 'deleted');
    }
    return removed;
  }

  /** Forgets the records without touching the files (« Retirer de la liste »). */
  forget(filter: CoreOutputFilter): OutputRecord[] {
    assertNarrowed(filter);
    const records = this.list(filter);
    this.drop(records, 'forgotten');
    return records;
  }

  private drop(records: OutputRecord[], reason: 'deleted' | 'forgotten'): void {
    if (records.length === 0) return;
    const remove = this.handle.db.prepare('DELETE FROM core__outputs WHERE id = ?');
    this.handle.db.transaction(() => records.forEach((r) => remove.run(r.id)))();
    const byModule = new Map<string, OutputRecord[]>();
    for (const record of records) {
      byModule.set(record.moduleId, [...(byModule.get(record.moduleId) ?? []), record]);
    }
    for (const [moduleId, list] of byModule) {
      for (const handler of this.handlers.get(moduleId) ?? []) handler(list, reason);
    }
  }

  forModule(moduleId: string): ModuleOutputs {
    return {
      register: (output) => this.register(moduleId, output),
      list: (filter = {}) => this.list({ ...filter, moduleId }),
      delete: async (filter) => (await this.delete({ ...filter, moduleId })).length,
      forget: (filter) => this.forget({ ...filter, moduleId }).length,
      onRemoved: (handler) => this.onRemoved(moduleId, handler),
      bySubject: (subject) => this.list({ subject }),
      deleteBySubject: async (subject) => (await this.delete({ subject })).length,
      orphans: (isKnown) => this.orphans(isKnown),
      attach: (ids, subject) => this.attach(ids, subject),
    };
  }

  /**
   * Records of every module without a project: no subject (made by an old
   * version), or a subject the caller does not know any more (deleted track).
   */
  orphans(isKnown: (subject: string) => boolean): OutputRecord[] {
    return this.list({}).filter((record) => record.subject === null || !isKnown(record.subject));
  }

  /** Attaches records to a project chosen by the user; kept when their module registers them again. */
  attach(ids: number[], subject: string): number {
    if (!subject.trim()) throw new Error('Projet manquant');
    const update = this.handle.db.prepare(
      'UPDATE core__outputs SET subject = ?, subject_manual = 1 WHERE id = ?',
    );
    return this.handle.db.transaction(() =>
      ids.reduce((count, id) => count + update.run(subject, id).changes, 0),
    )();
  }
}
