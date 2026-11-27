// v0.46.0 F: archive (the PC's copy removed ONLY after both copies were read
// again and found identical), reactivate (the PC's room checked first, the
// copy back read again), a read-only copy to open an archived element without
// reactivating it (removed afterwards), and the suggestions (never applied
// on their own). ADR 0055.
import { chmodSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpError, newId, requestBody, uuidParam, type JobRunContext } from '@hub/sdk/core';
import { copyVerified, fingerprint, hashFileChecked, projectHash } from './copy';
import { walkProject } from './exclusions';
import type { CoffreDeps, DiskManager } from './disk';
import { PC_MARGIN } from './history';
import { stateOf } from './plan';
import type { ItemRow } from './rows';
import { taskRoute } from './tasks';

/** « Pas ouverts depuis 6 mois »: the suggestion's age. */
export const SUGGEST_DAYS = 182;

/** Where the read-only copies of archived elements go (removed at each start). */
export const READ_COPIES = () => path.join(tmpdir(), 'ToolBox-Coffre-lecture');

function makeWritable(target: string): void {
  try {
    chmodSync(target, 0o777);
    if (statSync(target).isDirectory())
      for (const name of readdirSync(target)) makeWritable(path.join(target, name));
  } catch {
    // Gone already.
  }
}

function makeReadOnly(target: string): void {
  if (statSync(target).isDirectory()) {
    for (const name of readdirSync(target)) makeReadOnly(path.join(target, name));
  } else chmodSync(target, 0o444);
}

/** Removes the read-only copies of earlier sessions (older than 10 minutes; one still open stays). */
export function cleanReadCopies(): void {
  const dir = READ_COPIES();
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const target = path.join(dir, name);
    // Only an earlier session's (a copy just opened by another ToolBox stays).
    try {
      if (Date.now() - statSync(target).mtimeMs < 10 * 60_000) continue;
    } catch {
      continue;
    }
    makeWritable(target);
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      // In use: next time.
    }
  }
}

/** A read-only copy of an archived element's file, to open it without reactivating it. */
export async function readCopy(source: string, itemId: string): Promise<string> {
  const target = path.join(
    READ_COPIES(),
    `${itemId}-${newId().slice(0, 8)}`,
    path.basename(source),
  );
  await mkdir(path.dirname(target), { recursive: true });
  await copyVerified(source, target);
  makeReadOnly(target);
  return target;
}

