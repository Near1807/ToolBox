// v0.46.0: the disk's routes (/api/modules/coffre/disk…) and the status the
// pages show (witness, banner, gauges): computed from the database, never by
// writing on the disk.
import { HttpError, requestBody } from '@hub/sdk/core';
import { ejectDisk } from './eject';
import { buildPlan, runUpdate, type UpdateInput } from './update';
import { registerHistoryRoutes } from './history';
import type { DiskStatusDto, UpdateReport } from '../shared/types';
import { isInDiskTrash } from './disk-layout';
import type { CoffreDeps, DiskManager } from './disk';
import { countSteps, stateOf, stepOf, type Step } from './plan';
import type { CopyRow, ItemRow, VersionRow } from './rows';

/** After this long in the disk's Recycle Bin, ToolBox PROPOSES to erase (never alone). */
export const DISK_TRASH_DAYS = 30;
/** 1 Go as Windows counts it. */
export const GB = 1024 ** 3;

export const DISK_JOBS = ['disk-update', 'disk-verify', 'disk-restore'];

/** Every element that matters for a disk, with its copy there (or null). */
export function itemsWithCopies(
  d: CoffreDeps,
  diskId: string,
): { item: ItemRow; copy: CopyRow | null }[] {
  const items = d.ctx.db
    .prepare(
      `SELECT * FROM ${d.t.items} WHERE (deleted_at IS NULL OR id IN (SELECT item_id FROM ${d.t.copies} WHERE deleted_at IS NULL AND disk_id = ?))`,
    )
    .all(diskId) as ItemRow[];
  const copies = new Map(
    (
      d.ctx.db
        .prepare(`SELECT * FROM ${d.t.copies} WHERE deleted_at IS NULL AND disk_id = ?`)
        .all(diskId) as CopyRow[]
    ).map((c) => [c.item_id, c]),
  );
  return items.map((item) => ({ item, copy: copies.get(item.id) ?? null }));
}

export function versionsOf(d: CoffreDeps, diskId: string, itemId?: string): VersionRow[] {
  return d.ctx.db
    .prepare(
      `SELECT * FROM ${d.t.versions} WHERE deleted_at IS NULL AND disk_id = ?${itemId ? ' AND item_id = ?' : ''} ORDER BY saved_at DESC`,
    )
    .all(...(itemId ? [diskId, itemId] : [diskId])) as VersionRow[];
}

/** The steps of an update from the database (the detailed plan also reads the disk). */
export function quickSteps(d: CoffreDeps, diskId: string): Step[] {
  return itemsWithCopies(d, diskId)
    .map(({ item, copy }) => stepOf(item, copy))
    .filter((s): s is Step => s !== null);
}

export function quotaBytes(d: CoffreDeps): number {
  const gb = Number(d.ctx.settings.get<number>('historyQuotaGb') ?? 20);
  return Math.max(0.001, Number.isFinite(gb) ? gb : 20) * GB;
}

