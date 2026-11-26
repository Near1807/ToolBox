// v0.49.0 E: « Réinitialiser le Coffre » — the preview and its warnings (original
// gone, changed on one side, archived), the export, the inventory (CSV + JSON),
// the confirmation « vider », the Coffre's files in the (simulated) Windows
// Recycle Bin, the disk's folder RENAMED (nothing removed), the disk absent →
// proposed at its next plug-in, the other modules untouched, a new deposit OK.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHost, dumpTables } from '@hub/sdk/testing';
import type {
  FolderDto,
  DiskStatusDto,
  ItemDto,
  ResetPreviewDto,
  ResetReport,
} from '../shared/types';
import {
  API,
  deposit,
  diskWorld,
  job as runJob,
  ok,
  registerDisk,
  snapshot,
  status,
  waitJob,
  type DiskWorld,
} from './disk-helpers';

let w: DiskWorld | null = null;
afterEach(async () => {
  await w?.close();
  w = null;
});

/** A host whose « Recycle Bin » is a folder (the real one is Electron's shell.trashItem). */
function trashWorld() {
  const bin = mkdtempSync(path.join(tmpdir(), 'corbeille-windows-'));
  const host = createTestHost({
    trashItem: async (target) => {
      await rename(target, path.join(bin, `${Date.now()}-${path.basename(target)}`));
    },
  });
  return { bin, host };
}

const update = async (W: DiskWorld) =>
  waitJob(W, (await ok<{ jobId: string }>(W, 'POST', `${API}/disk/update`)).jobId);

