// v0.46.0: « Mettre à jour » — the disk receives what the PC has, by ONE
// click, never alone (ADR 0055). Order: look at the PC's files, plan, check
// the room BEFORE writing, then moves (in two steps), copies (temporary name,
// forced to the medium, read back, put in place), history, quota, and at the
// end the database, the sheets and the manifest. A cancellation or an
// unplugged disk leaves the disk consistent: what was put in place is valid
// and recorded, the rest is done at the next update.
import { existsSync, readdirSync, rmdirSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, newId, type JobRunContext } from '@hub/sdk/core';
import type { UpdateReport } from '../shared/types';
import { Cancelled, copyVerified, place, VerifyError } from './copy';
import {
  BASE_DIR,
  baseName,
  DAMAGED_DIR,
  DISK_TRASH_DIR,
  HISTORY_DIR,
  historyPath,
  isInDiskTrash,
  MOVING_DIR,
  quotaPlan,
  stamp,
  SYSTEM_FOLDER,
  TMP_DIR,
  type DiskIdentity,
} from './disk-layout';
import { writeIdentity, type CoffreDeps, type DiskManager } from './disk';
import { itemsWithCopies, quotaBytes, versionsOf } from './disk-routes';
import { countSteps, stepOf, type Step } from './plan';
import type { DiskRow, ItemRow, VersionRow } from './rows';
import { readIdentity } from './volumes';

/** The disk is not there any more (or another one took its place): nothing more is written. */
export class DiskGone extends Error {
  constructor(name: string) {
    super(`Le disque « ${name} » n'est plus là`);
    this.name = 'DiskGone';
  }
}

/** Room kept free on the disk beyond what the copies need. */
export const MARGIN = 64 * 1024 * 1024;

export interface PlanDto {
  steps: Step[];
  counts: ReturnType<typeof countSteps>;
  /** Bytes the copies will write. */
  needed: number;
  free: number | null;
  enough: boolean;
  problems: { itemId: string; name: string; reason: string }[];
}

/** An error that means the disk went away (unplugged, sleeping, read-only…). */
export function diskGone(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return [
    'ENOENT',
    'EIO',
    'ENODEV',
    'ENXIO',
    'EROFS',
    'EACCES',
    'EPERM',
    'EBUSY',
    'ENOSPC',
  ].includes(code ?? '');
}

/**
 * The detailed plan: from the database, and the disk looked at (a copy whose
 * file is gone is copied again). Read only.
 */
export async function buildPlan(d: CoffreDeps, disk: DiskManager): Promise<PlanDto> {
  const row = disk.disk();
  const root = disk.rootOrThrow();
  const steps: Step[] = [];
  const problems: PlanDto['problems'] = [];
  for (const { item, copy } of itemsWithCopies(d, row!.id)) {
    let present = true;
    if (copy) present = existsSync(disk.abs(root, copy.rel_path));
    const step = stepOf(item, copy, present);
    // An archived element whose disk copy is gone: nothing can bring it back.
    if (item.archived_at && copy && !present)
      problems.push({ itemId: item.id, name: item.name, reason: 'manquant sur le disque' });
    if (!step) continue;
    if (
      (step.kind === 'copy' || step.kind === 'update' || step.kind === 'repair') &&
      item.rel_path
    ) {
      if (!existsSync(d.library.abs(item.rel_path))) {
        problems.push({
          itemId: item.id,
          name: item.name,
          reason: 'introuvable sur le PC (déplacé ou supprimé hors de ToolBox)',
        });
        continue;
      }
    }
    steps.push(step);
  }
  const needed = steps.reduce((s, x) => s + x.size, 0);
  const free = disk.state.free;
  return {
    steps,
    counts: countSteps(steps),
    needed,
    free,
    enough: free === null || needed + MARGIN <= free,
    problems,
  };
}

export interface UpdateInput {
  /** Set by the route: the plan Thomas saw (its counts, to tell him if it changed). */
  seen?: { copy: number; update: number; move: number; trash: number };
}

