// v0.46.0 B and C: the states, the PC's changes, and « Mettre à jour » — one
// click, a copy that is read back before it takes its place, moves, the disk's
// Recycle Bin, the history, the room checked first, a cancellation or an
// unplugged disk that leaves the disk consistent, long paths, big files.
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fullRenderTests } from '@hub/sdk/testing';
import { DISK_FOLDER } from '../backend/disk-layout';
import type { DiskStatusDto, ItemDto, UpdateReport } from '../shared/types';
import {
  API,
  deposit,
  diskWorld,
  ok,
  registerDisk,
  sha,
  snapshot,
  status,
  waitJob,
  type DiskWorld,
} from './disk-helpers';

// A hook in the copy (the test's « débrancher » / « annuler » at the first piece written).
const hook: { onFirstBytes: (() => void) | null; free: number | null } = {
  onFirstBytes: null,
  free: null,
};
// The disk's free room, as the watch sees it (a nearly full disk, simulated).
vi.mock('../backend/volumes', async (original) => {
  const m = await original<typeof import('../backend/volumes')>();
  return {
    ...m,
    spaceOf: async (dir: string) => {
      const real = await m.spaceOf(dir);
      return hook.free === null || !real ? real : { ...real, free: hook.free };
    },
  };
});
vi.mock('../backend/copy', async (original) => {
  const m = await original<typeof import('../backend/copy')>();
  return {
    ...m,
    copyVerified: (
      source: string,
      temp: string,
      options: import('../backend/copy').CopyOptions = {},
    ) => {
      let first = true;
      return m.copyVerified(source, temp, {
        ...options,
        onBytes: (n) => {
          if (first && hook.onFirstBytes) {
            first = false;
            const run = hook.onFirstBytes;
            hook.onFirstBytes = null;
            run();
          }
          options.onBytes?.(n);
        },
      });
    },
  };
});

let w: DiskWorld;
afterEach(async () => {
  hook.onFirstBytes = null;
  hook.free = null;
  await w?.close();
});

const lib = (w: DiskWorld, ...p: string[]) => path.join(w.hub.dataDir, 'coffre', ...p);
const item = (w: DiskWorld, id: string) => ok<ItemDto>(w, 'GET', `${API}/items/${id}`);

