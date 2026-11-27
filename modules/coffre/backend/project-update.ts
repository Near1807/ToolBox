// v0.51.0 B (Expérimental, ADR 0068): a PROJECT's copy on the disk, updated
// FILE BY FILE — only the files added or changed on the PC are copied (the
// same safe copy: temporary name, forced to the medium, read back, then put in
// place); the ones changed or gone (renamed, deleted) keep their old version
// in the disk's history. The disk's manifest says what the copy holds; the
// project is « à jour » only when EVERY file matches. A copy made whole before
// (v0.50) is adopted: its files compared by their fingerprint, never copied
// again when equal. Git writing in the project (a .lock): not copied now.
import { existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, newId, requestBody } from '@hub/sdk/core';
import type { UpdateReport } from '../shared/types';
import {
  Cancelled,
  copyFileVerified,
  hashFileChecked,
  listFiles,
  place,
  VerifyError,
} from './copy';
import { DAMAGED_DIR, innerHistoryPath, stamp, TMP_DIR } from './disk-layout';
import type { CoffreDeps, DiskManager } from './disk';
import { excludedPath, ProjectRules, walkProject } from './exclusions';
import { gitLock } from './git';
import type { Step } from './plan';
import type { DiskRow, InnerFileRow, ItemRow, VersionRow } from './rows';
import { taskRoute } from './tasks';
import { freeTarget, removeEmptyParents } from './update';

export type ProjectUpdate = 'done' | { locked: string } | { problem: string };

