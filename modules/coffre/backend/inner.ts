// v0.51.0 (Expérimental, ADR 0068): the files INSIDE a project, as last seen
// on the PC — path, name, type, size, date, fingerprint — its excluded paths
// apart (exclusions.ts). Built in the background when a project is put in the
// Coffre, refreshed at the start, at each periodic look and before an update
// of the disk: only the files whose size or date changed are read again. A
// derived index of THIS PC (rebuilt from the files, never synchronised): the
// search finds each file on its own, the disk is updated file by file.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ModuleContext } from '@hub/sdk/core';
import { fold } from '../shared/deduce';
import { extOf } from '../shared/kinds';
import { hashFileChecked, projectHash } from './copy';
import { parseChoices, walkProject, type ExcludedEntry, type ExclusionChoices } from './exclusions';
import type { Library } from './library';
import type { InnerFileRow, ItemRow } from './rows';

export interface RefreshResult {
  /** The project's folder is not there (a followed project moved or renamed). */
  missing: boolean;
  sha256: string | null;
  size: number;
  files: number;
  /** Files read again (new or changed) and gone. */
  read: number;
  removed: number;
  excluded: ExcludedEntry[];
}

/** Rows written per transaction (a big project never holds the database long). */
const BATCH = 500;

export class ProjectIndex {
  readonly table: string;
  private readonly textTable: string;
  /** One refresh per project at a time (a second call waits for the first). */
  private readonly running = new Map<string, Promise<RefreshResult>>();

  constructor(
    private readonly ctx: ModuleContext,
    private readonly library: Library,
  ) {
    this.table = ctx.db.table('inner_files');
    this.textTable = ctx.db.table('text');
  }

  /**
   * A project's folder on the PC: its real folder when it is followed in
   * place, else its folder in the Coffre (null: archived, or no folder).
   */
  rootOf(row: Pick<ItemRow, 'kind' | 'rel_path' | 'tracked_path' | 'archived_at'>): string | null {
    if (row.kind !== 'project' || row.archived_at) return null;
    if (row.tracked_path) return row.tracked_path;
    return row.rel_path ? this.library.abs(row.rel_path) : null;
  }

  choicesOf(row: Pick<ItemRow, 'exclusions_json'>): ExclusionChoices {
    return parseChoices(row.exclusions_json);
  }

  /** The indexed files of a project (sorted by path). */
  files(itemId: string): InnerFileRow[] {
    return this.ctx.db
      .prepare(`SELECT * FROM ${this.table} WHERE item_id = ? ORDER BY rel`)
      .all(itemId) as InnerFileRow[];
  }

  file(itemId: string, rel: string): InnerFileRow | null {
    return (
      (this.ctx.db
        .prepare(`SELECT * FROM ${this.table} WHERE item_id = ? AND rel = ?`)
        .get(itemId, rel) as InnerFileRow | undefined) ?? null
    );
  }

  count(itemId: string): number {
    return (
      (
        this.ctx.db
          .prepare(`SELECT COUNT(*) AS n FROM ${this.table} WHERE item_id = ?`)
          .get(itemId) as { n: number }
      ).n ?? 0
    );
  }

  /** The project's fingerprint from its index (the same formula as copy.ts projectHash). */
  hashOf(itemId: string): { sha256: string; size: number; files: number } {
    const rows = this.ctx.db
      .prepare(`SELECT rel, sha256, size FROM ${this.table} WHERE item_id = ?`)
      .all(itemId) as { rel: string; sha256: string; size: number }[];
    return {
      sha256: projectHash(rows),
      size: rows.reduce((s, r) => s + r.size, 0),
      files: rows.length,
    };
  }

  /**
   * Looks at the project's files now: the new or changed ones (size or date)
   * are read again, the gone ones leave the index (and their text). Never
   * writes in the project's folder.
   */
  refresh(
    row: ItemRow,
    options: { signal?: AbortSignal; onFile?: (n: number, rel: string) => void } = {},
  ): Promise<RefreshResult> {
    const known = this.running.get(row.id);
    if (known) return known;
    const run = this.refreshOnce(row, options).finally(() => this.running.delete(row.id));
    this.running.set(row.id, run);
    return run;
  }