/** The job « disk-update ». */
export async function runUpdate(
  d: CoffreDeps,
  disk: DiskManager,
  job: JobRunContext<UpdateInput>,
): Promise<UpdateReport> {
  return disk.exclusive('mise à jour du disque', async () => {
    const row = disk.disk()!;
    const root = disk.rootOrThrow();
    const report: UpdateReport = {
      at: new Date().toISOString(),
      copied: 0,
      updated: 0,
      moved: 0,
      trashed: 0,
      repaired: 0,
      removedVersions: 0,
      oversized: [],
      problems: [],
      stopped: null,
    };
    const signal = job.signal;
    // Before each step and each « put in place »: still THIS disk (unplugged, or another
    // disk now on the same letter: nothing is written, not even a folder).
    const still = async () => {
      if ((await readIdentity(root))?.id !== row.id) throw new DiskGone(row.name);
    };
    const save = () =>
      d.store.update<DiskRow>('disks', row.id, {
        last_update_json: JSON.stringify(report),
        ...(report.stopped ? {} : { last_update_at: report.at }),
      });
    try {
      // The disk must be the one registered (its identity read now).
      if ((await readIdentity(root))?.id !== row.id)
        throw new HttpError(409, `Ce n'est plus le disque « ${row.name} »`);
      job.progress(null, 'Regarde les fichiers du PC…');
      await disk.scanPc({ signal });
      const plan = await buildPlan(d, disk);
      report.problems.push(...plan.problems);
      // Room checked BEFORE anything is written.
      if (!plan.enough)
        throw new HttpError(
          409,
          `Pas assez de place sur le disque : il faut ${gb(plan.needed + MARGIN)}, il reste ${gb(plan.free ?? 0)}. Rien n'a été écrit.`,
        );
      await still();
      for (const dir of [TMP_DIR, MOVING_DIR, HISTORY_DIR, DISK_TRASH_DIR, BASE_DIR])
        await mkdir(disk.abs(root, dir), { recursive: true });
      // Temporary files of an earlier, interrupted update: never good files.
      await emptyFolder(disk.abs(root, TMP_DIR));

      const total = Math.max(1, plan.needed);
      let done = 0;
      let index = 0;
      const count = plan.steps.length;
      let told = 0;
      const tell = (name: string, force = true) => {
        if (!force && Date.now() - told < 250) return;
        told = Date.now();
        job.progress(
          Math.min(0.97, done / total),
          `${Math.min(index, count)} / ${count} · ${name}`,
        );
      };

      // 1. Moves and the Recycle Bin, in two steps (two elements swapping names never collide).
      const moving = plan.steps.filter((s) => s.kind === 'move' || s.kind === 'trash');
      const staged: { step: Step; at: string }[] = [];
      for (const step of moving) {
        if (signal.aborted) throw new Cancelled();
        await still();
        index++;
        tell(step.name);
        const copy = disk.copyOf(step.itemId, row.id)!;
        const at = `${MOVING_DIR}/${step.itemId}/${baseName(copy.rel_path)}`;
        if (!existsSync(disk.abs(root, at)))
          await place(disk.abs(root, copy.rel_path), disk.abs(root, at));
        disk.setCopy(step.itemId, row.id, { rel_path: at });
        staged.push({ step, at });
      }
      for (const { step, at } of staged) {
        await still();
        const target = freeTarget(disk, root, step.to);
        await place(disk.abs(root, at), disk.abs(root, target));
        removeEmptyParents(disk.abs(root, at), disk.abs(root, MOVING_DIR));
        disk.setCopy(step.itemId, row.id, {
          rel_path: target,
          trashed_at: isInDiskTrash(target) ? new Date().toISOString() : null,
        });
        if (step.kind === 'trash') report.trashed++;
        else report.moved++;
      }

      // 2. Copies: temporary name, read back, then in place.
      for (const step of plan.steps.filter((s) => !['move', 'trash'].includes(s.kind))) {
        if (signal.aborted) throw new Cancelled();
        await still();
        index++;
        tell(step.name);
        const item = d.store.get<ItemRow & { updated_at: string }>(
          'items',
          step.itemId,
        ) as ItemRow | null;
        if (!item?.rel_path) continue;
        const temp = disk.abs(root, `${TMP_DIR}/${item.id}-${newId().slice(0, 8)}`);
        let copied: { sha256: string; size: number };
        try {
          copied = await copyVerified(d.library.abs(item.rel_path), temp, {
            signal,
            onBytes: (n) => {
              done += n / 2; // read, then read back
              tell(step.name, false);
            },
          });
        } catch (error) {
          if (error instanceof Cancelled) throw error;
          if (error instanceof VerifyError || !existsSync(d.library.abs(item.rel_path))) {
            report.problems.push({
              itemId: item.id,
              name: item.name,
              reason: String((error as Error).message),
            });
            continue;
          }
          throw error;
        }
        await still();
        // Changed again since it was looked at: what was copied is its latest content.
        if (copied.sha256 !== item.sha256)
          d.store.update('items', item.id, {
            sha256: copied.sha256,
            size: copied.size,
            stat_json: null,
          });
        const copy = disk.copyOf(item.id, row.id);
        const now = new Date();
        // The old version goes to the history (an update), or aside (damaged): never overwritten.
        if (copy && step.kind === 'update' && existsSync(disk.abs(root, copy.rel_path))) {
          const old = freeTarget(disk, root, historyPath(item.id, baseName(copy.rel_path), now));
          await place(disk.abs(root, copy.rel_path), disk.abs(root, old));
          d.store.create<VersionRow>('versions', {
            inner_rel: null,
            item_id: item.id,
            disk_id: row.id,
            rel_path: old,
            name: baseName(copy.rel_path),
            sha256: copy.sha256,
            size: copy.size,
            saved_at: now.toISOString(),
          });
        } else if (copy && step.kind === 'repair' && existsSync(disk.abs(root, copy.rel_path))) {
          await place(
            disk.abs(root, copy.rel_path),
            disk.abs(root, `${DAMAGED_DIR}/${stamp(now)} ${item.id}/${baseName(copy.rel_path)}`),
          );
        }
        const target = freeTarget(disk, root, step.to);
        await place(temp, disk.abs(root, target));
        disk.setCopy(item.id, row.id, {
          rel_path: target,
          sha256: copied.sha256,
          size: copied.size,
          copied_at: now.toISOString(),
          trashed_at: null,
          damaged_at: null,
        });
        if (step.kind === 'copy') report.copied++;
        else if (step.kind === 'update') report.updated++;
        else report.repaired++;
      }

      // 3. The history's quota (oldest first; never the current files, the archives or the Recycle Bin).
      await still();
      job.progress(0.98, 'Historique…');
      const purged = await applyQuota(d, disk, row, root);
      report.removedVersions = purged.removed;
      report.oversized = purged.oversized;

      // 4. The disk suffices to itself: database, sheets, manifest, identity.
      job.progress(0.99, 'Copie de la base et des fiches…');
      await exportBase(d, disk, row, root, report.at);
      job.progress(1, 'Terminé');
      return report;
    } catch (error) {
      if (error instanceof Cancelled || signal.aborted)
        report.stopped =
          'Annulée : ce qui est déjà sur le disque est valide, le reste sera fait à la prochaine mise à jour.';
      else if (error instanceof DiskGone || (diskGone(error) && !disk.state.root))
        report.stopped = `Le disque a été débranché pendant la mise à jour : ce qui est déjà copié est valide, le reste sera fait à la prochaine mise à jour.`;
      else if (diskGone(error))
        report.stopped = `Le disque ne répond plus (${(error as NodeJS.ErrnoException).code}) : ce qui est déjà copié est valide, le reste sera fait à la prochaine mise à jour.`;
      else report.stopped = (error as Error).message;
      throw error;
    } finally {
      try {
        save();
      } catch {
        // The PC's database: never in the way of the error itself.
      }
    }
  });
}