export function registerArchiveRoutes(
  d: CoffreDeps,
  disk: DiskManager,
  /** v0.50.0: the files of a folder and its sub-folders (archived or reactivated as a folder). */
  filesOfFolder: (folderId: string) => string[],
): void {
  const { ctx, store, library } = d;
  const getItem = (id: string) => {
    const row = store.get<ItemRow & { updated_at: string }>('items', id) as ItemRow | null;
    if (!row) throw new HttpError(404, 'Fichier introuvable');
    return row;
  };

  /**
   * POST /files/archive { ids | folderId, confirm }: disk plugged in, each
   * file « actif » (a project: whole). Both copies are read again NOW; identical → the PC's copy is
   * removed; otherwise nothing is removed and the reason is given.
   */
  taskRoute<
    { ids: string[] },
    { archived: number; freed: number; refused: { itemId: string; name: string; reason: string }[] }
  >(ctx, {
    route: '/files/archive',
    type: 'archive',
    input: (request) => {
      const b = requestBody(request);
      if (b.confirm !== true) throw new HttpError(400, 'Archiver : confirmation nécessaire');
      const ids =
        typeof b.folderId === 'string' && b.folderId
          ? filesOfFolder(b.folderId)
          : Array.isArray(b.ids)
            ? b.ids.map(String)
            : [];
      if (!ids.length) throw new HttpError(400, 'Rien à archiver');
      disk.rootOrThrow();
      return { ids };
    },
    title: (i) => `Coffre : archiver ${i.ids.length} fichier${i.ids.length > 1 ? 's' : ''}`,
    // v0.49.0: a background task; each element refused is in the report with its reason.
    run: async (job) => {
      const ids = job.input.ids;
      const root = disk.rootOrThrow();
      const diskRow = disk.disk()!;
      return disk.exclusive('archivage', async () => {
        await disk.scanPc();
        let archived = 0;
        let freed = 0;
        const refused: { itemId: string; name: string; reason: string }[] = [];
        let n = 0;
        for (const id of ids) {
          if (job.signal.aborted) break;
          const row = getItem(id);
          job.step(n++, ids.length, { unit: 'fichiers', current: row.name });
          const copy = disk.copyOf(row.id, diskRow.id);
          const refuse = (reason: string) => {
            refused.push({ itemId: row.id, name: row.name, reason });
            job.problem(row.name, reason);
          };
          if (row.archived_at) {
            refuse('déjà archivé');
            continue;
          }
          if (stateOf(row, copy) !== 'active' || !copy || !row.rel_path) {
            refuse('pas encore sur le disque : mets le disque à jour d’abord');
            continue;
          }
          const pcFile = library.abs(row.rel_path);
          const diskFile = disk.abs(root, copy.rel_path);
          // v0.51.0: a project followed in place is never archived (its folder is not the Coffre's).
          if (row.tracked_path) {
            refuse('suivi en place : il n’est jamais archivé (son dossier reste où il est)');
            continue;
          }
          try {
            // v0.51.0: a project — what it does not save would be lost: refused, said.
            if (row.kind === 'project') {
              const lost = (
                await walkProject(pcFile, d.projects.choicesOf(row), { measureExcluded: false })
              ).excluded.filter((e) => e.reason !== 'défaut');
              if (lost.length) {
                refuse(
                  `des fichiers ne sont pas sauvegardés (${lost
                    .slice(0, 3)
                    .map((e) => e.rel)
                    .join(
                      ', ',
                    )}${lost.length > 3 ? '…' : ''}) : « Le sauvegarder quand même » d’abord`,
                );
                continue;
              }
            }
            // Read again, both, now (a project: its files, from its index and its manifest).
            const [onPc, onDisk] =
              row.kind === 'project'
                ? [
                    (await d.projects.refresh(row)).sha256,
                    await manifestFingerprint(d, diskRow.id, row.id, diskFile),
                  ]
                : [await fingerprint(pcFile), await fingerprint(diskFile)];
            if (onPc !== copy.sha256 || onDisk !== copy.sha256) {
              refuse(
                onDisk !== copy.sha256
                  ? 'la copie du disque ne correspond pas (relue) : rien n’a été retiré'
                  : 'le fichier du PC a changé : mets le disque à jour d’abord',
              );
              continue;
            }
          } catch (error) {
            refuse(`relecture impossible (${(error as Error).message}) : rien n’a été retiré`);
            continue;
          }
          makeWritable(pcFile);
          await rm(pcFile, { recursive: true, force: true });
          store.update('items', row.id, { archived_at: new Date().toISOString(), stat_json: null });
          archived++;
          freed += row.size;
        }
        job.step(n, ids.length, { current: null });
        return { archived, freed, refused };
      });
    },
  });

  /** Reactivates one archived file: the PC's room checked first, the disk's copy read back. */
  const reactivateOne = async (row: ItemRow, root: string, diskId: string): Promise<void> => {
    const copy = disk.copyOf(row.id, diskId);
    if (!copy || !existsSync(disk.abs(root, copy.rel_path)))
      throw new HttpError(404, 'Introuvable sur le disque');
    const free = (await library.disk()).free;
    if (free !== null && copy.size + PC_MARGIN > free)
      throw new HttpError(
        409,
        `Pas assez de place sur le PC pour le réactiver (${Math.ceil(copy.size / 1024 ** 2)} Mo nécessaires) : rien n’a changé.`,
      );
    const temp = ctx.files.dataPath('tmp', newId());
    const back = await copyVerified(disk.abs(root, copy.rel_path), temp);
    // v0.51.0: a project is checked against its manifest (file by file).
    const got =
      row.kind === 'project' && d.projects.diskFiles(diskId, row.id).length
        ? await manifestFingerprint(d, diskId, row.id, temp)
        : back.sha256;
    if (copy.sha256 && got !== copy.sha256) {
      await rm(temp, { recursive: true, force: true });
      throw new HttpError(
        409,
        'La copie du disque ne correspond plus à son empreinte : rien n’a changé',
      );
    }
    const rel = row.rel_path ?? copy.rel_path;
    const dirRel = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    const dirAbs = library.abs(dirRel);
    await mkdir(dirAbs, { recursive: true });
    // Its own place (kept for it while archived); another name only if a file took it anyway.
    const name = existsSync(path.join(dirAbs, path.posix.basename(rel)))
      ? library.freeIn(dirAbs, path.posix.basename(rel))
      : path.posix.basename(rel);
    await rename(temp, path.join(dirAbs, name));
    store.update('items', row.id, {
      archived_at: null,
      rel_path: dirRel ? `${dirRel}/${name}` : name,
      name,
      stat_json: null,
    });
  };

  /**
   * Reactivate a file (`/files/:id/reactivate`) or a folder (`/folders/:id/reactivate`:
   * its archived files, a project whole). Each refusal is in the report with its reason.
   */
  const reactivateRun = async (job: JobRunContext<{ ids: string[] }>) => {
    const rows = job.input.ids.map(getItem).filter((r) => r.archived_at);
    if (!rows.length) return { done: 0 };
    const root = disk.rootOrThrow();
    const diskRow = disk.disk()!;
    return disk.exclusive('réactivation', async () => {
      let done = 0;
      for (const [n, row] of rows.entries()) {
        if (job.signal.aborted) break;
        job.step(n, rows.length, { unit: 'fichiers', current: row.name });
        try {
          await reactivateOne(row, root, diskRow.id);
          done++;
        } catch (error) {
          if (rows.length === 1) throw error;
          job.problem(row.name, error instanceof Error ? error.message : String(error));
        }
      }
      job.step(rows.length, rows.length, { current: null });
      return { done };
    });
  };
  taskRoute<{ ids: string[] }, { done: number }>(ctx, {
    route: '/files/:id/reactivate',
    type: 'reactivate',
    input: (request) => {
      const row = getItem(uuidParam(request.params));
      if (row.archived_at) disk.rootOrThrow();
      return { ids: [row.id] };
    },
    title: (i) => `Coffre : réactiver « ${getItem(i.ids[0]!).name} »`,
    // A background task (a big file read back from the disk).
    run: reactivateRun,
  });
  taskRoute<{ ids: string[] }, { done: number }>(ctx, {
    route: '/folders/:id/reactivate',
    type: 'reactivate-folder',
    input: (request) => {
      const ids = filesOfFolder(uuidParam(request.params)).filter((id) => getItem(id).archived_at);
      if (!ids.length) throw new HttpError(409, 'Rien d’archivé dans ce dossier');
      disk.rootOrThrow();
      return { ids };
    },
    title: (i) => `Coffre : réactiver ${i.ids.length} fichier${i.ids.length > 1 ? 's' : ''}`,
    run: reactivateRun,
  });

  /** « 40 éléments pas ouverts depuis 6 mois (3,2 Go) — Voir »: a suggestion, never applied alone. */
  ctx.routes.get('/suggestions/archive', () => {
    const diskRow = disk.disk();
    if (!diskRow) return { count: 0, bytes: 0, ids: [] };
    const since = new Date(Date.now() - SUGGEST_DAYS * 86_400_000).toISOString();
    const rows = ctx.db
      .prepare(
        `SELECT * FROM ${d.t.items} WHERE deleted_at IS NULL AND trashed_at IS NULL AND archived_at IS NULL AND pinned = 0 AND COALESCE(opened_at, created_at) < ?`,
      )
      .all(since) as ItemRow[];
    const active = rows.filter((r) => stateOf(r, disk.copyOf(r.id, diskRow.id)) === 'active');
    return {
      count: active.length,
      bytes: active.reduce((s, r) => s + r.size, 0),
      ids: active.map((r) => r.id),
    };
  });
}

/** v0.51.0: a project's copy read back now, file by file, from its manifest. */
export async function manifestFingerprint(
  d: CoffreDeps,
  diskId: string,
  itemId: string,
  dir: string,
): Promise<string | null> {
  const files: { rel: string; sha256: string }[] = [];
  for (const f of d.projects.diskFiles(diskId, itemId)) {
    const file = path.join(dir, ...f.rel.split('/'));
    if (!existsSync(file)) return null;
    files.push({ rel: f.rel, sha256: await hashFileChecked(file) });
  }
  return projectHash(files);
}
