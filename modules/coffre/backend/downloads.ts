// v0.47.0 (Expérimental, DÉSACTIVÉE par défaut): « Proposer de ranger mes
// nouveaux téléchargements » (ADR 0060). Reads the Downloads folder (top
// level), never writes, never moves nor deletes anything there. Only files
// arrived AFTER the activation count (a snapshot of what is there is taken
// when it is switched on); a file being downloaded (.crdownload, .part, .tmp,
// .download) is ignored; a file counts once its size and date have stayed the
// same for a few seconds; a file already in the Coffre (same fingerprint) is
// left out. Nothing is put away alone: a counter, then « Ranger » (the
// rangement window) or « Ignorer ». A Windows notification only when its own
// setting is on (off by default).
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ModuleContext } from '@hub/sdk/core';
import type { DownloadDto, DownloadsDto } from '../shared/types';
import { hashFile } from './library';

export const DOWNLOADS_MIGRATION_SQL = (table: string) => `
  CREATE TABLE ${table} (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    status TEXT NOT NULL,
    stable_since INTEGER NOT NULL,
    sha256 TEXT,
    changed_at TEXT NOT NULL
  );
`;

/** Files still being downloaded (browsers' temporary names), and Windows' own files. */
const PARTIAL = /\.(crdownload|part|partial|tmp|download|opdownload|!ut)$/i;
const SYSTEM = /^(desktop\.ini|thumbs\.db|\.ds_store)$|^~\$|^\./i;

/** How long a new file must keep its size and date before it is proposed. */
const STABLE_MS = Number(process.env.TOOLBOX_COFFRE_STABLE_MS ?? 3000);
const POLL_MS = 3000;

type Status =
  /** There when the watching was switched on: never proposed (unless asked). */
  | 'baseline'
  /** New, still changing (or just seen). */
  | 'waiting'
  /** New and stable: proposed. */
  | 'pending'
  | 'ignored'
  /** Already in the Coffre (same fingerprint). */
  | 'known'
  | 'ranged';

interface Row {
  path: string;
  name: string;
  size: number;
  mtime_ms: number;
  status: Status;
  stable_since: number;
  sha256: string | null;
}

