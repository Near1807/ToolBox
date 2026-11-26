// v0.47.0 (Expérimental): the search in the content (ADR 0056). The text of
// the elements, extracted in the background (low priority, one file at a
// time, interruptible, resumed at the next start: what is left is what has no
// state for its fingerprint), kept ON THE PC in an FTS5 index — insensitive to
// accents and case — so an archived element stays searchable with the disk
// unplugged. It only READS the Coffre's files and only WRITES this index (a
// derived table, rebuilt from the files: never synchronised).
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ModuleContext } from '@hub/sdk/core';
import { fold } from '../shared/deduce';
import type { IndexStatusDto } from '../shared/types';
import { readable, yieldNow, type ExtractStatus } from './extract';
import { ExtractPool } from './extract-pool';
import { parseRange } from './inner';
import type { InnerFileRow, ItemRow } from './rows';

export const TEXT_MIGRATION_SQL = (text: string, state: string) => `
  CREATE VIRTUAL TABLE ${text} USING fts5(
    item_id UNINDEXED,
    part UNINDEXED,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TABLE ${state} (
    item_id TEXT PRIMARY KEY,
    sha256 TEXT,
    status TEXT NOT NULL,
    parts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    extracted_at TEXT NOT NULL
  );
`;

/** One part found: its element, its page (or file), the extract with the words marked. */
export interface TextHit {
  /** v0.51.0: its row (the line of a file inside a project is found from it). */
  rowid: number;
  itemId: string;
  part: string;
  snippet: string;
  rank: number;
}

/** The marks around a found word in an extract (the page turns them into <mark>). */
export const MARK_OPEN = '\u0001';
export const MARK_CLOSE = '\u0002';

/** « électri thermo » → `"electri"* AND "thermo"*` (each word, its beginning). */
export function ftsQuery(query: string): string | null {
  const words = fold(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 12);
  if (!words.length) return null;
  return words.map((w) => `"${w.replace(/"/g, '')}"*`).join(' AND ');
}

interface Options {
  ctx: ModuleContext;
  items: string;
  /** The file of an element: on the PC, or on the disk for an archived one (null: absent). */
  fileOf: (row: ItemRow) => string | null;
  /** v0.51.0: a project's folder on the PC (null: archived, not found). */
  projectRootOf: (row: ItemRow) => string | null;
}

/** v0.51.0: a file inside a project heavier than this is not read for the search. */
const MAX_INNER_BYTES = 50 * 1024 * 1024;

/** v0.51.0: the part of a file inside a project: « src/main.py », « doc/cours.pdf#3 ». */
export const innerPart = (rel: string, part: string) => (part ? `${rel}#${part}` : rel);
/** « doc/cours.pdf#3 » → { rel, page: '3' }. */
export function splitInnerPart(part: string): { rel: string; page: string } {
  const i = part.lastIndexOf('#');
  return i > 0 && /^\d+$/.test(part.slice(i + 1))
    ? { rel: part.slice(0, i), page: part.slice(i + 1) }
    : { rel: part, page: '' };
}

type InnerPending = InnerFileRow & { project: ItemRow };

export class TextIndex {
  private readonly text: string;
  private readonly state: string;
  private readonly inner: string;
  private readonly ctx: ModuleContext;
  private running: Promise<void> | null = null;
  private signal = { stopped: false };
  private again = false;
  private current: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** v0.47.1: the worker thread that reads the texts (a maximum time per file). */
  readonly pool = new ExtractPool();
  /** A file « trop long » is read again once per start (after this moment). */
  private readonly startedAt = new Date().toISOString();
  /** Pause between two files (low priority); the tests' measures set it to 0. */
  pauseMs = Number(process.env.TOOLBOX_COFFRE_INDEX_PAUSE_MS ?? 30);

  constructor(private readonly o: Options) {
    this.ctx = o.ctx;
    this.text = o.ctx.db.table('text');
    this.state = o.ctx.db.table('text_state');
    this.inner = o.ctx.db.table('inner_files');
    this.forgetWholeProjects();
  }

