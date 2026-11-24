// v0.46.0 G: « Restaurer depuis un disque… » — a ToolBox-Coffre folder chosen,
// a preview first (last update, elements, room needed), then, CONFIRMED: the
// Coffre's sheets taken back from the disk (the PC's database saved before
// when it has data), the ACTIVE elements copied back onto the PC (each read
// back, fingerprint checked), the archived ones left on the disk. A file
// already on the PC is never replaced. ADR 0055.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, newId, requestBody, type JobRunContext } from '@hub/sdk/core';
import { copyVerified, fingerprint } from './copy';
import { BASE_DIR, DISK_FOLDER, type DiskIdentity } from './disk-layout';
import type { CoffreDeps, DiskManager } from './disk';
import { PC_MARGIN } from './history';
import type { DiskRow, ItemRow } from './rows';
import { readIdentity, splitVolume, volumeRoots } from './volumes';

interface Sheets {
  format: string;
  exportedAt: string;
  disk: { id: string; name: string };
  tables: Record<string, Record<string, unknown>[]>;
}

export interface RestorePreview {
  folder: string;
  diskId: string;
  diskName: string;
  lastUpdateAt: string | null;
  active: number;
  archived: number;
  trashed: number;
  /** Bytes the active elements need on the PC. */
  needed: number;
  pcFree: number | null;
  /** Elements already in the Coffre of this PC (a backup and a confirmation first). */
  pcItems: number;
  /** The disk registered on this PC: the same one, another one, or none. */
  registered: 'same' | 'other' | 'none';
}

export interface RestoreReport {
  copied: number;
  already: number;
  archived: number;
  conflicts: { name: string; restoredAs: string }[];
  problems: { name: string; reason: string }[];
  backup: string | null;
}

/** The ToolBox-Coffre folder (chosen itself, or its parent) and its identity. */
async function locate(chosen: string): Promise<{ folder: string; identity: DiskIdentity }> {
  if (!path.isAbsolute(chosen)) throw new HttpError(400, 'Dossier invalide');
  for (const folder of [chosen, path.join(chosen, DISK_FOLDER)]) {
    const identity = await readIdentity(folder);
    if (identity) return { folder, identity };
  }
  throw new HttpError(404, 'Ce dossier n’est pas un coffre de ToolBox (pas de fichier d’identité)');
}

function readSheets(folder: string): Sheets {
  const file = path.join(folder, ...BASE_DIR.split('/'), 'fiches.json');
  if (!existsSync(file))
    throw new HttpError(404, 'Pas de fiches sur ce disque (aucune mise à jour terminée ?)');
  const sheets = JSON.parse(readFileSync(file, 'utf8')) as Sheets;
  if (sheets.format !== 'toolbox-coffre-fiches' || !sheets.tables?.items)
    throw new HttpError(400, 'Fiches illisibles');
  return sheets;
}

type Row = Record<string, unknown>;
const live = (r: Row) => !r.deleted_at;
const isActive = (r: Row) => live(r) && !r.trashed_at && !r.archived_at && r.kind !== 'link';