export function diskStatus(d: CoffreDeps, disk: DiskManager): DiskStatusDto {
  const row = disk.disk();
  const running = d.ctx.jobs
    .list()
    .find((j) => DISK_JOBS.includes(j.type) && (j.status === 'running' || j.status === 'queued'));
  const base: DiskStatusDto = {
    disk: row ? { id: row.id, name: row.name, lastRoot: row.last_root } : null,
    connected: Boolean(row && disk.state.root),
    root: row ? disk.state.root : null,
    free: disk.state.free,
    total: disk.state.total,
    lastUpdateAt: row?.last_update_at ?? null,
    lastUpdate: row?.last_update_json ? (JSON.parse(row.last_update_json) as UpdateReport) : null,
    busy: disk.busy,
    waitsFor: disk.waitsFor(),
    refuses: disk.refuses(),
    jobId: running?.id ?? null,
    pending: 0,
    archived: 0,
    counts: { copy: 0, update: 0, move: 0, trash: 0 },
    bytes: { current: 0, history: 0, trash: 0 },
    oldTrash: 0,
    quota: quotaBytes(d),
  };
  // Without a disk, everything kept on the PC only is « pas encore sur le disque ».
  const pairs = row
    ? itemsWithCopies(d, row.id)
    : (
        d.ctx.db.prepare(`SELECT * FROM ${d.t.items} WHERE deleted_at IS NULL`).all() as ItemRow[]
      ).map((item) => ({ item, copy: null }));
  const old = new Date(Date.now() - DISK_TRASH_DAYS * 86_400_000).toISOString();
  const steps: Step[] = [];
  for (const { item, copy } of pairs) {
    const state = stateOf(item, copy);
    if (state === 'pending') base.pending++;
    if (state === 'archived') base.archived++;
    if (row) {
      const step = stepOf(item, copy);
      if (step) steps.push(step);
    }
    if (copy) {
      if (isInDiskTrash(copy.rel_path)) {
        base.bytes.trash += copy.size;
        if (copy.trashed_at && copy.trashed_at < old) base.oldTrash++;
      } else base.bytes.current += copy.size;
    }
  }
  base.counts = countSteps(steps);
  if (row) base.bytes.history = versionsOf(d, row.id).reduce((s, v) => s + v.size, 0);
  return base;
}

export function registerDiskRoutes(d: CoffreDeps, disk: DiskManager): void {
  const { ctx } = d;
  ctx.routes.get('/disk', async (request) => {
    // « Regarder maintenant » (the page asks after a choice): one look, read only.
    if ((request.query as Record<string, string> | undefined)?.look === '1') await disk.lookAgain();
    return diskStatus(d, disk);
  });
  /** Réglages › Coffre › « Choisir… »: the folder chosen, and the disk's name. */
  ctx.routes.post('/disk/register', async (request) => {
    const b = requestBody(request);
    if (typeof b.path !== 'string') throw new HttpError(400, 'Dossier manquant');
    await disk.register(b.path, typeof b.name === 'string' ? b.name : '');
    return diskStatus(d, disk);
  });
  ctx.routes.patch('/disk', (request) => {
    const b = requestBody(request);
    if (typeof b.name === 'string') disk.rename(b.name);
    return diskStatus(d, disk);
  });
  // --- B / C: the plan and the update (one click) -------------------------------------

  /** The detailed plan (read only): what « Mettre à jour » will do, and the room. */
  ctx.routes.get('/disk/plan', async () => {
    await disk.lookAgain();
    // What changed on the PC first (only the PC's database is written).
    await disk.scanPc();
    return buildPlan(d, disk);
  });
  ctx.jobs.define<UpdateInput, UpdateReport>('disk-update', (job) => runUpdate(d, disk, job));
  /** « Mettre à jour » (the click): the update runs as a job (progress, « Annuler »). */
  ctx.routes.post('/disk/update', async () => {
    disk.rootOrThrow();
    if (disk.busy) throw new HttpError(409, `Le disque est occupé : ${disk.busy}`);
    const refused = disk.refuses();
    if (refused) throw new HttpError(409, refused);
    const waiting = disk.waitsFor();
    if (waiting)
      throw new HttpError(
        409,
        `Import en cours (${waiting}) : la mise à jour du disque sera possible à la fin`,
      );
    const running = diskStatus(d, disk).jobId;
    if (running) return { jobId: running };
    const job = ctx.jobs.enqueue('disk-update', {}, { title: 'Coffre : mise à jour du disque' });
    return { jobId: job.id };
  });
  ctx.routes.post('/disk/eject', async () => {
    const root = disk.rootOrThrow();
    if (disk.busy) throw new HttpError(409, `Le disque est occupé : ${disk.busy}`);
    const result = await ejectDisk(root);
    await disk.lookAgain();
    return result;
  });

  registerHistoryRoutes(d, disk);

  /** Forgets the disk on this PC: nothing written or removed on the disk. */
  ctx.routes.post('/disk/forget', () => {
    if (disk.busy) throw new HttpError(409, `Le disque est occupé : ${disk.busy}`);
    disk.forget();
    return diskStatus(d, disk);
  });
}