async function update(
  w: DiskWorld,
): Promise<{ status: string; report: UpdateReport; error: string | null }> {
  const { jobId } = await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`);
  const job = await waitJob(w, jobId);
  const s = await status(w);
  return {
    status: job.status,
    report: (job.result as UpdateReport) ?? s.lastUpdate!,
    error: job.error,
  };
}

async function setup(files: Record<string, string | Buffer>, context?: string[]) {
  w = await diskWorld();
  const created = await deposit(w, files, context);
  const s = await registerDisk(w, path.join(w.E, 'Sauvegardes'));
  return { created, root: s.root! };
}

describe('mettre à jour le disque', () => {
  it('copie, relit, range au même chemin lisible ; les états ; base, fiches et manifeste', async () => {
    const { created, root } = await setup({ 'cours.pdf': 'pdf v1', 'tp.py': 'print(1)' });
    expect((await item(w, created[0]!.id)).diskState).toBe('pending');
    const before = await status(w);
    expect(before.pending).toBe(2);
    expect(before.counts).toEqual({ copy: 2, update: 0, move: 0, trash: 0 });
    const r = await update(w);
    expect(r.status).toBe('succeeded');
    expect(r.report).toMatchObject({ copied: 2, updated: 0, stopped: null, problems: [] });
    const onDisk = path.join(root, 'Cours', 'Thermo', 'cours.pdf');
    expect(readFileSync(onDisk, 'utf8')).toBe('pdf v1');
    expect(sha(onDisk)).toBe(sha(lib(w, 'Cours', 'Thermo', 'cours.pdf')));
    expect((await item(w, created[0]!.id)).diskState).toBe('active');
    const after = await status(w);
    expect(after.pending).toBe(0);
    expect(after.lastUpdateAt).not.toBeNull();
    // The disk suffices to itself.
    for (const f of ['hub.db', 'fiches.json', 'manifeste.json'])
      expect(existsSync(path.join(root, '_ToolBox', 'Base', f)), f).toBe(true);
    const manifest = JSON.parse(
      readFileSync(path.join(root, '_ToolBox', 'Base', 'manifeste.json'), 'utf8'),
    );
    expect(manifest.elements.map((e: { path: string }) => e.path).sort()).toEqual([
      'Cours/Thermo/cours.pdf',
      'Cours/Thermo/tp.py',
    ]);
    expect(readdirSync(path.join(root, '_ToolBox', 'tmp'))).toEqual([]);
    // Nothing more to do: a second click changes nothing.
    expect((await status(w)).counts).toEqual({ copy: 0, update: 0, move: 0, trash: 0 });
  });

  it('modifié dans une autre application : « pas encore sur le disque », puis l’ancienne version dans l’historique', async () => {
    const { created, root } = await setup({ 'rapport.docx': 'version 1' });
    await update(w);
    const pc = lib(w, 'Cours', 'Thermo', 'rapport.docx');
    writeFileSync(pc, 'version 2, plus longue');
    utimesSync(pc, new Date(), new Date(Date.now() + 5000));
    const plan = await ok<{ counts: DiskStatusDto['counts'] }>(w, 'GET', `${API}/disk/plan`);
    expect(plan.counts.update).toBe(1);
    expect((await item(w, created[0]!.id)).diskState).toBe('pending');
    const r = await update(w);
    expect(r.report.updated).toBe(1);
    expect(readFileSync(path.join(root, 'Cours', 'Thermo', 'rapport.docx'), 'utf8')).toBe(
      'version 2, plus longue',
    );
    const history = path.join(root, '_ToolBox', 'Historique', created[0]!.id);
    const [old] = readdirSync(history);
    expect(old).toMatch(/rapport\.docx$/);
    expect(readFileSync(path.join(history, old!), 'utf8')).toBe('version 1');
  });

  it('changement de contexte, renommage, suppression : reproduits ; supprimé = corbeille du disque', async () => {
    const { created, root } = await setup({ 'a.pdf': 'A', 'b.pdf': 'B' });
    await update(w);
    const [a, b] = created;
    await ok(w, 'PATCH', `${API}/items/${a!.id}`, { newContext: ['Perso', 'Administratif'] });
    await ok(w, 'PATCH', `${API}/items/${b!.id}`, { name: 'b renommé.pdf' });
    const s = await status(w);
    expect(s.counts.move).toBe(2);
    const r = await update(w);
    expect(r.report.moved).toBe(2);
    expect(readFileSync(path.join(root, 'Perso', 'Administratif', 'a.pdf'), 'utf8')).toBe('A');
    expect(readFileSync(path.join(root, 'Cours', 'Thermo', 'b renommé.pdf'), 'utf8')).toBe('B');
    expect(existsSync(path.join(root, 'Cours', 'Thermo', 'a.pdf'))).toBe(false);
    await ok(w, 'DELETE', `${API}/items/${a!.id}`);
    expect((await status(w)).counts.trash).toBe(1);
    const r2 = await update(w);
    expect(r2.report.trashed).toBe(1);
    expect(readFileSync(path.join(root, '_ToolBox', 'Corbeille', a!.id, 'a.pdf'), 'utf8')).toBe(
      'A',
    );
    expect(existsSync(path.join(root, 'Perso', 'Administratif', 'a.pdf'))).toBe(false);
  });

  it('deux éléments qui échangent leurs noms ne se gênent pas', async () => {
    const { created, root } = await setup({ 'x.txt': 'X', 'y.txt': 'Y' });
    await update(w);
    const [x, y] = created;
    await ok(w, 'PATCH', `${API}/items/${x!.id}`, { name: 'tmp.txt' });
    await ok(w, 'PATCH', `${API}/items/${y!.id}`, { name: 'x.txt' });
    await ok(w, 'PATCH', `${API}/items/${x!.id}`, { name: 'y.txt' });
    await update(w);
    expect(readFileSync(path.join(root, 'Cours', 'Thermo', 'x.txt'), 'utf8')).toBe('Y');
    expect(readFileSync(path.join(root, 'Cours', 'Thermo', 'y.txt'), 'utf8')).toBe('X');
  });

  it('jamais sans clic : le plan et la surveillance n’écrivent rien sur le disque', async () => {
    const { root } = await setup({ 'cours.pdf': 'pdf' });
    const before = snapshot(root);
    await ok(w, 'GET', `${API}/disk/plan`);
    await status(w);
    await new Promise((r) => setTimeout(r, 200));
    expect(snapshot(root)).toEqual(before);
    expect(existsSync(path.join(root, 'Cours'))).toBe(false);
  });

  it('pas assez de place : refus clair avant d’écrire quoi que ce soit', async () => {
    const { root } = await setup({ 'gros.bin': Buffer.alloc(4096, 1) });
    hook.free = 10_000; // the copies need 4 Kio + the margin
    const plan = await ok<{ needed: number; enough: boolean }>(w, 'GET', `${API}/disk/plan`);
    expect(plan).toMatchObject({ needed: 4096, enough: false });
    const before = snapshot(root);
    const { jobId } = await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`);
    const job = await waitJob(w, jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/Pas assez de place sur le disque.*Rien n'a été écrit/);
    expect(snapshot(root)).toEqual(before);
  });

  it('annulée pendant une copie : rien de faux à sa place, la prochaine mise à jour termine', async () => {
    const big = Buffer.alloc(24 * 1024 * 1024, 7);
    const { created, root } = await setup({ 'video.mp4': big, 'petit.txt': 'p' });
    let jobId = '';
    hook.onFirstBytes = () => void w.hub.request('POST', `/api/core/jobs/${jobId}/cancel`);
    jobId = (await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`)).jobId;
    const job = await waitJob(w, jobId);
    expect(job.status).toBe('cancelled');
    const target = path.join(root, 'Cours', 'Thermo', 'video.mp4');
    expect(existsSync(target)).toBe(false);
    expect((await status(w)).lastUpdate?.stopped).toMatch(/Annulée/);
    expect((await item(w, created[0]!.id)).diskState).toBe('pending');
    const r = await update(w);
    expect(r.status).toBe('succeeded');
    expect(sha(target)).toBe(sha(lib(w, 'Cours', 'Thermo', 'video.mp4')));
    expect(readdirSync(path.join(root, '_ToolBox', 'tmp'))).toEqual([]);
    expect((await item(w, created[0]!.id)).diskState).toBe('active');
  });

  it('disque débranché pendant la copie : la mise à jour s’arrête, rien de faux, reprise au retour', async () => {
    const big = Buffer.alloc(24 * 1024 * 1024, 3);
    const { created, root } = await setup({ 'film.mkv': big });
    const away = path.join(w.E, '..', 'debranche');
    hook.onFirstBytes = () => renameSync(path.join(w.E, 'Sauvegardes'), away); // unplugged
    const { jobId } = await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`);
    const job = await waitJob(w, jobId);
    expect(job.status).toBe('failed');
    // Nothing was written where the disk was (not even a folder: another disk could be there now).
    expect(existsSync(path.join(w.E, 'Sauvegardes'))).toBe(false);
    expect((await status(w)).lastUpdate?.stopped).toMatch(
      /débranché|plus là|prochaine mise à jour/,
    );
    renameSync(away, path.join(w.E, 'Sauvegardes')); // plugged back
    expect((await status(w)).connected).toBe(true);
    const target = path.join(root, 'Cours', 'Thermo', 'film.mkv');
    expect(existsSync(target)).toBe(false);
    expect((await item(w, created[0]!.id)).diskState).toBe('pending');
    const r = await update(w);
    expect(r.status).toBe('succeeded');
    expect(sha(target)).toBe(sha(lib(w, 'Cours', 'Thermo', 'film.mkv')));
    expect(readdirSync(path.join(root, '_ToolBox', 'tmp'))).toEqual([]);
  });

  it('après un arrêt brutal : un fichier temporaire oublié n’est jamais pris pour un bon', async () => {
    const { created, root } = await setup({ 'notes.md': '# vraies notes' });
    // What a killed process leaves: a half-written temporary file, nothing recorded.
    const tmp = path.join(root, '_ToolBox', 'tmp');
    mkdirSync(tmp, { recursive: true });
    writeFileSync(path.join(tmp, `${created[0]!.id}-deadbeef`), '# vraies no');
    expect((await item(w, created[0]!.id)).diskState).toBe('pending');
    const r = await update(w);
    expect(r.report.copied).toBe(1);
    expect(readFileSync(path.join(root, 'Cours', 'Thermo', 'notes.md'), 'utf8')).toBe(
      '# vraies notes',
    );
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('une copie du disque disparue est recopiée', async () => {
    const { root } = await setup({ 'a.txt': 'A' });
    await update(w);
    const onDisk = path.join(root, 'Cours', 'Thermo', 'a.txt');
    renameSync(onDisk, `${onDisk}.perdu`);
    const plan = await ok<{ counts: DiskStatusDto['counts'] }>(w, 'GET', `${API}/disk/plan`);
    expect(plan.counts.copy).toBe(1);
    await update(w);
    expect(readFileSync(onDisk, 'utf8')).toBe('A');
  });

  it('un projet (dossier) : chaque fichier copié et relu, une modification dans un fichier vue', async () => {
    w = await diskWorld();
    const proj = path.join(w.dl, 'projet-rust');
    mkdirSync(path.join(proj, 'src'), { recursive: true });
    writeFileSync(path.join(proj, 'Cargo.toml'), '[package]');
    writeFileSync(path.join(proj, 'src', 'main.rs'), 'fn main() {}');
    const r = await ok<{ created: ItemDto[] }>(w, 'POST', `${API}/deposit/apply`, {
      entries: [{ path: proj, newContext: ['Programmation'], attributes: [] }],
    });
    const s = await registerDisk(w, path.join(w.E, 'S'));
    await update(w);
    const disk = path.join(s.root!, 'Programmation', 'projet-rust', 'src', 'main.rs');
    expect(readFileSync(disk, 'utf8')).toBe('fn main() {}');
    const pc = lib(w, 'Programmation', 'projet-rust', 'src', 'main.rs');
    writeFileSync(pc, 'fn main() { println!("x"); }');
    utimesSync(pc, new Date(), new Date(Date.now() + 5000));
    expect(
      (await ok<{ counts: DiskStatusDto['counts'] }>(w, 'GET', `${API}/disk/plan`)).counts.update,
    ).toBe(1);
    await update(w);
    expect(readFileSync(disk, 'utf8')).toContain('println');
    expect((await item(w, r.created[0]!.id)).diskState).toBe('active');
  });

  it('chemin long (> 260 caractères sous Windows) : copié et relu', async () => {
    const deep = Array.from(
      { length: 5 },
      (_, i) => `Contexte assez long numéro ${i} pour le chemin`,
    );
    const { created, root } = await setup({ [`${'n'.repeat(90)}.txt`]: 'long' }, deep);
    const r = await update(w);
    expect(r.report.copied).toBe(1);
    const copy = await item(w, created[0]!.id);
    expect(copy.diskState).toBe('active');
    const onDisk = path.join(root, ...deep.map((d) => d), `${'n'.repeat(90)}.txt`);
    expect(onDisk.length).toBeGreaterThan(260);
    expect(readFileSync(onDisk, 'utf8')).toBe('long');
  });
});

