// v0.46.0: the Coffre's disk — registered once (Réglages › Coffre), found
// again by its identity wherever it is mounted, watched READ ONLY (the watch
// never writes on the disk: only a click of Thomas does). Also: what changed
// in the PC's files (another application may have changed them), seen by size
// and date, confirmed by the fingerprint. ADR 0055.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, newId, type ModuleContext, type SyncStore } from '@hub/sdk/core';
import { freeName } from '../shared/names';
import { hashFileChecked, listFiles, projectHash, type CopyOptions } from './copy';
import { DISK_FOLDER, IDENTITY_FILE, newIdentity, type DiskIdentity } from './disk-layout';
import type { Library } from './library';
import type { CopyRow, DiskRow, ItemRow } from './rows';
import { findDisk, readIdentity, spaceOf, splitVolume, volumeRoots } from './volumes';

export interface Tables {
  items: string;
  contexts: string;
  attributes: string;
  also: string;
  disks: string;
  copies: string;
  versions: string;
}

export interface CoffreDeps {
  ctx: ModuleContext;
  store: SyncStore;
  library: Library;
  t: Tables;
}

/** How often the disk is looked for (read only). */
export const WATCH_MS = 4000;

export interface DiskState {
  root: string | null;
  free: number | null;
  total: number | null;
  /** When the last look ended. */
  checkedAt: string | null;
}

/** The PC's file as last seen: a file (size, date), or a project (each file). */
type StatCache = { s: number; m: number } | { f: Record<string, [number, number, string]> };

export class DiskManager {
  state: DiskState = { root: null, free: null, total: null, checkedAt: null };
  private timer: ReturnType<typeof setInterval> | null = null;
  private looking: Promise<void> | null = null;
  private withdrawMedia: (() => void) | null = null;
  private mediaRoot: string | null = null;
  /** What runs on the disk now (one thing at a time). */
  busy: string | null = null;

  constructor(private readonly d: CoffreDeps) {}

  // --- The registered disk ---------------------------------------------------------

  disk(): DiskRow | null {
    return (
      (this.d.ctx.db
        .prepare(
          `SELECT * FROM ${this.d.t.disks} WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`,
        )
        .get() as DiskRow | undefined) ?? null
    );
  }

  /**
   * Réglages › Coffre › « Choisir… »: the folder Thomas chose. A folder that
   * already holds a known identity (or its ToolBox-Coffre) is recognised;
   * otherwise ToolBox creates « ToolBox-Coffre » there with a new identity.
   */
  async register(chosen: string, name: string): Promise<DiskRow> {
    if (!path.isAbsolute(chosen) || !existsSync(chosen) || !statSync(chosen).isDirectory())
      throw new HttpError(404, 'Dossier introuvable');
    const current = this.disk();
    let folder = chosen;
    let identity = await readIdentity(chosen);
    if (!identity) {
      const inner = path.join(chosen, DISK_FOLDER);
      identity = await readIdentity(inner);
      folder = inner;
    }
    if (identity) {
      if (current && current.id !== identity.id)
        throw new HttpError(
          409,
          `Un disque est déjà enregistré (« ${current.name} ») : un seul pour l'instant. « Oublier ce disque » d'abord.`,
        );
      const known = this.d.store.get<DiskRow>('disks', identity.id, true);
      if (!known)
        throw new HttpError(
          409,
          `Ce dossier est le coffre d'une autre installation (« ${identity.name} ») : utilise « Restaurer depuis un disque… ».`,
        );
      if (known.deleted_at) this.d.store.restore('disks', identity.id);
      const { rel } = splitVolume(folder, await volumeRoots());
      this.d.store.update('disks', identity.id, { rel_root: rel, last_root: folder });
      await this.lookAgain();
      return this.disk()!;
    }
    if (current)
      throw new HttpError(
        409,
        `Un disque est déjà enregistré (« ${current.name} ») : un seul pour l'instant. « Oublier ce disque » d'abord.`,
      );
    folder = path.join(chosen, DISK_FOLDER);
    if (existsSync(folder) && readdirSync(folder).length)
      throw new HttpError(
        409,
        `« ${folder} » existe déjà et n'est pas un coffre de ToolBox : choisis un autre dossier.`,
      );
    await mkdir(folder, { recursive: true });
    const fresh = newIdentity(name);
    await writeIdentity(folder, fresh);
    const { rel } = splitVolume(folder, await volumeRoots());
    this.d.store.create(
      'disks',
      {
        name: fresh.name,
        rel_root: rel,
        last_root: folder,
        last_update_at: null,
        last_update_json: null,
        last_verify_json: null,
      },
      fresh.id,
    );
    await this.lookAgain();
    return this.disk()!;
  }