  /**
   * v0.51.0: a project's text is now read FILE BY FILE (its index, inner.ts):
   * the text a v0.50 project kept as a whole leaves the index (derived, read again).
   */
  private forgetWholeProjects(): void {
    const old = `SELECT s.item_id FROM ${this.state} s JOIN ${this.o.items} i ON i.id = s.item_id WHERE i.kind = 'project'`;
    const n = (this.ctx.db.prepare(`SELECT COUNT(*) AS n FROM (${old})`).get() as { n: number }).n;
    if (!n) return;
    this.ctx.db.transaction(() => {
      this.ctx.db.prepare(`DELETE FROM ${this.text} WHERE item_id IN (${old})`).run();
      this.ctx.db.prepare(`DELETE FROM ${this.state} WHERE item_id IN (${old})`).run();
    });
  }

  /** v0.51.0: the files inside projects whose text is not the one of their fingerprint. */
  private pendingInner(limit = 50): InnerPending[] {
    const rows = this.ctx.db
      .prepare(
        `SELECT f.*, i.id AS p_id FROM ${this.inner} f JOIN ${this.o.items} i ON i.id = f.item_id
         WHERE i.deleted_at IS NULL AND i.trashed_at IS NULL AND i.archived_at IS NULL
           AND (f.text_sha IS NOT f.sha256 OR (f.text_status = 'toolong' AND f.text_at < ?))
         LIMIT ?`,
      )
      .all(this.startedAt, limit) as (InnerFileRow & { p_id: string })[];
    const projects = new Map<string, ItemRow>();
    return rows.flatMap((r) => {
      let p = projects.get(r.p_id);
      if (!p) {
        p = this.ctx.db
          .prepare(`SELECT * FROM ${this.o.items} WHERE id = ?`)
          .get(r.p_id) as ItemRow;
        projects.set(r.p_id, p);
      }
      return p ? [{ ...r, project: p }] : [];
    });
  }

  /** The elements whose text is not (or no longer) the one of their fingerprint. */
  private pendingRows(limit = 50): ItemRow[] {
    return this.ctx.db
      .prepare(
        `SELECT i.* FROM ${this.o.items} i LEFT JOIN ${this.state} s ON s.item_id = i.id
         WHERE i.deleted_at IS NULL AND i.trashed_at IS NULL AND i.kind = 'file'
           AND i.sha256 IS NOT NULL AND (s.item_id IS NULL OR s.sha256 IS NOT i.sha256
             OR (s.status = 'toolong' AND s.extracted_at < ?))
         ORDER BY i.updated_at DESC LIMIT ?`,
      )
      .all(this.startedAt, limit) as ItemRow[];
  }

  status(): IndexStatusDto {
    const count = (sql: string) =>
      (this.ctx.db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0;
    const live = `i.deleted_at IS NULL AND i.trashed_at IS NULL AND i.kind = 'file' AND i.sha256 IS NOT NULL`;
    // v0.51.0: the files inside the projects count one by one (archived ones apart).
    const liveInner = `FROM ${this.inner} f JOIN ${this.o.items} i ON i.id = f.item_id WHERE i.deleted_at IS NULL AND i.trashed_at IS NULL AND i.archived_at IS NULL`;
    const total =
      count(`SELECT COUNT(*) AS n FROM ${this.o.items} i WHERE ${live}`) +
      count(`SELECT COUNT(*) AS n ${liveInner}`);
    const done =
      count(
        `SELECT COUNT(*) AS n FROM ${this.o.items} i JOIN ${this.state} s ON s.item_id = i.id AND s.sha256 IS i.sha256 WHERE ${live}`,
      ) + count(`SELECT COUNT(*) AS n ${liveInner} AND f.text_sha IS f.sha256`);
    const by = (status: ExtractStatus) =>
      count(
        `SELECT COUNT(*) AS n FROM ${this.o.items} i JOIN ${this.state} s ON s.item_id = i.id AND s.sha256 IS i.sha256 WHERE ${live} AND s.status = '${status}'`,
      ) +
      count(
        `SELECT COUNT(*) AS n ${liveInner} AND f.text_sha IS f.sha256 AND f.text_status = '${status}'`,
      );
    return {
      total,
      done,
      pending: total - done,
      withText: by('ok'),
      noText: by('notext'),
      errors: by('error') + by('toolong') + by('toobig'),
      running: this.running !== null,
    };
  }

  /** The state of one element (« pas de texte » on its sheet). */
  stateOf(itemId: string): ExtractStatus | null {
    const row = this.ctx.db
      .prepare(
        `SELECT s.status FROM ${this.state} s JOIN ${this.o.items} i ON i.id = s.item_id WHERE s.item_id = ? AND s.sha256 IS i.sha256`,
      )
      .get(itemId) as { status: ExtractStatus } | undefined;
    return row?.status ?? null;
  }

  /** Starts (or restarts later) the extraction of what is left; returns at once. */
  kick(delayMs = 0): void {
    if (this.signal.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.loop().finally(() => {
        this.running = null;
        if (this.again && !this.signal.stopped) {
          this.again = false;
          this.kick();
        }
      });
    }, delayMs);
    this.timer.unref?.();
  }