const gb = (n: number) =>
  `${(n / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;

/** The place for an element on the disk: its own, or « nom (2) » when another file is there. */
function freeTarget(disk: DiskManager, root: string, rel: string): string {
  return existsSync(disk.abs(root, rel)) ? disk.freeOnDisk(root, rel) : rel;
}

async function emptyFolder(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir))
    await rm(path.join(dir, name), { recursive: true, force: true });
}

/** Removes the folders left empty by a move, up to `stop` (excluded). */
function removeEmptyParents(from: string, stop: string): void {
  let dir = path.dirname(from);
  while (dir.startsWith(stop) && dir !== stop) {
    try {
      if (readdirSync(dir).length) return;
      rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/** The quota: the oldest versions removed until the history fits (ADR 0055). */
export async function applyQuota(
  d: CoffreDeps,
  disk: DiskManager,
  row: DiskRow,
  root: string,
): Promise<{ removed: number; oversized: string[] }> {
  const versions = versionsOf(d, row.id);
  const plan = quotaPlan(
    versions.map((v) => ({ id: v.id, size: v.size, savedAt: v.saved_at })),
    quotaBytes(d),
  );
  let removed = 0;
  for (const id of plan.remove) {
    const v = versions.find((x) => x.id === id)!;
    if (!v.rel_path.startsWith(`${HISTORY_DIR}/`)) continue; // only ever the history
    await rm(disk.abs(root, v.rel_path), { recursive: true, force: true });
    removeEmptyParents(disk.abs(root, v.rel_path), disk.abs(root, HISTORY_DIR));
    d.store.remove('versions', id);
    removed++;
  }
  return {
    removed,
    oversized: plan.oversized.map((id) => versions.find((v) => v.id === id)!.name),
  };
}

/** Writes a file on the disk under a temporary name, then in place (replacing ToolBox's previous copy). */
async function writeReplacing(disk: DiskManager, root: string, rel: string, data: string | Buffer) {
  const temp = disk.abs(root, `${TMP_DIR}/${newId()}.partie`);
  await mkdir(path.dirname(temp), { recursive: true });
  await writeFile(temp, data);
  await rename(temp, disk.abs(root, rel));
}

/** The disk suffices to itself: a consistent copy of the database, the sheets (JSON), a manifest. */
export async function exportBase(
  d: CoffreDeps,
  disk: DiskManager,
  row: DiskRow,
  root: string,
  at: string,
): Promise<void> {
  const { ctx } = d;
  await mkdir(disk.abs(root, BASE_DIR), { recursive: true });
  if (ctx.db.snapshotTo) {
    const temp = disk.abs(root, `${TMP_DIR}/hub-${newId()}.db`);
    ctx.db.snapshotTo(temp);
    await rename(temp, disk.abs(root, `${BASE_DIR}/hub.db`));
  }
  const all = (t: string) => ctx.db.prepare(`SELECT * FROM ${t}`).all();
  const sheets = {
    format: 'toolbox-coffre-fiches',
    // v0.50.0 (ADR 0067): version 2 — folders, labels, sets of labels.
    version: 2,
    exportedAt: at,
    disk: { id: row.id, name: row.name },
    tables: {
      folders: all(d.t.folders),
      items: all(d.t.items),
      labels: all(d.t.labels),
      label_sets: all(d.t.labelSets),
      copies: ctx.db.prepare(`SELECT * FROM ${d.t.copies} WHERE disk_id = ?`).all(row.id),
      versions: ctx.db.prepare(`SELECT * FROM ${d.t.versions} WHERE disk_id = ?`).all(row.id),
    },
  };
  await writeReplacing(disk, root, `${BASE_DIR}/fiches.json`, JSON.stringify(sheets, null, 1));
  const pairs = itemsWithCopies(d, row.id).filter((p) => p.copy);
  const manifest = {
    format: 'toolbox-coffre-manifeste',
    version: 1,
    updatedAt: at,
    disk: { id: row.id, name: row.name },
    elements: pairs.map(({ item, copy }) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      state: isInDiskTrash(copy!.rel_path) ? 'corbeille' : item.archived_at ? 'archivé' : 'actif',
      path: copy!.rel_path,
      sha256: copy!.sha256,
      size: copy!.size,
    })),
    versions: versionsOf(d, row.id).map((v) => ({
      element: v.item_id,
      path: v.rel_path,
      sha256: v.sha256,
      size: v.size,
      savedAt: v.saved_at,
    })),
  };
  await writeReplacing(disk, root, `${BASE_DIR}/manifeste.json`, JSON.stringify(manifest, null, 1));
  const identity: DiskIdentity = {
    format: 'toolbox-coffre',
    version: 1,
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUpdateAt: at,
  };
  await writeIdentity(root, identity);
  // The ToolBox folder's own note (what it holds), once.
  const readme = disk.abs(root, `${SYSTEM_FOLDER}/LISEZ-MOI.txt`);
  if (!existsSync(readme))
    await writeFile(
      readme,
      [
        'Ce dossier appartient à ToolBox (Coffre). Ne le modifie pas à la main.',
        '',
        'Historique : les anciennes versions de tes fichiers (les plus anciennes partent d’abord quand la place réservée est pleine).',
        'Corbeille : ce que tu as supprimé du coffre ; rien n’y est effacé sans ta confirmation.',
        'Base : une copie de la base de ToolBox (hub.db), tes fiches (fiches.json) et la liste de tout ce qui est sur ce disque (manifeste.json).',
        '',
        'Tes fichiers eux-mêmes sont dans les dossiers à côté, rangés comme dans ToolBox.',
        '',
      ].join('\r\n'),
      'utf8',
    );
}