export async function updateProject(
  d: CoffreDeps,
  disk: DiskManager,
  root: string,
  row: DiskRow,
  item: ItemRow,
  step: Step,
  report: UpdateReport,
  o: { signal: AbortSignal; still: () => Promise<void>; onBytes: (n: number) => void },
): Promise<ProjectUpdate> {
  const pcRoot = d.projects.rootOf(item);
  if (!pcRoot || !existsSync(pcRoot)) return { problem: 'introuvable sur le PC' };
  // E: never while Git writes in it (a half-written index or branch).
  const lock = gitLock(pcRoot);
  if (lock) return { locked: lock };
  // Its files looked at now (the plan was made a moment ago).
  const fresh = await d.projects.refresh(item, { signal: o.signal });
  if (fresh.missing) return { problem: 'introuvable sur le PC' };
  if (fresh.sha256 !== item.sha256 || fresh.size !== item.size)
    d.store.update('items', item.id, { sha256: fresh.sha256, size: fresh.size, stat_json: null });

  // Its place on the disk: a new copy gets its folder; a project moved follows (whole, first).
  const copy = disk.copyOf(item.id, row.id);
  let dirRel: string;
  if (!copy) {
    dirRel = freeTarget(disk, root, step.to);
    disk.setCopy(item.id, row.id, { rel_path: dirRel, sha256: null, size: 0 });
  } else if (!existsSync(disk.abs(root, copy.rel_path))) {
    // Its folder is gone from the disk: its manifest says nothing true any more.
    for (const f of d.projects.diskFiles(row.id, item.id))
      d.projects.dropDiskFile(row.id, item.id, f.rel);
    dirRel = freeTarget(disk, root, step.to);
    disk.setCopy(item.id, row.id, { rel_path: dirRel, sha256: null, trashed_at: null });
  } else {
    dirRel = copy.rel_path;
    if (dirRel !== step.to) {
      await o.still();
      const target = freeTarget(disk, root, step.to);
      await place(disk.abs(root, dirRel), disk.abs(root, target));
      dirRel = target;
      disk.setCopy(item.id, row.id, { rel_path: target, trashed_at: null });
    }
  }
  await mkdir(disk.abs(root, dirRel), { recursive: true });
  const at = (rel: string) => disk.abs(root, `${dirRel}/${rel}`);
  const now = new Date();
  /** An old file of the copy to the history (or aside when damaged): never overwritten. */
  const keepOld = async (rel: string, sha256: string | null, damaged = false) => {
    const file = at(rel);
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (damaged) {
      await place(file, disk.abs(root, `${DAMAGED_DIR}/${stamp(now)} ${item.id}/${rel}`));
      return;
    }
    const wanted = innerHistoryPath(item.id, rel, now);
    const target = existsSync(disk.abs(root, wanted)) ? disk.freeOnDisk(root, wanted) : wanted;
    await place(file, disk.abs(root, target));
    d.store.create<VersionRow>('versions', {
      inner_rel: rel,
      item_id: item.id,
      disk_id: row.id,
      rel_path: target,
      name: path.posix.basename(rel),
      sha256,
      size,
      saved_at: now.toISOString(),
    });
    removeEmptyParents(file, disk.abs(root, dirRel));
  };

  const index = d.projects.files(item.id);
  const manifest = new Map(d.projects.diskFiles(row.id, item.id).map((r) => [r.rel, r]));
  const repair = step.kind === 'repair';
  const adopt = repair || (manifest.size === 0 && listFiles(disk.abs(root, dirRel)).length > 0);
  let toCopy: InnerFileRow[];
  if (adopt) {
    // Compared by their fingerprint: an equal file is recorded, never copied again.
    toCopy = [];
    for (const f of index) {
      if (o.signal.aborted) throw new Cancelled();
      const file = at(f.rel);
      if (!existsSync(file)) {
        toCopy.push(f);
        continue;
      }
      const sha = await hashFileChecked(file, { signal: o.signal, onBytes: o.onBytes });
      if (sha === f.sha256) d.projects.setDiskFile(row.id, item.id, f.rel, sha, f.size);
      else {
        await o.still();
        await keepOld(f.rel, sha, repair);
        toCopy.push(f);
      }
    }
    // On the disk and no longer in the project: gone on the PC (history); the
    // ones it does not save now are left — proposed apart, never removed alone.
    const rules = new ProjectRules(pcRoot, d.projects.choicesOf(item));
    const kept = new Set(index.map((f) => f.rel));
    for (const rel of listFiles(disk.abs(root, dirRel))) {
      if (kept.has(rel) || excludedPath(rules, rel)) continue;
      await o.still();
      await keepOld(rel, null);
      d.projects.dropDiskFile(row.id, item.id, rel);
    }
  } else {
    toCopy = index.filter((f) => manifest.get(f.rel)?.sha256 !== f.sha256);
    const kept = new Set(index.map((f) => f.rel));
    const rules = new ProjectRules(pcRoot, d.projects.choicesOf(item));
    for (const old of manifest.values()) {
      if (kept.has(old.rel)) continue;
      // No longer saved (a .gitignore, a choice): left on the disk, proposed apart (D4);
      // only gone from the manifest. Gone on the PC: its old version to the history.
      if (!excludedPath(rules, old.rel)) {
        await o.still();
        await keepOld(old.rel, old.sha256);
      }
      d.projects.dropDiskFile(row.id, item.id, old.rel);
    }
  }

  // The added or changed files: temporary name, read back, then in place.
  let failed = 0;
  for (const f of toCopy) {
    if (o.signal.aborted) throw new Cancelled();
    await o.still();
    const temp = disk.abs(root, `${TMP_DIR}/${item.id}-${newId().slice(0, 8)}`);
    let copied: { sha256: string; size: number };
    try {
      copied = await copyFileVerified(path.join(pcRoot, ...f.rel.split('/')), temp, {
        signal: o.signal,
        onBytes: o.onBytes,
      });
    } catch (error) {
      if (error instanceof Cancelled) throw error;
      if (error instanceof VerifyError || !existsSync(path.join(pcRoot, ...f.rel.split('/')))) {
        failed++;
        continue;
      }
      throw error;
    }
    await o.still();
    const old = manifest.get(f.rel);
    if (!adopt && existsSync(at(f.rel))) await keepOld(f.rel, old?.sha256 ?? null);
    await place(temp, at(f.rel));
    d.projects.setDiskFile(row.id, item.id, f.rel, copied.sha256, copied.size);
    report.files++;
    // The tests slow it down to stop it in the middle of a project.
    const pause = Number(process.env.TOOLBOX_COFFRE_COPY_PAUSE_MS ?? 0);
    if (pause) await new Promise((r) => setTimeout(r, pause));
  }

  // The copy's fingerprint from its manifest: « à jour » when every file matches.
  const h = d.projects.diskHash(row.id, item.id);
  disk.setCopy(item.id, row.id, {
    rel_path: dirRel,
    sha256: h.sha256,
    size: h.size,
    copied_at: now.toISOString(),
    trashed_at: null,
    damaged_at: null,
  });
  if (step.kind === 'copy') report.copied++;
  else if (repair) report.repaired++;
  else report.updated++;
  return failed
    ? { problem: `${failed} fichier(s) n’ont pas pu être copiés (relus différents ou disparus)` }
    : 'done';
}