  /** Waits for the extraction to be done (tests). */
  async idle(): Promise<void> {
    while (this.running || this.timer || this.again) {
      if (this.running) await this.running;
      else await yieldNow(5);
    }
  }

  /** Interrupts (shutdown): the element in progress is redone at the next start. */
  async stop(): Promise<void> {
    this.signal.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.pool.stop();
    await this.running?.catch(() => undefined);
  }

  /** What is being read now (the health zone). */
  get reading(): string | null {
    return this.current;
  }

  private async loop(): Promise<void> {
    await this.loopItems();
    await this.loopInner();
  }

  /** v0.51.0: the files inside the projects, one by one (only the changed ones). */
  private async loopInner(): Promise<void> {
    const skipped = new Set<string>();
    for (;;) {
      const rows = this.pendingInner().filter((r) => !skipped.has(`${r.item_id}\0${r.rel}`));
      if (!rows.length) return;
      for (const f of rows) {
        if (this.signal.stopped) return;
        const root = this.o.projectRootOf(f.project);
        const file = root ? path.join(root, ...f.rel.split('/')) : null;
        if (!file || !existsSync(file)) {
          skipped.add(`${f.item_id}\0${f.rel}`);
          continue;
        }
        this.current = `${f.project.name}/${f.rel}`;
        try {
          const r = !readable(f.ext)
            ? { status: 'unsupported' as const, parts: [] }
            : f.size > MAX_INNER_BYTES
              ? { status: 'toobig' as const, parts: [] }
              : await this.pool.run(file, f.ext);
          if (this.signal.stopped) return;
          this.writeInner(f, r.status, r.parts);
        } catch (error) {
          if (this.signal.stopped) return;
          this.writeInner(f, 'error', []);
          this.ctx.logger.warn(`Texte de « ${f.rel} » : ${String(error)}`);
        } finally {
          this.current = null;
        }
        await yieldNow(this.pauseMs);
      }
    }
  }

  private writeInner(
    f: InnerFileRow,
    status: ExtractStatus,
    parts: { part: string; text: string }[],
  ): void {
    const now = this.ctx.db
      .prepare(`SELECT sha256, text_rows FROM ${this.inner} WHERE item_id = ? AND rel = ?`)
      .get(f.item_id, f.rel) as { sha256: string; text_rows: string | null } | undefined;
    // Changed (or gone) while it was read: read again later.
    if (!now || now.sha256 !== f.sha256) return;
    this.ctx.db.transaction(() => {
      const old = parseRange(now.text_rows);
      if (old)
        this.ctx.db
          .prepare(`DELETE FROM ${this.text} WHERE rowid BETWEEN ? AND ?`)
          .run(old[0], old[1]);
      const insert = this.ctx.db.prepare(
        `INSERT INTO ${this.text} (item_id, part, body) VALUES (?, ?, ?)`,
      );
      let first: number | null = null;
      let last: number | null = null;
      for (const p of parts) {
        const id = Number(insert.run(f.item_id, innerPart(f.rel, p.part), p.text).lastInsertRowid);
        first ??= id;
        last = id;
      }
      this.ctx.db
        .prepare(
          `UPDATE ${this.inner} SET text_sha = ?, text_status = ?, text_rows = ?, text_at = ? WHERE item_id = ? AND rel = ?`,
        )
        .run(
          f.sha256,
          status,
          first !== null ? `${first}-${last}` : null,
          new Date().toISOString(),
          f.item_id,
          f.rel,
        );
    });
  }