export class DownloadWatcher {
  private readonly table: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly ctx: ModuleContext,
    /** Is this fingerprint already in the Coffre? */
    private readonly known: (sha256: string) => boolean,
  ) {
    this.table = ctx.db.table('downloads');
  }

  enabled(): boolean {
    return this.ctx.settings.get<boolean>('watchDownloads') === true;
  }

  /** The watched folder: the one chosen, else the user's « Téléchargements ». */
  folder(): string {
    const chosen = this.ctx.settings.get<string>('downloadsFolder');
    return chosen && path.isAbsolute(chosen) ? chosen : path.join(homedir(), 'Downloads');
  }

  /** The files directly in the folder (no sub-folder), what they are now. */
  private list(): { path: string; name: string; size: number; mtime: number }[] {
    const dir = this.folder();
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    const out: { path: string; name: string; size: number; mtime: number }[] = [];
    for (const name of names) {
      if (SYSTEM.test(name)) continue;
      const full = path.join(dir, name);
      try {
        const s = statSync(full);
        if (s.isFile()) out.push({ path: full, name, size: s.size, mtime: Math.round(s.mtimeMs) });
      } catch {
        // Gone meanwhile.
      }
    }
    return out;
  }

  private rows(): Map<string, Row> {
    const list = this.ctx.db.prepare(`SELECT * FROM ${this.table}`).all() as Row[];
    return new Map(list.map((r) => [r.path, r]));
  }

  private put(r: Row): void {
    this.ctx.db
      .prepare(
        `INSERT INTO ${this.table} (path, name, size, mtime_ms, status, stable_since, sha256, changed_at)
         VALUES (@path, @name, @size, @mtime_ms, @status, @stable_since, @sha256, @changed_at)
         ON CONFLICT (path) DO UPDATE SET name = excluded.name, size = excluded.size, mtime_ms = excluded.mtime_ms,
           status = excluded.status, stable_since = excluded.stable_since, sha256 = excluded.sha256, changed_at = excluded.changed_at`,
      )
      .run({ ...r, changed_at: new Date().toISOString() });
  }

  /**
   * Switched on (or the folder changed): what is in the folder now is the
   * « before » — never proposed. Files already followed keep their state.
   */
  snapshot(): void {
    const rows = this.rows();
    const now = Date.now();
    this.ctx.db.transaction(() => {
      for (const f of this.list())
        if (!rows.has(f.path))
          this.put({
            path: f.path,
            name: f.name,
            size: f.size,
            mtime_ms: f.mtime,
            status: 'baseline',
            stable_since: now,
            sha256: null,
          });
    });
  }

  /** Starts (or stops) following the setting. */
  start(): void {
    this.stopTimer();
    if (this.stopped || !this.enabled()) return;
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopTimer();
    await this.polling?.catch(() => undefined);
  }

  /** One look at the folder (read only). Concurrent calls share it. */
  poll(): Promise<void> {
    if (!this.enabled()) return Promise.resolve();
    this.polling ??= this.pollOnce().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private async pollOnce(): Promise<void> {
    const rows = this.rows();
    const files = this.list();
    const now = Date.now();
    const present = new Set(files.map((f) => f.path));
    let proposed = 0;
    for (const f of files) {
      if (this.stopped) return;
      if (PARTIAL.test(f.name)) continue;
      const r = rows.get(f.path);
      if (!r) {
        this.put({
          path: f.path,
          name: f.name,
          size: f.size,
          mtime_ms: f.mtime,
          status: 'waiting',
          stable_since: now,
          sha256: null,
        });
        continue;
      }
      const changed = r.size !== f.size || r.mtime_ms !== f.mtime;
      if (r.status !== 'waiting') {
        // Replaced by a new download of the same name: a new arrival.
        if (changed && r.status !== 'baseline')
          this.put({
            ...r,
            size: f.size,
            mtime_ms: f.mtime,
            status: 'waiting',
            stable_since: now,
            sha256: null,
          });
        continue;
      }
      if (changed) {
        this.put({ ...r, size: f.size, mtime_ms: f.mtime, stable_since: now });
        continue;
      }
      if (now - r.stable_since < STABLE_MS) continue;
      let sha: string;
      try {
        sha = await hashFile(f.path);
      } catch {
        continue; // Still locked by the browser: next time.
      }
      const known = this.known(sha);
      this.put({ ...r, status: known ? 'known' : 'pending', sha256: sha });
      if (!known) proposed++;
    }
    // Gone from the folder (renamed, moved, deleted by Thomas): forgotten.
    this.ctx.db.transaction(() => {
      for (const r of rows.values())
        if (!present.has(r.path) && r.status !== 'baseline')
          this.ctx.db.prepare(`DELETE FROM ${this.table} WHERE path = ?`).run(r.path);
    });
    if (proposed && this.ctx.settings.get<boolean>('notifyDownloads') === true) {
      const n = this.pendingRows().length;
      this.ctx.notifications.notify({
        title: 'Coffre',
        body:
          n > 1 ? `${n} nouveaux téléchargements à ranger` : '1 nouveau téléchargement à ranger',
        path: '',
      });
    }
  }

  private pendingRows(): Row[] {
    return this.ctx.db
      .prepare(`SELECT * FROM ${this.table} WHERE status = 'pending' ORDER BY mtime_ms DESC`)
      .all() as Row[];
  }

  private dto = (r: Row): DownloadDto => ({
    path: r.path,
    name: r.name,
    size: r.size,
    modifiedAt: new Date(r.mtime_ms).toISOString(),
  });

  status(): DownloadsDto {
    const enabled = this.enabled();
    const waiting = enabled
      ? ((
          this.ctx.db
            .prepare(`SELECT COUNT(*) AS n FROM ${this.table} WHERE status = 'waiting'`)
            .get() as { n: number }
        ).n ?? 0)
      : 0;
    return {
      enabled,
      folder: this.folder(),
      pending: enabled ? this.pendingRows().map(this.dto) : [],
      waiting,
    };
  }

  /** « Ignorer »: no longer proposed (the file is not touched). */
  ignore(paths: readonly string[]): void {
    this.ctx.db.transaction(() => {
      for (const p of paths)
        this.ctx.db
          .prepare(
            `UPDATE ${this.table} SET status = 'ignored', changed_at = ? WHERE path = ? AND status = 'pending'`,
          )
          .run(new Date().toISOString(), p);
    });
  }

  /** Put away (deposited): no longer proposed. */
  ranged(paths: readonly string[]): void {
    this.ctx.db.transaction(() => {
      for (const p of paths)
        this.ctx.db
          .prepare(`UPDATE ${this.table} SET status = 'ranged', changed_at = ? WHERE path = ?`)
          .run(new Date().toISOString(), p);
    });
  }

  /** « Proposer aussi les fichiers déjà présents »: those of before, still there (a choice, once). */
  existing(): DownloadDto[] {
    const rows = this.ctx.db
      .prepare(`SELECT * FROM ${this.table} WHERE status = 'baseline' ORDER BY mtime_ms DESC`)
      .all() as Row[];
    const present = new Set(this.list().map((f) => f.path));
    return rows.filter((r) => present.has(r.path)).map(this.dto);
  }
}