describe.runIf(fullRenderTests)('gros fichier (≥ 2 Go)', () => {
  it('copié en flux, mémoire stable, progression', { timeout: 900_000 }, async () => {
    w = await diskWorld();
    const big = path.join(w.dl, 'video-2go.mkv');
    const fd = openSync(big, 'w');
    ftruncateSync(fd, 2 * 1024 ** 3 + 17);
    closeSync(fd);
    await ok(w, 'POST', `${API}/deposit/apply`, {
      entries: [{ path: big, newContext: ['Vidéos'], attributes: [] }],
    });
    const s = await registerDisk(w, path.join(w.E, 'S'));
    const rss = process.memoryUsage().rss;
    const { jobId } = await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`);
    let sawProgress = false;
    for (;;) {
      const jobs = await ok<{ id: string; status: string; progress: number | null }[]>(
        w,
        'GET',
        '/api/core/jobs?module=coffre',
      );
      const j = jobs.find((x) => x.id === jobId)!;
      if (j.progress && j.progress > 0 && j.progress < 0.97) sawProgress = true;
      if (!['queued', 'running'].includes(j.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(sawProgress).toBe(true);
    expect(process.memoryUsage().rss - rss).toBeLessThan(400 * 1024 * 1024);
    const onDisk = path.join(s.root!, 'Vidéos', 'video-2go.mkv');
    expect(sha(onDisk)).toBe(sha(lib(w, 'Vidéos', 'video-2go.mkv')));
  });
});

void DISK_FOLDER;
