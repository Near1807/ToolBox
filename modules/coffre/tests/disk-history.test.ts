// v0.46.0 D and E: the history and its quota (oldest first, never the current
// files nor the archives, a version larger than the quota kept), « Restaurer
// cette version » (confirmed, « Annuler »), the disk's Recycle Bin (recover
// with its sheet; erasing never automatic, only confirmed).
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiskStatusDto, ItemDto, UpdateReport } from '../shared/types';
import {
  API,
  deposit,
  diskWorld,
  ok,
  registerDisk,
  status,
  waitJob,
  type DiskWorld,
} from './disk-helpers';

let w: DiskWorld;
afterEach(async () => {
  await w?.close();
});

const lib = (...p: string[]) => path.join(w.hub.dataDir, 'coffre', ...p);
async function update(): Promise<UpdateReport> {
  const { jobId } = await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`);
  const job = await waitJob(w, jobId);
  expect(job.status, job.error ?? '').toBe('succeeded');
  return job.result as UpdateReport;
}
/** A change made on the PC (another application): new content, a later date. */
function change(file: string, content: string | Buffer, seconds: number) {
  writeFileSync(file, content);
  utimesSync(file, new Date(), new Date(Date.now() + seconds * 1000));
}

describe('historique et quota', () => {
  it('les plus anciennes versions d’abord ; jamais les fichiers actuels ni les archives', async () => {
    w = await diskWorld();
    const [doc] = await deposit(w, { 'rapport.docx': Buffer.alloc(400 * 1024, 1) });
    await deposit(w, { 'archive.pdf': Buffer.alloc(900 * 1024, 9) }, ['Archives']);
    const s = await registerDisk(w, path.join(w.E, 'S'));
    await ok(w, 'PUT', '/api/core/settings/coffre', { historyQuotaGb: 0.001 }); // ≈ 1 Mio
    await update();
    const pc = lib('Cours', 'Thermo', 'rapport.docx');
    for (let v = 2; v <= 4; v++) {
      change(pc, Buffer.alloc(400 * 1024, v), v * 10);
      await update();
    }
    // Versions 1, 2, 3 were kept (1.2 Mio) > 1 Mio: the oldest (v1) removed.
    const history = path.join(s.root!, '_ToolBox', 'Historique', doc!.id);
    const kept = readdirSync(history).map((f) => readFileSync(path.join(history, f))[0]);
    expect(kept.sort()).toEqual([2, 3]);
    expect(readFileSync(path.join(s.root!, 'Cours', 'Thermo', 'rapport.docx'))[0]).toBe(4);
    expect(existsSync(path.join(s.root!, 'Archives', 'archive.pdf'))).toBe(true);
    const status1 = await status(w);
    expect(status1.bytes.history).toBe(2 * 400 * 1024);
    expect(status1.bytes.history).toBeLessThanOrEqual(status1.quota);
  });

  it('une version plus grosse que tout le quota : gardée, signalée, rien d’autre retiré', async () => {
    w = await diskWorld();
    await deposit(w, { 'big.bin': Buffer.alloc(2 * 1024 * 1024, 1), 'small.txt': 'v1' });
    await registerDisk(w, path.join(w.E, 'S'));
    await ok(w, 'PUT', '/api/core/settings/coffre', { historyQuotaGb: 0.001 });
    await update();
    change(lib('Cours', 'Thermo', 'small.txt'), 'v2', 10);
    await update();
    change(lib('Cours', 'Thermo', 'big.bin'), Buffer.alloc(2 * 1024 * 1024, 2), 20);
    const r = await update();
    expect(r.oversized).toEqual(['big.bin']);
    expect(r.removedVersions).toBe(0);
    const s = await status(w);
    expect(s.bytes.history).toBe(2 * 1024 * 1024 + 2);
  });
});

describe('restaurer une version', () => {
  it('confirmée : elle redevient l’actuelle, l’actuelle part dans l’historique ; « Annuler »', async () => {
    w = await diskWorld();
    const [doc] = await deposit(w, { 'synthese.md': 'v1' });
    await registerDisk(w, path.join(w.E, 'S'));
    await update();
    const pc = lib('Cours', 'Thermo', 'synthese.md');
    change(pc, 'v2', 10);
    await update();
    const { versions } = await ok<{ versions: { id: string; size: number }[] }>(
      w,
      'GET',
      `${API}/items/${doc!.id}/versions`,
    );
    expect(versions).toHaveLength(1);
    const url = `${API}/items/${doc!.id}/versions/${versions[0]!.id}/restore`;
    expect((await w.hub.request('POST', url, {})).status).toBe(400);
    const r = await ok<{ undoId: string }>(w, 'POST', url, { confirm: true });
    expect(readFileSync(pc, 'utf8')).toBe('v1');
    expect((await ok<ItemDto>(w, 'GET', `${API}/items/${doc!.id}`)).diskState).toBe('pending');
    await ok(w, 'POST', `${API}/undo`, { undoId: r.undoId });
    expect(readFileSync(pc, 'utf8')).toBe('v2');
    // Again, and an update: the disk's current is v1, v2 in the history.
    await ok(w, 'POST', url, { confirm: true });
    await update();
    const s = await status(w);
    expect(readFileSync(path.join(s.root!, 'Cours', 'Thermo', 'synthese.md'), 'utf8')).toBe('v1');
    const after = await ok<{ versions: { id: string }[] }>(
      w,
      'GET',
      `${API}/items/${doc!.id}/versions`,
    );
    expect(after.versions).toHaveLength(2);
  });

  it('une version pas encore sur le disque est d’abord mise dans l’historique', async () => {
    w = await diskWorld();
    const [doc] = await deposit(w, { 'code.py': 'v1' });
    await registerDisk(w, path.join(w.E, 'S'));
    await update();
    const pc = lib('Cours', 'Thermo', 'code.py');
    change(pc, 'v2', 10);
    await update();
    change(pc, 'v3 jamais copiée', 20);
    const { versions } = await ok<{ versions: { id: string }[] }>(
      w,
      'GET',
      `${API}/items/${doc!.id}/versions`,
    );
    await ok(w, 'POST', `${API}/items/${doc!.id}/versions/${versions[0]!.id}/restore`, {
      confirm: true,
    });
    expect(readFileSync(pc, 'utf8')).toBe('v1');
    const after = await ok<{ versions: { id: string; name: string }[] }>(
      w,
      'GET',
      `${API}/items/${doc!.id}/versions`,
    );
    // v3 (never on the disk) is now kept there too.
    const s = await status(w);
    const history = path.join(s.root!, '_ToolBox', 'Historique', doc!.id);
    expect(
      readdirSync(history)
        .map((f) => readFileSync(path.join(history, f), 'utf8'))
        .sort(),
    ).toEqual(['v1', 'v3 jamais copiée']);
    expect(after.versions).toHaveLength(2);
  });
});

describe('corbeille du disque', () => {
  it('un supprimé y va ; effacé du PC, il se récupère avec sa fiche ; effacer : seulement confirmé', async () => {
    w = await diskWorld();
    const [doc] = await deposit(w, { 'contrat.pdf': 'signé' });
    await ok(w, 'PUT', `${API}/items/${doc!.id}/attributes`, { key: 'tag', values: ['important'] });
    const s = await registerDisk(w, path.join(w.E, 'S'));
    await update();
    await ok(w, 'DELETE', `${API}/items/${doc!.id}`);
    await update();
    await ok(w, 'POST', `${API}/items/${doc!.id}/erase`, { confirm: true });
    const trash = await ok<{ itemId: string; onPc: boolean; old: boolean }[]>(
      w,
      'GET',
      `${API}/disk/trash`,
    );
    expect(trash).toMatchObject([{ itemId: doc!.id, onPc: false, old: false }]);
    // Recovered: back on the PC, its tag with it; the next update takes it out of the Recycle Bin.
    await ok(w, 'POST', `${API}/disk/trash/recover`, { itemId: doc!.id });
    const back = await ok<ItemDto>(w, 'GET', `${API}/items/${doc!.id}`);
    expect(back.attributes.map((a) => a.value)).toContain('important');
    expect(readFileSync(lib('Cours', 'Thermo', 'contrat.pdf'), 'utf8')).toBe('signé');
    await update();
    expect(readFileSync(path.join(s.root!, 'Cours', 'Thermo', 'contrat.pdf'), 'utf8')).toBe(
      'signé',
    );
    expect(await ok(w, 'GET', `${API}/disk/trash`)).toEqual([]);
    // Deleted again: erasing from the disk's Recycle Bin needs the confirmation.
    await ok(w, 'DELETE', `${API}/items/${doc!.id}`);
    await update();
    const trashed = path.join(s.root!, '_ToolBox', 'Corbeille', doc!.id, 'contrat.pdf');
    expect(existsSync(trashed)).toBe(true);
    expect(
      (await w.hub.request('POST', `${API}/disk/trash/erase`, { itemIds: [doc!.id] })).status,
    ).toBe(400);
    expect(existsSync(trashed)).toBe(true);
    await ok(w, 'POST', `${API}/disk/trash/erase`, { itemIds: [doc!.id], confirm: true });
    expect(existsSync(trashed)).toBe(false);
  });

  it('après 30 jours : proposé, jamais effacé seul', async () => {
    w = await diskWorld();
    const [doc] = await deposit(w, { 'vieux.txt': 'vieux' });
    const s = await registerDisk(w, path.join(w.E, 'S'));
    await update();
    await ok(w, 'DELETE', `${API}/items/${doc!.id}`);
    await update();
    // 31 days later.
    const db = new Database(path.join(w.hub.dataDir, 'hub.db'));
    db.prepare("UPDATE coffre__copies SET trashed_at = '2020-01-01T00:00:00.000Z'").run();
    db.close();
    const st: DiskStatusDto = await status(w);
    expect(st.oldTrash).toBe(1);
    await update();
    await update();
    expect(existsSync(path.join(s.root!, '_ToolBox', 'Corbeille', doc!.id, 'vieux.txt'))).toBe(
      true,
    );
    expect((await status(w)).oldTrash).toBe(1);
  });
});