export interface DiskExcludedDto {
  itemId: string;
  name: string;
  entries: { rel: string; reason: string; files: number; bytes: number; partial: boolean }[];
  bytes: number;
}

/**
 * v0.51.0 D4: the copies on the disk that still hold what their project does
 * not save any more (a .gitignore or a choice made after the copy): PROPOSED,
 * with the room it frees — removed only by a click, to the disk's history.
 */
export function registerDiskExcludedRoutes(d: CoffreDeps, disk: DiskManager): void {
  const { ctx } = d;
  const live = (): { item: ItemRow; dir: string; pcRoot: string }[] => {
    const row = disk.disk();
    const root = disk.state.root;
    if (!row || !root) return [];
    const items = ctx.db
      .prepare(
        `SELECT * FROM ${d.t.items} WHERE deleted_at IS NULL AND trashed_at IS NULL AND archived_at IS NULL AND kind = 'project'`,
      )
      .all() as ItemRow[];
    return items.flatMap((item) => {
      const copy = disk.copyOf(item.id, row.id);
      const pcRoot = d.projects.rootOf(item);
      if (!copy || !pcRoot || !existsSync(pcRoot)) return [];
      const dir = disk.abs(root, copy.rel_path);
      return existsSync(dir) ? [{ item, dir, pcRoot }] : [];
    });
  };
  const excludedOf = async (p: { item: ItemRow; dir: string; pcRoot: string }) =>
    (
      await walkProject(p.dir, d.projects.choicesOf(p.item), {
        measureExcluded: true,
        rulesRoot: p.pcRoot,
      })
    ).excluded;

  ctx.routes.get('/disk/excluded', async (): Promise<DiskExcludedDto[]> => {
    const out: DiskExcludedDto[] = [];
    for (const p of live()) {
      const entries = await excludedOf(p);
      if (entries.length)
        out.push({
          itemId: p.item.id,
          name: p.item.name,
          entries: entries.map((e) => ({
            rel: e.rel,
            reason: e.reason,
            files: e.files,
            bytes: e.bytes,
            partial: e.partial,
          })),
          bytes: entries.reduce((s, e) => s + e.bytes, 0),
        });
    }
    return out;
  });

  /** « Les retirer de la copie du disque » (a click): to the disk's history, never erased. */
  taskRoute<{ itemIds: string[] }, { removed: number; bytes: number }>(ctx, {
    route: '/disk/excluded/remove',
    type: 'disk-excluded-remove',
    input: (request) => {
      disk.rootOrThrow();
      const ids = requestBody(request).itemIds;
      if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Quels projets ?');
      return { itemIds: ids.map(String) };
    },
    title: () => 'Coffre : retirer de la copie du disque ce qui n’est plus sauvegardé',
    run: (job) =>
      disk.exclusive('retrait de ce qui n’est plus sauvegardé', async () => {
        const row = disk.disk()!;
        const root = disk.rootOrThrow();
        const now = new Date();
        let removed = 0;
        let bytes = 0;
        for (const p of live().filter((x) => job.input.itemIds.includes(x.item.id))) {
          if (job.signal.aborted) break;
          for (const e of await excludedOf(p)) {
            const from = path.join(p.dir, ...e.rel.split('/'));
            const wanted = innerHistoryPath(p.item.id, e.rel, now);
            const target = existsSync(disk.abs(root, wanted))
              ? disk.freeOnDisk(root, wanted)
              : wanted;
            await place(from, disk.abs(root, target));
            d.store.create<VersionRow>('versions', {
              inner_rel: e.rel,
              item_id: p.item.id,
              disk_id: row.id,
              rel_path: target,
              name: path.posix.basename(e.rel),
              sha256: null,
              size: e.bytes,
              saved_at: now.toISOString(),
            });
            for (const f of d.projects.diskFiles(row.id, p.item.id))
              if (f.rel === e.rel || f.rel.startsWith(`${e.rel}/`))
                d.projects.dropDiskFile(row.id, p.item.id, f.rel);
            removed++;
            bytes += e.bytes;
          }
        }
        return { removed, bytes };
      }),
  });
}
