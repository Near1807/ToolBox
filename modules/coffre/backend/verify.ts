// v0.46.0 H: « Vérifier le disque » — on request, long, cancellable: every
// file of the disk (current versions, history, Recycle Bin) read again and its
// fingerprint compared with the expected one. NOTHING is corrected alone: the
// report proposes « Recopier depuis le PC » when the PC has the same version,
// and says so when it does not. ADR 0055.
import { existsSync } from 'node:fs';
import { HttpError, requestBody, type JobRunContext } from '@hub/sdk/core';
import { Cancelled, fingerprint } from './copy';
import { isInDiskTrash } from './disk-layout';
import type { CoffreDeps, DiskManager } from './disk';
import { versionsOf } from './disk-routes';
import type { CopyRow, DiskRow, ItemRow } from './rows';

export interface VerifyProblem {
  itemId: string;
  name: string;
  where: 'actuel' | 'historique' | 'corbeille';
  path: string;
  problem: 'abîmé' | 'manquant';
  /** The PC has this very version: « Recopier depuis le PC » is possible. */
  canRecopy: boolean;
}

export interface VerifyReport {
  at: string;
  checked: number;
  bytes: number;
  problems: VerifyProblem[];
  stopped: string | null;
}

export function registerVerifyRoutes(d: CoffreDeps, disk: DiskManager): void {
  const { ctx, store } = d;

  ctx.jobs.define<Record<string, never>, VerifyReport>(
    'disk-verify',
    async (job: JobRunContext<Record<string, never>>) =>
      disk.exclusive('vérification du disque', async () => {
        const row = disk.disk()!;
        const root = disk.rootOrThrow();
        const report: VerifyReport = {
          at: new Date().toISOString(),
          checked: 0,
          bytes: 0,
          problems: [],
          stopped: null,
        };
        const copies = ctx.db
          .prepare(`SELECT * FROM ${d.t.copies} WHERE deleted_at IS NULL AND disk_id = ?`)
          .all(row.id) as CopyRow[];
        const versions = versionsOf(d, row.id);
        const items = new Map(
          (ctx.db.prepare(`SELECT * FROM ${d.t.items}`).all() as ItemRow[]).map((i) => [i.id, i]),
        );
        const targets = [
          ...copies.map((c) => ({
            itemId: c.item_id,
            name: items.get(c.item_id)?.name ?? c.rel_path,
            where: (isInDiskTrash(c.rel_path) ? 'corbeille' : 'actuel') as VerifyProblem['where'],
            path: c.rel_path,
            sha256: c.sha256,
            size: c.size,
          })),
          ...versions.map((v) => ({
            itemId: v.item_id,
            name: v.name,
            where: 'historique' as const,
            path: v.rel_path,
            sha256: v.sha256,
            size: v.size,
          })),
        ];
        const total = Math.max(
          1,
          targets.reduce((s, t) => s + t.size, 0),
        );
        let done = 0;
        try {
          for (const t of targets) {
            if (job.signal.aborted) throw new Cancelled();
            job.progress(done / total, `${report.checked + 1} / ${targets.length} · ${t.name}`);
            const file = disk.abs(root, t.path);
            const item = items.get(t.itemId);
            const canRecopy =
              t.where === 'actuel' &&
              Boolean(
                item &&
                !item.deleted_at &&
                !item.trashed_at &&
                !item.archived_at &&
                item.sha256 === t.sha256,
              );
            if (!existsSync(file)) {
              report.problems.push({ ...pick(t), problem: 'manquant', canRecopy });
            } else {
              const sha = await fingerprint(file, {
                signal: job.signal,
                onBytes: (n) => {
                  done += n;
                },
              });
              if (t.sha256 && sha !== t.sha256)
                report.problems.push({ ...pick(t), problem: 'abîmé', canRecopy });
              report.bytes += t.size;
            }
            report.checked++;
          }
        } catch (error) {
          report.stopped =
            error instanceof Cancelled || job.signal.aborted
              ? 'Annulée : ce qui a été relu est dans le rapport.'
              : (error as Error).message;
          if (!(error instanceof Cancelled)) throw error;
        } finally {
          store.update<DiskRow>('disks', row.id, { last_verify_json: JSON.stringify(report) });
        }
        job.progress(1, 'Terminé');
        return report;
      }),
  );

  ctx.routes.post('/disk/verify', async () => {
    disk.rootOrThrow();
    if (disk.busy) throw new HttpError(409, `Le disque est occupé : ${disk.busy}`);
    const job = ctx.jobs.enqueue('disk-verify', {}, { title: 'Coffre : vérification du disque' });
    return { jobId: job.id };
  });

  ctx.routes.get('/disk/verify', () => {
    const row = disk.disk();
    return row?.last_verify_json ? (JSON.parse(row.last_verify_json) as VerifyReport) : null;
  });

  /**
   * « Recopier depuis le PC » (a click on the report): the damaged copies are
   * marked; the next update sets them aside (_ToolBox/Abimes) and copies the
   * PC's version again. A missing one is copied again anyway.
   */
  ctx.routes.post('/disk/repair', (request) => {
    const ids = Array.isArray(requestBody(request).itemIds)
      ? (requestBody(request).itemIds as unknown[]).map(String)
      : [];
    const row = disk.disk();
    if (!row) throw new HttpError(409, 'Aucun disque du coffre');
    let marked = 0;
    for (const id of ids) {
      const copy = disk.copyOf(id, row.id);
      const item = store.get<ItemRow & { updated_at: string }>('items', id) as ItemRow | null;
      if (!copy || !item || item.sha256 !== copy.sha256 || item.archived_at) continue;
      store.update('copies', copy.id, { damaged_at: new Date().toISOString() });
      marked++;
    }
    return { marked };
  });
}

function pick(t: { itemId: string; name: string; where: VerifyProblem['where']; path: string }) {
  return { itemId: t.itemId, name: t.name, where: t.where, path: t.path };
}
