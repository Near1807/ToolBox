// v0.46.0 F, G, H: archive (both copies read again first), read from the disk,
// never modified directly, reactivate (room checked); « Restaurer depuis un
// disque » on an empty ToolBox (same fingerprints); « Vérifier le disque »
// (an altered file found, nothing corrected alone).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHost } from '@hub/sdk/testing';
import { Library } from '../backend/library';
import type { ItemDto, UpdateReport } from '../shared/types';
import {
  API,
  deposit,
  diskWorld,
  ok,
  registerDisk,
  sha,
  status,
  waitJob,
  type DiskWorld,
  job as runJob,
} from './disk-helpers';

const worlds: DiskWorld[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (worlds.length) await worlds.pop()!.close();
});
async function world(options: Parameters<typeof diskWorld>[0] = {}) {
  const w = await diskWorld(options);
  worlds.push(w);
  return w;
}
const lib = (w: DiskWorld, ...p: string[]) => path.join(w.hub.dataDir, 'coffre', ...p);
async function run(w: DiskWorld, url: string, body?: unknown) {
  const { jobId } = await ok<{ jobId: string }>(w, 'POST', url, body);
  return waitJob(w, jobId);
}
const update = async (w: DiskWorld) => {
  const job = await run(w, `${API}/disk/update`);
  expect(job.status, job.error ?? '').toBe('succeeded');
  return job.result as UpdateReport;
};
const item = (w: DiskWorld, id: string) => ok<ItemDto>(w, 'GET', `${API}/files/${id}`);