  /** Forgets the disk on this PC (nothing is written or removed on the disk itself). */
  forget(): void {
    const disk = this.disk();
    if (!disk) return;
    this.d.store.remove('disks', disk.id);
    this.setRoot(null);
  }

  rename(name: string): DiskRow {
    const disk = this.disk();
    if (!disk) throw new HttpError(404, 'Aucun disque enregistré');
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!clean) throw new HttpError(400, 'Nom vide');
    // Written in the identity file at the next update (a write on the disk needs a click).
    return this.d.store.update<DiskRow>('disks', disk.id, { name: clean });
  }

  // --- Watching (read only) ----------------------------------------------------------

  start(): void {
    if (this.timer) return;
    void this.look();
    this.timer = setInterval(() => void this.look(), WATCH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setRoot(null);
  }

  /** One look for the disk (never writes on it). Concurrent calls share the same look. */
  look(): Promise<void> {
    if (!this.looking) {
      // Released when THIS look ends (a look may end before it is even stored).
      const current = this.lookOnce().finally(() => {
        if (this.looking === current) this.looking = null;
      });
      this.looking = current;
    }
    return this.looking;
  }

  /** A look that starts AFTER the one running (a disk just registered must be seen). */
  async lookAgain(): Promise<void> {
    await this.looking;
    await this.look();
  }

  private lookOnce(): Promise<void> {
    return (async () => {
      try {
        const disk = this.disk();
        const root = disk ? await findDisk(disk.id, disk.rel_root, disk.last_root) : null;
        const space = root ? await spaceOf(root) : null;
        this.setRoot(root);
        this.state = {
          root,
          free: space?.free ?? null,
          total: space?.total ?? null,
          checkedAt: new Date().toISOString(),
        };
        // Where it was seen (on the PC, in the database): the first place looked at next time.
        if (disk && root && root !== disk.last_root)
          this.d.store.update('disks', disk.id, { last_root: root });
      } catch (error) {
        this.d.ctx.logger.warn(`Recherche du disque : ${String(error)}`);
      }
    })();
  }

  private setRoot(root: string | null) {
    if (!root) this.state = { ...this.state, root: null, free: null, total: null };
    if (root === this.mediaRoot) return;
    this.withdrawMedia?.();
    this.withdrawMedia = null;
    this.mediaRoot = root;
    // The readers show an archived element from the disk: its files may be served.
    if (root) this.withdrawMedia = this.d.ctx.files.allowMediaRoot?.(root) ?? null;
  }

  /** The disk's folder now, or a clear refusal. */
  rootOrThrow(): string {
    const disk = this.disk();
    if (!disk)
      throw new HttpError(409, 'Aucun disque du coffre : Réglages › Coffre › Disque du coffre');
    if (!this.state.root) throw new HttpError(409, `Branche le disque « ${disk.name} »`);
    return this.state.root;
  }

  /** An absolute path on the disk from a relative one, refusing anything outside it. */
  abs(root: string, rel: string): string {
    const base = path.resolve(root);
    const target = path.resolve(base, ...rel.split('/'));
    if (target !== base && !target.startsWith(base + path.sep))
      throw new Error(`Chemin hors du coffre du disque : ${rel}`);
    return target;
  }

  /** A free place on the disk for `rel` (never replaces a file: « nom (2) »). */
  freeOnDisk(root: string, rel: string): string {
    const parts = rel.split('/');
    const name = parts.pop()!;
    const dir = this.abs(root, parts.join('/'));
    const taken = new Set(existsSync(dir) ? readdirSync(dir).map((n) => n.toLowerCase()) : []);
    return [...parts, freeName(name, (c) => taken.has(c.toLowerCase()))].join('/');
  }

  /** One operation on the disk at a time (an update, an archive, a verification…). */
  async exclusive<T>(what: string, run: () => Promise<T>): Promise<T> {
    if (this.busy) throw new HttpError(409, `Le disque est occupé : ${this.busy}`);
    this.busy = what;
    try {
      return await run();
    } finally {
      this.busy = null;
    }
  }

  // --- Copies (an element's current version on the disk) -------------------------------

  copyOf(itemId: string, diskId: string): CopyRow | null {
    return (
      (this.d.ctx.db
        .prepare(
          `SELECT * FROM ${this.d.t.copies} WHERE deleted_at IS NULL AND item_id = ? AND disk_id = ?`,
        )
        .get(itemId, diskId) as CopyRow | undefined) ?? null
    );
  }

  setCopy(itemId: string, diskId: string, fields: Partial<CopyRow>): CopyRow {
    const existing = this.copyOf(itemId, diskId);
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([k]) => !['id', 'created_at', 'updated_at'].includes(k)),
    ) as Record<string, string | number | null>;
    if (existing) return this.d.store.update<CopyRow>('copies', existing.id, clean);
    return this.d.store.create<CopyRow>('copies', {
      item_id: itemId,
      disk_id: diskId,
      rel_path: '',
      sha256: null,
      size: 0,
      copied_at: null,
      trashed_at: null,
      damaged_at: null,
      ...clean,
    });
  }

  // --- The PC's files: what changed -----------------------------------------------------

  /**
   * Looks at the PC's file of an element: unchanged (same size and date as last
   * time), or its new fingerprint (read again when size or date changed), or
   * « missing ». A project is looked at file by file.
   */
  async scanItem(
    row: ItemRow,
    options: CopyOptions = {},
  ): Promise<'unchanged' | 'missing' | { sha256: string; size: number; stat: StatCache }> {
    if (!row.rel_path || row.kind === 'link' || row.archived_at) return 'unchanged';
    const file = this.d.library.abs(row.rel_path);
    const s = await stat(file).catch(() => null);
    if (!s) return 'missing';
    const cache = row.stat_json ? (JSON.parse(row.stat_json) as StatCache) : null;
    if (!s.isDirectory()) {
      if (cache && 's' in cache && cache.s === s.size && cache.m === Math.round(s.mtimeMs))
        return 'unchanged';
      const sha256 = await hashFileChecked(file, options);
      return { sha256, size: s.size, stat: { s: s.size, m: Math.round(s.mtimeMs) } };
    }
    const known = cache && 'f' in cache ? cache.f : {};
    const f: Record<string, [number, number, string]> = {};
    let changed = !(cache && 'f' in cache);
    let size = 0;
    for (const rel of listFiles(file)) {
      const fs = await stat(path.join(file, ...rel.split('/')));
      const m = Math.round(fs.mtimeMs);
      const k = known[rel];
      if (k && k[0] === fs.size && k[1] === m) f[rel] = k;
      else {
        changed = true;
        f[rel] = [fs.size, m, await hashFileChecked(path.join(file, ...rel.split('/')), options)];
      }
      size += fs.size;
    }
    if (Object.keys(known).some((rel) => !(rel in f))) changed = true;
    if (!changed) return 'unchanged';
    const sha256 = projectHash(Object.entries(f).map(([rel, v]) => ({ rel, sha256: v[2] })));
    return { sha256, size, stat: { f } };
  }

  /**
   * Every element kept on the PC, looked at (startup, and before each update):
   * a changed file gets its new fingerprint (and becomes « pas encore sur le
   * disque » when the disk has another one). Writes only the PC's database.
   */
  async scanPc(options: CopyOptions = {}): Promise<{ changed: number; missing: string[] }> {
    const rows = this.d.ctx.db
      .prepare(
        `SELECT * FROM ${this.d.t.items} WHERE deleted_at IS NULL AND trashed_at IS NULL AND archived_at IS NULL AND kind != 'link' AND rel_path IS NOT NULL`,
      )
      .all() as ItemRow[];
    let changed = 0;
    const missing: string[] = [];
    for (const row of rows) {
      const r = await this.scanItem(row, options);
      if (r === 'missing') missing.push(row.id);
      else if (r !== 'unchanged') {
        const fields: Record<string, string | number> = { stat_json: JSON.stringify(r.stat) };
        if (r.sha256 !== row.sha256 || r.size !== row.size) {
          fields.sha256 = r.sha256;
          fields.size = r.size;
          changed++;
        }
        this.d.store.update('items', row.id, fields);
      }
    }
    return { changed, missing };
  }
}

/** Writes the identity file (temporary name, then in place). */
export async function writeIdentity(folder: string, identity: DiskIdentity): Promise<void> {
  const temp = path.join(folder, `${IDENTITY_FILE}.${newId()}.tmp`);
  await writeFile(temp, `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  await rename(temp, path.join(folder, IDENTITY_FILE));
}