  private async loopItems(): Promise<void> {
    const skipped = new Set<string>();
    for (;;) {
      const rows = this.pendingRows().filter((r) => !skipped.has(r.id));
      if (!rows.length) return;
      for (const row of rows) {
        if (this.signal.stopped) return;
        const file = this.o.fileOf(row);
        // Archived with the disk unplugged: later, when it is there.
        if (!file || !existsSync(file)) {
          skipped.add(row.id);
          continue;
        }
        this.current = row.name;
        try {
          // v0.47.1: read in the worker thread (the server's thread stays free).
          const r = readable(row.ext)
            ? await this.pool.run(file, row.ext)
            : { status: 'unsupported' as const, parts: [] };
          if (this.signal.stopped) return;
          if (r.error) this.ctx.logger.warn(`Texte de « ${row.name} » illisible : ${r.error}`);
          this.write(row, r.status, r.parts, r.error ?? null);
        } catch (error) {
          if (this.signal.stopped) return;
          this.ctx.logger.warn(`Texte de « ${row.name} » : ${String(error)}`);
          this.write(row, 'error', [], String(error));
        } finally {
          this.current = null;
        }
        await yieldNow(this.pauseMs);
      }
    }
  }

  private write(
    row: ItemRow,
    status: ExtractStatus,
    parts: { part: string; text: string }[],
    error: string | null,
  ): void {
    // The element may have changed while it was read: its fingerprint now decides.
    const now = this.ctx.db
      .prepare(`SELECT sha256 FROM ${this.o.items} WHERE id = ?`)
      .get(row.id) as { sha256: string | null } | undefined;
    if (!now || now.sha256 !== row.sha256) return;
    this.ctx.db.transaction(() => {
      this.ctx.db.prepare(`DELETE FROM ${this.text} WHERE item_id = ?`).run(row.id);
      const insert = this.ctx.db.prepare(
        `INSERT INTO ${this.text} (item_id, part, body) VALUES (?, ?, ?)`,
      );
      for (const p of parts) insert.run(row.id, p.part, p.text);
      this.ctx.db
        .prepare(
          `INSERT INTO ${this.state} (item_id, sha256, status, parts, error, extracted_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (item_id) DO UPDATE SET sha256 = excluded.sha256, status = excluded.status, parts = excluded.parts, error = excluded.error, extracted_at = excluded.extracted_at`,
        )
        .run(row.id, row.sha256, status, parts.length, error, new Date().toISOString());
    });
  }

  /**
   * The parts that hold every word (by relevance), at most `limit`. An erased
   * element's text is not returned (its rows are left for a later cleanup).
   */
  search(query: string, limit = 400): TextHit[] {
    const match = ftsQuery(query);
    if (!match) return [];
    try {
      return this.ctx.db
        .prepare(
          `SELECT t.rowid AS rowid, t.item_id AS itemId, t.part AS part,
                  snippet(${this.text}, 2, '${MARK_OPEN}', '${MARK_CLOSE}', '…', 14) AS snippet,
                  bm25(${this.text}) AS rank
           FROM ${this.text} t
           WHERE ${this.text} MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(match, limit) as TextHit[];
    } catch (error) {
      this.ctx.logger.warn(`Recherche « ${query} » : ${String(error)}`);
      return [];
    }
  }

  /**
   * v0.51.0: the first line (1-based) of a part holding the query's first
   * word, or null (the editor is opened at it).
   */
  lineOf(rowid: number, query: string): number | null {
    const word = fold(query)
      .split(/[^\p{L}\p{N}]+/u)
      .find((w) => w.length > 0);
    if (!word) return null;
    const row = this.ctx.db.prepare(`SELECT body FROM ${this.text} WHERE rowid = ?`).get(rowid) as
      { body: string } | undefined;
    if (!row) return null;
    const lines = row.body.split('\n');
    const at = lines.findIndex((l) => fold(l).includes(word));
    return at >= 0 ? at + 1 : null;
  }

  /** The pages of one element holding the words (the reader's « page suivante »). */
  partsOf(itemId: string, query: string): string[] {
    const match = ftsQuery(query);
    if (!match) return [];
    const rows = this.ctx.db
      .prepare(`SELECT part FROM ${this.text} WHERE item_id = ? AND ${this.text} MATCH ?`)
      .all(itemId, match) as { part: string }[];
    return rows.map((r) => r.part);
  }

  /** Forgets the text of erased elements (a derived index: rebuilt from the files). */
  forgetErased(): void {
    this.ctx.db.transaction(() => {
      const gone = `SELECT item_id FROM ${this.state} WHERE item_id NOT IN (SELECT id FROM ${this.o.items} WHERE deleted_at IS NULL)`;
      this.ctx.db.prepare(`DELETE FROM ${this.text} WHERE item_id IN (${gone})`).run();
      this.ctx.db.prepare(`DELETE FROM ${this.state} WHERE item_id IN (${gone})`).run();
    });
  }
}