describe('archiver et réactiver', () => {
  it('seulement actif et disque branché ; les deux copies relues ; place libérée ; trouvable ; lu depuis le disque', async () => {
    const opened: string[] = [];
    const w = await world({
      host: createTestHost({ openPath: async (p: string) => void opened.push(p) }),
    });
    const [doc] = await deposit(w, { 'cours.pdf': '%PDF cours' });
    const s = await registerDisk(w, path.join(w.E, 'S'));
    const refused = await runJob<{ archived: number; refused: { reason: string }[] }>(
      w,
      'POST',
      `${API}/files/archive`,
      {
        ids: [doc!.id],
        confirm: true,
      },
    );
    expect(refused.archived).toBe(0);
    expect(refused.refused[0]!.reason).toMatch(/pas encore sur le disque/);
    expect((await w.hub.request('POST', `${API}/files/archive`, { ids: [doc!.id] })).status).toBe(
      400,
    );
    await update(w);
    const r = await runJob<{ archived: number; freed: number }>(w, 'POST', `${API}/files/archive`, {
      ids: [doc!.id],
      confirm: true,
    });
    expect(r).toMatchObject({ archived: 1, freed: 10 });
    expect(existsSync(lib(w, 'Cours', 'Thermo', 'cours.pdf'))).toBe(false);
    const a = await item(w, doc!.id);
    expect(a.diskState).toBe('archived');
    expect(a.url).toMatch(/^\/api\/media\//);
    // Read from the disk by the app's own server.
    expect((await w.hub.request('GET', a.url!)).status).toBe(200);
    // Not modified directly: reactivate, or a read-only copy.
    const direct = await w.hub.request('POST', `${API}/files/${doc!.id}/open`, { how: 'app' });
    expect(direct.status).toBe(409);
    const copy = await ok<{ copy: string }>(w, 'POST', `${API}/files/${doc!.id}/open`, {
      how: 'readcopy',
    });
    expect(opened).toEqual([copy.copy]);
    expect(readFileSync(copy.copy, 'utf8')).toBe('%PDF cours');
    expect(statSync(copy.copy).mode & 0o222).toBe(0);
    // Unplugged: greyed, findable, « Branche le disque ».
    renameSync(path.join(w.E, 'S'), path.join(w.F, 'S'));
    renameSync(path.join(w.F, 'S'), path.join(w.E, '..', 'ailleurs'));
    await status(w);
    const away = await item(w, doc!.id);
    expect(away).toMatchObject({ diskState: 'archived', unavailable: true, url: null });
    const found = await ok<ItemDto[]>(w, 'GET', `${API}/files?folder=${a.folderId}`);
    expect(found.map((i) => i.id)).toContain(doc!.id);
    const closed = await w.hub.request('POST', `${API}/files/${doc!.id}/open`, { how: 'readcopy' });
    expect(JSON.stringify(closed.body)).toMatch(/Branche le disque « Disque 1 To »/);
    // Back on another letter: it opens.
    renameSync(path.join(w.E, '..', 'ailleurs'), path.join(w.F, 'S'));
    expect((await status(w)).root).toBe(path.join(w.F, 'S', 'ToolBox-Coffre'));
    expect((await item(w, doc!.id)).unavailable).toBe(false);
    // Reactivated: back on the PC, active.
    await runJob(w, 'POST', `${API}/files/${doc!.id}/reactivate`);
    expect(readFileSync(lib(w, 'Cours', 'Thermo', 'cours.pdf'), 'utf8')).toBe('%PDF cours');
    expect((await item(w, doc!.id)).diskState).toBe('active');
    void s;
  });

  it('empreinte différente au moment d’archiver : rien n’est retiré du PC', async () => {
    const w = await world();
    const [doc] = await deposit(w, { 'note.md': 'texte juste' });
    const s = await registerDisk(w, path.join(w.E, 'S'));
    await update(w);
    writeFileSync(path.join(s.root!, 'Cours', 'Thermo', 'note.md'), 'texte FAUX!'); // same size
    const r = await runJob<{ archived: number; refused: { reason: string }[] }>(
      w,
      'POST',
      `${API}/files/archive`,
      {
        ids: [doc!.id],
        confirm: true,
      },
    );
    expect(r.archived).toBe(0);
    expect(r.refused[0]!.reason).toMatch(/copie du disque ne correspond pas/);
    expect(readFileSync(lib(w, 'Cours', 'Thermo', 'note.md'), 'utf8')).toBe('texte juste');
  });

  it('un archivé change de dossier : le disque suit ; son nom lui reste réservé sur le PC', async () => {
    const w = await world();
    const [doc] = await deposit(w, { 'plan.pdf': 'P' });
    const s = await registerDisk(w, path.join(w.E, 'S'));
    await update(w);
    await runJob(w, 'POST', `${API}/files/archive`, { ids: [doc!.id], confirm: true });
    // Another « plan.pdf » in the same folder never takes the archived one's place.
    const [other] = await deposit(w, { 'plan.pdf': 'autre' });
    expect(other!.name).toBe('plan (2).pdf');
    await ok(w, 'PATCH', `${API}/files/${doc!.id}`, { newFolder: ['Archives', '2025'] });
    expect((await status(w)).counts.move).toBe(1);
    await update(w);
    expect(readFileSync(path.join(s.root!, 'Archives', '2025', 'plan.pdf'), 'utf8')).toBe('P');
    await runJob(w, 'POST', `${API}/files/${doc!.id}/reactivate`);
    expect(readFileSync(lib(w, 'Archives', '2025', 'plan.pdf'), 'utf8')).toBe('P');
  });

  it('réactiver sans assez de place sur le PC : refusé, rien ne change', async () => {
    const w = await world();
    const [doc] = await deposit(w, { 'video.mp4': Buffer.alloc(1024, 2) });
    await registerDisk(w, path.join(w.E, 'S'));
    await update(w);
    await runJob(w, 'POST', `${API}/files/archive`, { ids: [doc!.id], confirm: true });
    vi.spyOn(Library.prototype, 'disk').mockResolvedValue({ free: 1000, total: 10_000 });
    const { jobId } = await ok<{ jobId: string }>(w, 'POST', `${API}/files/${doc!.id}/reactivate`);
    const r = await waitJob(w, jobId);
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/Pas assez de place sur le PC/);
    expect((await item(w, doc!.id)).diskState).toBe('archived');
    expect(existsSync(lib(w, 'Cours', 'Thermo', 'video.mp4'))).toBe(false);
  });

  it('suggestions : pas ouverts depuis 6 mois, jamais appliquées seules', async () => {
    const w = await world();
    const [a, b] = await deposit(w, { 'vieux.pdf': 'v', 'recent.pdf': 'r' });
    await registerDisk(w, path.join(w.E, 'S'));
    await update(w);
    const db = new Database(path.join(w.hub.dataDir, 'hub.db'));
    db.prepare("UPDATE coffre__items SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(
      a!.id,
    );
    db.close();
    const s = await ok<{ count: number; ids: string[] }>(w, 'GET', `${API}/suggestions/archive`);
    expect(s).toMatchObject({ count: 1, ids: [a!.id] });
    await new Promise((r) => setTimeout(r, 100));
    expect((await item(w, a!.id)).diskState).toBe('active');
    void b;
  });
});