describe('réinitialiser le Coffre', () => {
  it('aperçu et avertissements ; export ; inventaire ; « vider » ; corbeille de Windows ; disque renommé ; autres modules intacts ; nouveau dépôt', async () => {
    const { bin, host } = trashWorld();
    w = await diskWorld({ host, others: ['todo'] });
    const W = w;
    // The To-do: another module, never touched.
    await ok(W, 'POST', '/api/modules/todo/tasks', { title: 'Réviser la thermo' });
    const [same, gone, changed, archived] = await deposit(
      W,
      {
        'pareil.md': 'identique',
        'disparu.md': 'perdu',
        'change.md': 'avant',
        'vieux.pdf': 'archive',
      },
      ['Cours', 'Thermo'],
    );
    void same;
    await deposit(W, { 'notes.md': 'à part' }, ['Perso']);
    const s = await registerDisk(W, path.join(W.E, 'S'));
    await update(W);
    await runJob(W, 'POST', `${API}/files/archive`, { ids: [archived!.id], confirm: true });
    // The original of « disparu » removed, the one of « change » modified.
    renameSync(path.join(W.dl, 'disparu.md'), path.join(W.dl, '..', 'ailleurs.md'));
    writeFileSync(path.join(W.dl, 'change.md'), 'après');
    const todoBefore = dumpTables(W.hub.dataDir, 'todo__');

    const preview = await runJob<ResetPreviewDto>(W, 'POST', `${API}/reset/preview`, {});
    expect(preview).toMatchObject({ items: 5, folders: 3, archived: 1 });
    expect(preview.disk).toMatchObject({ connected: true });
    const reasons = Object.fromEntries(preview.onlyHere.map((o) => [o.name, o.reason]));
    expect(reasons).toEqual({
      'disparu.md': 'original-absent',
      'change.md': 'original-different',
      'vieux.pdf': 'archived',
    });
    expect(gone && changed).toBeTruthy();

    // « Exporter ces éléments d'abord »: copies, by folder, the archived one read from the disk.
    const out = mkdtempSync(path.join(tmpdir(), 'export-'));
    const exp = await runJob<{ exported: number; folder: string }>(
      W,
      'POST',
      `${API}/reset/export`,
      {
        ids: preview.onlyHere.map((o) => o.id),
        dest: out,
      },
    );
    expect(exp.exported).toBe(3);
    expect(readFileSync(path.join(exp.folder, 'Cours', 'Thermo', 'vieux.pdf'), 'utf8')).toBe(
      'archive',
    );

    // Without « vider »: refused at once.
    const inventoryDir = mkdtempSync(path.join(tmpdir(), 'documents-'));
    const refused = await W.hub.request('POST', `${API}/reset/apply`, {
      inventoryDir,
      confirm: 'oui',
    });
    expect(refused.status).toBe(400);

    const diskBefore = snapshot(s.root!);
    const report = await runJob<ResetReport>(W, 'POST', `${API}/reset/apply`, {
      inventoryDir,
      confirm: 'vider',
      forgetRules: false,
      keepDisk: true,
    });
    // The inventory: readable without ToolBox.
    const csv = readFileSync(path.join(report.inventory, 'inventaire.csv'), 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toMatch(/"change\.md";"Cours › Thermo"/);
    const json = JSON.parse(
      readFileSync(path.join(report.inventory, 'inventaire.json'), 'utf8'),
    ) as {
      elements: { nom: string; etatDisque: string }[];
    };
    expect(json.elements.map((e) => e.nom).sort()).toEqual(
      ['change.md', 'disparu.md', 'notes.md', 'pareil.md', 'vieux.pdf'].sort(),
    );
    expect(json.elements.find((e) => e.nom === 'vieux.pdf')!.etatDisque).toBe('archived');
    // The Coffre empty; its files in the Recycle Bin (not deleted).
    expect(await ok<ItemDto[]>(W, 'GET', `${API}/files`)).toEqual([]);
    expect(await ok<FolderDto[]>(W, 'GET', `${API}/folders`)).toEqual([]);
    const inBin = readdirSync(bin)
      .map((n) => n.replace(/^\d+-/, ''))
      .sort();
    expect(inBin).toEqual(expect.arrayContaining(['Cours', 'Perso']));
    expect(
      readFileSync(
        path.join(
          bin,
          readdirSync(bin).find((n) => n.endsWith('-Cours'))!,
          'Thermo',
          'pareil.md',
        ),
        'utf8',
      ),
    ).toBe('identique');
    expect(existsSync(report.backup) || report.backup.length > 0).toBe(true);
    // The disk: renamed, nothing removed; a new empty folder registered at the same place.
    expect(report.diskFolder).toMatch(/ToolBox-Coffre-ancien-\d{4}-\d{2}-\d{2}$/);
    expect(snapshot(report.diskFolder!)).toEqual(diskBefore);
    const after = await status(W);
    expect(after.connected).toBe(true);
    expect(after.root).toBe(s.root);
    expect(after.disk!.name).toBe(s.disk!.name);
    expect(after.disk!.id).not.toBe(s.disk!.id);
    // The other modules: untouched.
    expect(dumpTables(W.hub.dataDir, 'todo__')).toEqual(todoBefore);
    // Usable again: a new deposit, a disk update.
    const [fresh] = await deposit(W, { 'nouveau.md': 'neuf' }, ['Cours']);
    expect(fresh!.folderPath).toEqual(['Cours']);
    expect((await update(W)).status).toBe('succeeded');
    expect(readFileSync(path.join(s.root!, 'Cours', 'nouveau.md'), 'utf8')).toBe('neuf');
  }, 120_000);

  it('disque absent : rien n’est fait sur le disque ; à son retour, le renommage est proposé (jamais seul) et la mise à jour attend', async () => {
    const { host } = trashWorld();
    w = await diskWorld({ host });
    const W = w;
    await deposit(W, { 'a.md': 'a' }, ['Cours']);
    const s = await registerDisk(W, path.join(W.E, 'S'));
    await update(W);
    // Unplugged.
    const away = path.join(W.E, '..', 'ailleurs');
    renameSync(path.join(W.E, 'S'), away);
    expect((await status(W)).connected).toBe(false);
    const report = await runJob<ResetReport>(W, 'POST', `${API}/reset/apply`, {
      inventoryDir: mkdtempSync(path.join(tmpdir(), 'documents-')),
      confirm: 'vider',
    });
    expect(report).toMatchObject({ diskFolder: null, diskPending: true });
    // Plugged back: proposed, never done alone; the update waits for it.
    renameSync(away, path.join(W.E, 'S'));
    const back = await status(W);
    expect(back.connected).toBe(true);
    expect(back.refuses).toMatch(/renomme d’abord son ancien dossier/);
    expect(await ok(W, 'GET', `${API}/reset/pending`)).toMatchObject({ connected: true });
    expect(existsSync(path.join(W.E, 'S', 'ToolBox-Coffre', 'Cours', 'a.md'))).toBe(true);
    expect((await W.hub.request('POST', `${API}/disk/update`)).status).toBe(409);
    const renamed = await runJob<{ folder: string }>(W, 'POST', `${API}/reset/disk-rename`, {});
    expect(readFileSync(path.join(renamed.folder, 'Cours', 'a.md'), 'utf8')).toBe('a');
    expect(await ok(W, 'GET', `${API}/reset/pending`)).toBeNull();
    const now = await status(W);
    expect(now).toMatchObject({ connected: true, refuses: null });
    expect(now.root).toBe(s.root);
    mkdirSync(path.join(W.dl, 'x'), { recursive: true });
    expect((await update(W)).status).toBe('succeeded');
    void (now as DiskStatusDto);
  }, 120_000);
});
