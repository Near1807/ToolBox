// v0.47.0 C: files sent by Windows to the Coffre — ten files, ONE batch (one
// rangement window); nothing written before « Ranger »; then the same rules
// as a drop (the original untouched).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHost } from '@hub/sdk/testing';
import { API, diskWorld, ok, sha, snapshot, type DiskWorld } from './disk-helpers';

let w: DiskWorld;
afterEach(async () => {
  await w?.close();
});

describe('ranger depuis Windows', () => {
  it('10 fichiers et un dossier : un lot, une route ; rien d’écrit avant « Ranger »', async () => {
    const shown: (string | undefined)[] = [];
    w = await diskWorld({ host: createTestHost({ showWindow: (t) => void shown.push(t) }) });
    const files = Array.from({ length: 10 }, (_, i) => {
      const p = path.join(w.dl, `fichier ${i}.txt`);
      writeFileSync(p, `contenu ${i}`);
      return p;
    });
    const folder = path.join(w.dl, 'projet');
    mkdirSync(folder);
    writeFileSync(path.join(folder, 'main.py'), 'print(1)');
    const before = snapshot(path.join(w.hub.dataDir, 'coffre'));
    const route = await w.hub.hub.receiveFiles([...files, folder]);
    expect(route).toMatch(/^\/m\/coffre\/ranger\/[0-9a-f-]{36}$/);
    expect(shown).toEqual([route]);
    const id = route!.split('/').pop();
    const batch = await ok<{ paths: string[]; folders: number; missing: number }>(
      w,
      'GET',
      `${API}/received/${id}`,
    );
    expect(batch).toEqual({ id, paths: [...files, folder], folders: 1, missing: 0 });
    expect(snapshot(path.join(w.hub.dataDir, 'coffre'))).toEqual(before);
    // « Ranger »: the deposit's own rules (copies, the originals untouched).
    const shaBefore = sha(files[0]!);
    const r = await ok<{ created: unknown[] }>(w, 'POST', `${API}/deposit/apply`, {
      entries: files.map((p) => ({ path: p, newContext: ['Cours', 'Réseaux'], attributes: [] })),
    });
    expect(r.created).toHaveLength(10);
    expect(sha(files[0]!)).toBe(shaBefore);
    expect(
      (await w.hub.request('GET', `${API}/received/00000000-0000-4000-8000-000000000000`)).status,
    ).toBe(404);
  });
});