describe('restaurer depuis un disque', () => {
  it('sur un ToolBox vide : fiches reprises, actifs recopiés (mêmes empreintes), archivés laissés sur le disque', async () => {
    const w1 = await world();
    const [cours, tp, vieux] = await deposit(w1, {
      'cours.pdf': '%PDF',
      'tp.py': 'print(1)',
      'vieux.docx': 'archivé',
    });
    await ok(w1, 'PUT', `${API}/files/${tp!.id}/labels`, { family: 'free', values: ['à rendre'] });
    const proj = path.join(w1.dl, 'projet');
    mkdirSync(path.join(proj, 'src'), { recursive: true });
    writeFileSync(path.join(proj, 'src', 'main.rs'), 'fn main(){}');
    await runJob(w1, 'POST', `${API}/deposit/apply`, {
      entries: [{ path: proj, newFolder: ['Code'], labels: [] }],
    });
    await registerDisk(w1, path.join(w1.E, 'S'));
    await update(w1);
    await runJob(w1, 'POST', `${API}/files/archive`, { ids: [vieux!.id], confirm: true });
    await update(w1);
    const before = await ok<ItemDto[]>(w1, 'GET', `${API}/files`);
    // A new PC, empty, the same disk plugged in.
    const w2 = await world({ volumes: { E: w1.E, F: w1.F } });
    const preview = await ok<{
      active: number;
      archived: number;
      pcItems: number;
      registered: string;
    }>(w2, 'POST', `${API}/restore/preview`, { path: path.join(w1.E, 'S') });
    expect(preview).toMatchObject({ active: 3, archived: 1, pcItems: 0, registered: 'none' });
    expect(
      (await w2.hub.request('POST', `${API}/restore/apply`, { path: path.join(w1.E, 'S') })).status,
    ).toBe(400);
    const job = await run(w2, `${API}/restore/apply`, {
      path: path.join(w1.E, 'S'),
      confirm: true,
    });
    expect(job.status, job.error ?? '').toBe('succeeded');
    expect(job.result).toMatchObject({ copied: 3, backup: null, conflicts: [] });
    const after = await ok<ItemDto[]>(w2, 'GET', `${API}/files`);
    const key = (i: ItemDto) =>
      `${i.id}|${i.name}|${i.sha256}|${i.folderPath?.join('>')}|${i.diskState}`;
    expect(after.map(key).sort()).toEqual(before.map(key).sort());
    expect(sha(lib(w2, 'Cours', 'Thermo', 'cours.pdf'))).toBe(
      sha(lib(w1, 'Cours', 'Thermo', 'cours.pdf')),
    );
    expect(readFileSync(lib(w2, 'Code', 'projet', 'src', 'main.rs'), 'utf8')).toBe('fn main(){}');
    expect(existsSync(lib(w2, 'Cours', 'Thermo', 'vieux.docx'))).toBe(false);
    expect((await item(w2, tp!.id)).labels.map((a) => a.value)).toContain('à rendre');
    expect((await status(w2)).connected).toBe(true);
    void cours;
  });

  it('un PC qui a déjà des données : sauvegarde de la base d’abord, rien d’écrasé', async () => {
    const w1 = await world();
    await deposit(w1, { 'commun.txt': 'version du disque' });
    await registerDisk(w1, path.join(w1.E, 'S'));
    await update(w1);
    const w2 = await world({ volumes: { E: w1.E, F: w1.F } });
    await deposit(w2, { 'commun.txt': 'version de ce PC' });
    const job = await run(w2, `${API}/restore/apply`, {
      path: path.join(w1.E, 'S'),
      confirm: true,
    });
    expect(job.status, job.error ?? '').toBe('succeeded');
    const r = job.result as { backup: string; conflicts: { restoredAs: string }[] };
    expect(r.backup).toMatch(/avant-restauration-coffre/);
    expect(existsSync(path.join(w2.hub.dataDir, 'backups', r.backup))).toBe(true);
    expect(readFileSync(lib(w2, 'Cours', 'Thermo', 'commun.txt'), 'utf8')).toBe('version de ce PC');
    expect(r.conflicts[0]!.restoredAs).toBe('commun (2).txt');
    expect(readFileSync(lib(w2, 'Cours', 'Thermo', 'commun (2).txt'), 'utf8')).toBe(
      'version du disque',
    );
  });
});

describe('vérifier le disque', () => {
  it('un fichier abîmé et un manquant trouvés ; rien corrigé seul ; « Recopier depuis le PC »', async () => {
    const w = await world();
    const [a, b] = await deposit(w, { 'a.txt': 'AAAA', 'b.txt': 'v1' });
    const s = await registerDisk(w, path.join(w.E, 'S'));
    await update(w);
    writeFileSync(lib(w, 'Cours', 'Thermo', 'b.txt'), 'v2');
    await ok(w, 'GET', `${API}/disk/plan`);
    await update(w);
    const damaged = path.join(s.root!, 'Cours', 'Thermo', 'a.txt');
    writeFileSync(damaged, 'AAAB');
    const history = path.join(s.root!, '_ToolBox', 'Historique', b!.id);
    const [old] = readdirSync(history);
    renameSync(path.join(history, old!), path.join(tmpdir(), `${old}-${Date.now()}`));
    const job = await run(w, `${API}/disk/verify`);
    expect(job.status).toBe('succeeded');
    const report = job.result as {
      checked: number;
      problems: { itemId: string; problem: string; where: string; canRecopy: boolean }[];
    };
    expect(report.checked).toBe(3);
    expect(report.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: a!.id,
          problem: 'abîmé',
          where: 'actuel',
          canRecopy: true,
        }),
        expect.objectContaining({
          itemId: b!.id,
          problem: 'manquant',
          where: 'historique',
          canRecopy: false,
        }),
      ]),
    );
    // Nothing corrected alone.
    expect(readFileSync(damaged, 'utf8')).toBe('AAAB');
    await ok(w, 'POST', `${API}/disk/repair`, { itemIds: [a!.id] });
    expect((await status(w)).counts.update).toBe(1);
    const r = await update(w);
    expect(r.repaired).toBe(1);
    expect(readFileSync(damaged, 'utf8')).toBe('AAAA');
    expect(readdirSync(path.join(s.root!, '_ToolBox', 'Abimes'))).toHaveLength(1);
    void mkdtempSync;
  });
});
