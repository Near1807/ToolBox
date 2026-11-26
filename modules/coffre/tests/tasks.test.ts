// v0.49.0 B, C, D: depositing as background tasks — a file that fails does not
// stop the others (listed with its reason, « Réessayer ceux-là »), a cancel in
// the middle leaves nothing half written, a restart resumes without « (2) »,
// recreatable folders set aside before counting, the threshold asks first,
// the disk's update waits for a deposit.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnalyzeResultDto, ApplyResultDto, ItemDto } from '../shared/types';
import {
  API,
  diskWorld,
  job as runJob,
  ok,
  registerDisk,
  snapshot,
  waitJob,
  type DiskWorld,
} from './disk-helpers';

let w: DiskWorld | null = null;
afterEach(async () => {
  await w?.close();
  w = null;
  delete process.env.TOOLBOX_COFFRE_DEPOSIT_PAUSE_MS;
  delete process.env.TOOLBOX_COFFRE_WARN_FILES;
});
const put = (file: string, content: string | Buffer) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
};
const allFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() || e.name.startsWith('.~depot-'))
        .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    : [];

async function until(cond: () => Promise<boolean>, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Délai dépassé');
}

describe('tâches de fond du Coffre', () => {
  it('un fichier en erreur n’arrête pas les autres : listé avec sa raison, reste à sa place ; Réessayer ceux-là', async () => {
    w = await diskWorld();
    const W = w;
    const files = Array.from({ length: 7 }, (_, i) =>
      put(path.join(W.dl, `cours ${i + 1}.pdf`), `pdf ${i}`),
    );
    // The 4th disappears before the rangement (moved by Thomas, a key removed…).
    const entries = files.map((p) => ({ path: p, newContext: ['Cours'], attributes: [] }));
    const lost = files[3]!;
    const kept = readdirSync(W.dl);
    rmSync(lost);
    const { jobId } = await ok<{ jobId: string }>(W, 'POST', `${API}/deposit/apply`, { entries });
    const j = await waitJob(W, jobId);
    expect(j.status).toBe('succeeded');
    const r = j.result as ApplyResultDto;
    expect(r.created).toHaveLength(6);
    expect(r.failed).toBe(1);
    expect(j.details).toMatchObject({
      done: 6,
      total: 7,
      errorCount: 1,
      errors: [{ item: lost, reason: expect.stringMatching(/introuvable/) }],
    });
    expect(kept).toHaveLength(7);
    // Put back, « Réessayer ceux-là »: only it.
    put(lost, 'pdf 3');
    const again = await ok<{ id: string }>(W, 'POST', `/api/core/jobs/${jobId}/retry`);
    const second = await waitJob(W, again.id);
    expect((second.result as ApplyResultDto).created.map((i) => i.name)).toEqual(['cours 4.pdf']);
  });

  it('annuler au milieu : ce qui est fait reste entier, rien à moitié écrit, l’original intact', async () => {
    w = await diskWorld();
    const W = w;
    const proj = path.join(W.dl, 'gros-projet');
    for (let i = 0; i < 1500; i++) put(path.join(proj, 'src', `f${i}.js`), `// ${i}`);
    put(path.join(proj, 'package.json'), '{}');
    const small = put(path.join(W.dl, 'avant.md'), 'avant');
    const before = snapshot(proj);
    process.env.TOOLBOX_COFFRE_DEPOSIT_PAUSE_MS = '5'; // never finished before the cancel
    const { jobId } = await ok<{ jobId: string }>(W, 'POST', `${API}/deposit/apply`, {
      entries: [
        { path: small, newContext: ['Projets'], attributes: [] },
        { path: proj, newContext: ['Projets'], attributes: [] },
      ],
    });
    await until(async () => ((await waitJobNow(W, jobId))?.details?.done ?? 0) > 100);
    await ok(W, 'POST', `/api/core/jobs/${jobId}/cancel`);
    const j = await waitJob(W, jobId);
    expect(j.status).toBe('cancelled');
    const r = j.result as ApplyResultDto;
    expect(r.created.map((i) => i.name)).toEqual(['avant.md']);
    expect(r.undoId).toBeTruthy();
    const lib = path.join(W.hub.dataDir, 'coffre', 'Projets');
    expect(allFiles(lib)).toEqual(['avant.md']);
    expect(snapshot(proj)).toEqual(before);
  });

  it('fermeture de ToolBox pendant un rangement : repris au démarrage, sans doublon', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'coffre-tasks-'));
    w = await diskWorld({ dataDir });
    let W = w;
    const files = Array.from({ length: 12 }, (_, i) =>
      put(path.join(W.dl, `td ${i + 1}.txt`), `td ${i}`),
    );
    process.env.TOOLBOX_COFFRE_DEPOSIT_PAUSE_MS = '60';
    const { jobId } = await ok<{ jobId: string }>(W, 'POST', `${API}/deposit/apply`, {
      entries: files.map((p) => ({ path: p, newContext: ['Réseaux'], attributes: [] })),
    });
    await until(async () => ((await waitJobNow(W, jobId))?.details?.done ?? 0) >= 4);
    await W.close();
    delete process.env.TOOLBOX_COFFRE_DEPOSIT_PAUSE_MS;
    w = await diskWorld({ dataDir });
    W = w;
    const j = await waitJob(W, jobId);
    expect(j.status).toBe('succeeded');
    expect((j.details as { resumed?: boolean } | null | undefined) ?? {}).toMatchObject({
      resumed: true,
    });
    const names = readdirSync(path.join(dataDir, 'coffre', 'Réseaux')).sort();
    expect(names).toHaveLength(12);
    expect(names.some((n) => n.includes('(2)') || n.startsWith('.~'))).toBe(false);
    const items = await ok<ItemDto[]>(W, 'GET', `${API}/items`);
    expect(items).toHaveLength(12);
  });

  it('node_modules écarté AVANT de compter ; au-delà du seuil, la question d’abord', async () => {
    w = await diskWorld();
    const W = w;
    const proj = path.join(W.dl, 'site');
    put(path.join(proj, 'package.json'), '{}');
    put(path.join(proj, 'src', 'app.js'), 'x');
    for (let i = 0; i < 400; i++) put(path.join(proj, 'node_modules', `p${i}`, 'index.js'), `${i}`);
    const r = await runJob<AnalyzeResultDto>(W, 'POST', `${API}/deposit/analyze`, {
      paths: [proj],
      expand: true,
    });
    expect(r.proposals.map((p) => p.name).sort()).toEqual(['app.js', 'package.json']);
    expect(r.setAside).toEqual([
      expect.objectContaining({ rel: 'site/node_modules', files: 400, partial: false }),
    ]);
    const asProject = await runJob<AnalyzeResultDto>(W, 'POST', `${API}/deposit/analyze`, {
      paths: [proj],
    });
    expect(asProject.proposals[0]).toMatchObject({ isDirectory: true, fileCount: 2 });
    // The threshold (lowered for the test): asked first, nothing analysed.
    process.env.TOOLBOX_COFFRE_WARN_FILES = '1';
    const big = await runJob<AnalyzeResultDto>(W, 'POST', `${API}/deposit/analyze`, {
      paths: [proj],
      expand: true,
    });
    expect(big.proposals).toEqual([]);
    expect(big.needsConfirm).toMatchObject({ files: 2 });
    const go = await runJob<AnalyzeResultDto>(W, 'POST', `${API}/deposit/analyze`, {
      paths: [proj],
      expand: true,
      confirmed: true,
    });
    expect(go.proposals).toHaveLength(2);
  });

  it('mise à jour du disque pendant un rangement : refusée avec un message clair, possible à la fin', async () => {
    w = await diskWorld();
    const W = w;
    await registerDisk(W, path.join(W.E, 'S'));
    const files = Array.from({ length: 8 }, (_, i) => put(path.join(W.dl, `x${i}.md`), `x${i}`));
    process.env.TOOLBOX_COFFRE_DEPOSIT_PAUSE_MS = '80';
    const { jobId } = await ok<{ jobId: string }>(W, 'POST', `${API}/deposit/apply`, {
      entries: files.map((p) => ({ path: p, newContext: ['Cours'], attributes: [] })),
    });
    await until(async () => (await waitJobNow(W, jobId))?.status === 'running');
    const refused = await W.hub.request('POST', `${API}/disk/update`);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toMatch(/Import en cours .* sera possible à la fin/);
    expect((await ok<{ waitsFor: string | null }>(W, 'GET', `${API}/disk`)).waitsFor).toMatch(
      /ranger 8/,
    );
    await waitJob(W, jobId);
    const ok2 = await W.hub.request('POST', `${API}/disk/update`);
    expect(ok2.status).toBe(200);
    await waitJob(W, (ok2.body as { jobId: string }).jobId);
  });
});

/** The task now (not waiting for its end). */
async function waitJobNow(W: DiskWorld, id: string) {
  const jobs = await ok<{ id: string; status: string; details: { done: number | null } | null }[]>(
    W,
    'GET',
    '/api/core/jobs?module=coffre',
  );
  return jobs.find((j) => j.id === id);
}