export function registerRestoreRoutes(d: CoffreDeps, disk: DiskManager): void {
  const { ctx, store, library } = d;
  const pcItemCount = () =>
    (
      ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${d.t.items} WHERE deleted_at IS NULL`).get() as {
        n: number;
      }
    ).n;

  const preview = async (chosen: string): Promise<RestorePreview> => {
    const { folder, identity } = await locate(chosen);
    const sheets = readSheets(folder);
    const items = sheets.tables.items ?? [];
    const active = items.filter(isActive);
    const current = disk.disk();
    return {
      folder,
      diskId: identity.id,
      diskName: identity.name,
      lastUpdateAt: identity.lastUpdateAt ?? sheets.exportedAt ?? null,
      active: active.length,
      archived: items.filter((r) => live(r) && r.archived_at && !r.trashed_at).length,
      trashed: items.filter((r) => live(r) && r.trashed_at).length,
      needed: active.reduce((s, r) => s + Number(r.size ?? 0), 0),
      pcFree: (await library.disk()).free,
      pcItems: pcItemCount(),
      registered: !current ? 'none' : current.id === identity.id ? 'same' : 'other',
    };
  };

  ctx.routes.post('/restore/preview', async (request) => {
    const b = requestBody(request);
    if (typeof b.path !== 'string') throw new HttpError(400, 'Dossier manquant');
    return preview(b.path);
  });

  /** The columns of a table (the sheets' keys are never trusted as SQL). */
  const columnsOf = (table: string) =>
    new Set(
      (ctx.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
  const upsert = (name: keyof typeof d.t & string, rows: Row[]) => {
    const columns = columnsOf(d.t[name]);
    for (const r of rows) {
      const id = String(r.id ?? '');
      if (!/^[0-9a-f-]{8,64}$/i.test(id)) continue;
      const fields: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(r))
        if (columns.has(k) && !['id', 'created_at', 'updated_at'].includes(k))
          fields[k] = v === null || typeof v === 'number' || typeof v === 'string' ? v : String(v);
      if (store.get(name, id, true)) store.update(name, id, fields);
      else store.create(name, fields, id);
    }
  };

  ctx.jobs.define<{ path: string }, RestoreReport>(
    'disk-restore',
    async (job: JobRunContext<{ path: string }>) =>
      disk.exclusive('restauration depuis le disque', async () => {
        const p = await preview(job.input.path);
        if (p.registered === 'other')
          throw new HttpError(
            409,
            'Un autre disque est enregistré sur ce PC : « Oublier ce disque » d’abord',
          );
        if (p.pcFree !== null && p.needed + PC_MARGIN > p.pcFree)
          throw new HttpError(
            409,
            'Pas assez de place sur le PC pour les éléments actifs : rien n’a changé',
          );
        const report: RestoreReport = {
          copied: 0,
          already: 0,
          archived: p.archived,
          conflicts: [],
          problems: [],
          backup: null,
        };
        // The PC's database saved first when the Coffre already has data.
        if (p.pcItems > 0) report.backup = ctx.db.backup('avant-restauration-coffre');
        const sheets = readSheets(p.folder);
        const t = sheets.tables;
        job.progress(0.02, 'Fiches…');
        ctx.db.transaction(() => {
          upsert('contexts', t.contexts ?? []);
          upsert('items', t.items ?? []);
          upsert('attributes', t.attributes ?? []);
          upsert('also', t.also ?? []);
          upsert(
            'versions',
            (t.versions ?? []).filter((r) => r.disk_id === p.diskId),
          );
          upsert(
            'copies',
            (t.copies ?? []).filter((r) => r.disk_id === p.diskId),
          );
          // In the PC's Recycle Bin on the old PC: here, its file is only in the disk's one.
          for (const r of t.items ?? [])
            if (live(r) && r.trashed_at) store.remove('items', String(r.id));
        });
        // This disk becomes the Coffre's disk on this PC.
        if (p.registered === 'none') {
          const { rel } = splitVolume(p.folder, await volumeRoots());
          const existing = store.get<DiskRow>('disks', p.diskId, true);
          const fields = {
            name: p.diskName,
            rel_root: rel,
            last_root: p.folder,
            last_update_at: p.lastUpdateAt,
          };
          if (existing) {
            if (existing.deleted_at) store.restore('disks', p.diskId);
            store.update('disks', p.diskId, fields);
          } else
            store.create(
              'disks',
              { ...fields, last_update_json: null, last_verify_json: null },
              p.diskId,
            );
        }
        await disk.lookAgain();
        // The active elements, copied back (each read back).
        const active = (t.items ?? []).filter(isActive);
        const total = Math.max(
          1,
          active.reduce((s, r) => s + Number(r.size ?? 0), 0),
        );
        let done = 0;
        for (const r of active) {
          if (job.signal.aborted) break;
          const item = store.get<ItemRow & { updated_at: string }>(
            'items',
            String(r.id),
          ) as ItemRow | null;
          const copy = item ? disk.copyOf(item.id, p.diskId) : null;
          if (!item?.rel_path || !copy) {
            report.problems.push({ name: String(r.name), reason: 'pas de copie sur ce disque' });
            continue;
          }
          job.progress(0.05 + 0.93 * (done / total), item.name);
          const source = path.join(p.folder, ...copy.rel_path.split('/'));
          const target = library.abs(item.rel_path);
          if (existsSync(target)) {
            if ((await fingerprint(target)) === copy.sha256) {
              report.already++;
              done += item.size;
              continue;
            }
          }
          if (!existsSync(source)) {
            report.problems.push({ name: item.name, reason: 'introuvable sur le disque' });
            continue;
          }
          const temp = ctx.files.dataPath('tmp', newId());
          try {
            const back = await copyVerified(source, temp, {
              signal: job.signal,
              onBytes: (n) => {
                done += n / 2;
              },
            });
            if (copy.sha256 && back.sha256 !== copy.sha256) {
              await rm(temp, { recursive: true, force: true });
              report.problems.push({
                name: item.name,
                reason: 'empreinte différente sur le disque : non restauré',
              });
              continue;
            }
            const dirRel =
              path.posix.dirname(item.rel_path) === '.' ? '' : path.posix.dirname(item.rel_path);
            const dirAbs = library.abs(dirRel);
            await mkdir(dirAbs, { recursive: true });
            // A different file already at its place is never replaced: another name.
            let name = path.posix.basename(item.rel_path);
            if (existsSync(path.join(dirAbs, name))) {
              name = library.freeIn(dirAbs, name);
              report.conflicts.push({ name: item.name, restoredAs: name });
            }
            await rename(temp, path.join(dirAbs, name));
            store.update('items', item.id, {
              rel_path: dirRel ? `${dirRel}/${name}` : name,
              name,
              sha256: back.sha256,
              size: back.size,
              stat_json: null,
            });
            report.copied++;
          } catch (error) {
            await rm(temp, { recursive: true, force: true }).catch(() => undefined);
            if (job.signal.aborted) break;
            report.problems.push({ name: item.name, reason: (error as Error).message });
          }
        }
        job.progress(1, 'Terminé');
        return report;
      }),
  );

  /** POST /restore/apply { path, confirm }: the restoration, as a job (progress, « Annuler »). */
  ctx.routes.post('/restore/apply', async (request) => {
    const b = requestBody(request);
    if (b.confirm !== true) throw new HttpError(400, 'Restaurer : confirmation nécessaire');
    if (typeof b.path !== 'string') throw new HttpError(400, 'Dossier manquant');
    await preview(b.path); // refuses what is not a coffre, before the job
    const job = ctx.jobs.enqueue(
      'disk-restore',
      { path: b.path },
      { title: 'Coffre : restauration depuis le disque' },
    );
    return { jobId: job.id };
  });
}
