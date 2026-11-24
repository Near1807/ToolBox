// v0.47.0 D: « Proposer de ranger mes nouveaux téléchargements » — OFF by
// default; only files arrived after the activation; a download in progress
// (.crdownload) ignored, then proposed once stable; a file already in the
// Coffre left out; nothing put away without a click; the original untouched.
import { mkdtempSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DownloadsDto, HomeDto } from '../shared/types';
import { API, deposit, diskWorld, ok, sha, snapshot, type DiskWorld } from './disk-helpers';

beforeAll(() => {
  process.env.TOOLBOX_COFFRE_STABLE_MS = '0';
});
let w: DiskWorld;
afterEach(async () => {
  await w?.close();
});

const check = () => ok<DownloadsDto>(w, 'POST', `${API}/downloads/check`, {});
const names = (d: DownloadsDto) => d.pending.map((p) => p.name).sort();

describe('surveillance de Téléchargements', () => {
  it('désactivée par défaut : rien n’est lu ni proposé', async () => {
    w = await diskWorld();
    const folder = mkdtempSync(path.join(tmpdir(), 'dl-'));
    writeFileSync(path.join(folder, 'a.pdf'), 'a');
    await ok(w, 'PUT', '/api/core/settings/coffre', { downloadsFolder: folder });
    const d = await check();
    expect(d).toMatchObject({ enabled: false, pending: [], waiting: 0 });
    expect(
      w.hub.hub.handle.db.prepare('SELECT COUNT(*) AS n FROM coffre__downloads').get(),
    ).toEqual({ n: 0 });
  });

  it('après activation seulement ; .crdownload attendu ; stable ; déjà dans le coffre écarté ; rien sans clic', async () => {
    w = await diskWorld();
    const folder = mkdtempSync(path.join(tmpdir(), 'dl-'));
    writeFileSync(path.join(folder, 'ancien.pdf'), 'avant');
    const [inCoffre] = await deposit(w, { 'deja.txt': 'déjà rangé' });
    await ok(w, 'PUT', '/api/core/settings/coffre', {
      downloadsFolder: folder,
      watchDownloads: true,
    });
    // Arrived after: one being downloaded, one complete, one already in the Coffre.
    writeFileSync(path.join(folder, 'cours.pdf.crdownload'), 'moit');
    writeFileSync(path.join(folder, 'td.pdf'), 'td complet');
    writeFileSync(path.join(folder, 'copie.txt'), 'déjà rangé');
    let d = await check(); // seen
    expect(d.pending).toEqual([]);
    expect(d.waiting).toBe(2);
    d = await check(); // stable: proposed
    expect(names(d)).toEqual(['td.pdf']);
    // The download ends (the browser renames it): proposed in turn.
    renameSync(path.join(folder, 'cours.pdf.crdownload'), path.join(folder, 'cours.pdf'));
    await check();
    d = await check();
    expect(names(d)).toEqual(['cours.pdf', 'td.pdf']);
    // The home and the sidebar's counter.
    expect((await ok<HomeDto>(w, 'GET', `${API}/home`)).arrivalCount).toBe(0);
    // Nothing was put away alone; the originals untouched.
    const coffre = snapshot(path.join(w.hub.dataDir, 'coffre'));
    expect(coffre.filter((l) => l.startsWith('Cours/Thermo/') && !l.includes('deja'))).toEqual([]);
    const before = sha(path.join(folder, 'td.pdf'));
    const mtime = statSync(path.join(folder, 'td.pdf')).mtimeMs;
    // « Ignorer » one; « Ranger » the other (the deposit's rules).
    d = await ok<DownloadsDto>(w, 'POST', `${API}/downloads/ignore`, {
      paths: [path.join(folder, 'cours.pdf')],
    });
    expect(names(d)).toEqual(['td.pdf']);
    await ok(w, 'POST', `${API}/deposit/apply`, {
      entries: [
        { path: path.join(folder, 'td.pdf'), newContext: ['Cours', 'Réseaux'], attributes: [] },
      ],
    });
    expect((await check()).pending).toEqual([]);
    expect(sha(path.join(folder, 'td.pdf'))).toBe(before);
    expect(statSync(path.join(folder, 'td.pdf')).mtimeMs).toBe(mtime);
    // « Proposer aussi les fichiers déjà présents »: those of before, on demand.
    const existing = await ok<{ name: string }[]>(w, 'GET', `${API}/downloads/existing`);
    expect(existing.map((e) => e.name)).toEqual(['ancien.pdf']);
    void inCoffre;
  });

  it('désactivée ensuite : plus de compteur', async () => {
    w = await diskWorld();
    const folder = mkdtempSync(path.join(tmpdir(), 'dl-'));
    await ok(w, 'PUT', '/api/core/settings/coffre', {
      downloadsFolder: folder,
      watchDownloads: true,
    });
    writeFileSync(path.join(folder, 'x.pdf'), 'x');
    await check();
    expect(names(await check())).toEqual(['x.pdf']);
    await ok(w, 'PUT', '/api/core/settings/coffre', { watchDownloads: false });
    expect(await ok<DownloadsDto>(w, 'GET', `${API}/downloads`)).toMatchObject({
      enabled: false,
      pending: [],
    });
    expect((await w.hub.request('GET', `${API}/downloads/existing`)).status).toBe(409);
  });
});