  private async refreshOnce(
    row: ItemRow,
    options: { signal?: AbortSignal; onFile?: (n: number, rel: string) => void },
  ): Promise<RefreshResult> {
    const root = this.rootOf(row);
    const empty: RefreshResult = {
      missing: true,
      sha256: null,
      size: 0,
      files: 0,
      read: 0,
      removed: 0,
      excluded: [],
    };
    if (!root || !existsSync(root) || !statSync(root).isDirectory()) return empty;
    const walked = await walkProject(root, this.choicesOf(row), {
      signal: options.signal,
      measureExcluded: false,
    });
    const known = new Map(
      (
        this.ctx.db
          .prepare(`SELECT rel, size, mtime, sha256 FROM ${this.table} WHERE item_id = ?`)
          .all(row.id) as Pick<InnerFileRow, 'rel' | 'size' | 'mtime' | 'sha256'>[]
      ).map((r) => [r.rel, r]),
    );
    const changed: { rel: string; size: number; mtime: number; sha256: string }[] = [];
    let n = 0;
    for (const f of walked.files) {
      if (options.signal?.aborted) throw new Error('Annulée');
      const k = known.get(f.rel);
      known.delete(f.rel);
      options.onFile?.(++n, f.rel);
      if (k && k.size === f.size && k.mtime === f.mtime) continue;
      let sha256: string;
      try {
        sha256 = await hashFileChecked(path.join(root, ...f.rel.split('/')), {
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        // Gone between the listing and the reading (being written): seen at the next look.
        continue;
      }
      changed.push({ ...f, sha256 });
    }
    const removed = [...known.keys()];
    const upsert = this.ctx.db.prepare(
      `INSERT INTO ${this.table} (item_id, rel, name, ext, folded, size, mtime, sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (item_id, rel) DO UPDATE SET size = excluded.size, mtime = excluded.mtime,
         sha256 = excluded.sha256, name = excluded.name, ext = excluded.ext, folded = excluded.folded`,
    );
    const drop = this.ctx.db.prepare(`DELETE FROM ${this.table} WHERE item_id = ? AND rel = ?`);
    for (let i = 0; i < changed.length; i += BATCH)
      this.ctx.db.transaction(() => {
        for (const f of changed.slice(i, i + BATCH)) {
          const name = path.posix.basename(f.rel);
          upsert.run(row.id, f.rel, name, extOf(name), fold(f.rel), f.size, f.mtime, f.sha256);
        }
      });
    for (let i = 0; i < removed.length; i += BATCH)
      this.ctx.db.transaction(() => {
        for (const rel of removed.slice(i, i + BATCH)) {
          this.forgetText(row.id, rel);
          drop.run(row.id, rel);
        }
      });
    const h = this.hashOf(row.id);
    return {
      missing: false,
      sha256: h.sha256,
      size: h.size,
      files: h.files,
      read: changed.length,
      removed: removed.length,
      excluded: walked.excluded,
    };
  }

  /** Removes the text of one inner file from the search index (its rows, kept as a range). */
  forgetText(itemId: string, rel: string): void {
    const r = this.ctx.db
      .prepare(`SELECT text_rows FROM ${this.table} WHERE item_id = ? AND rel = ?`)
      .get(itemId, rel) as { text_rows: string | null } | undefined;
    const range = parseRange(r?.text_rows ?? null);
    if (range)
      this.ctx.db
        .prepare(`DELETE FROM ${this.textTable} WHERE rowid BETWEEN ? AND ?`)
        .run(range[0], range[1]);
  }
}

/** « 12-40 » → [12, 40]. */
export function parseRange(text: string | null): [number, number] | null {
  const m = /^(\d+)-(\d+)$/.exec(text ?? '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}
