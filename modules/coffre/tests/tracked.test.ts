// v0.51.0 F (ADR 0068): a project « suivi en place » — never copied, never
// moved on the PC (its route changes alone), saved on the disk at its route,
// never archived, « Retirer du Coffre » leaves its folder intact; not found:
// « introuvable », found again; changes made in place seen; converted both ways.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FolderDto, ItemDto, SearchDto, TrackCompareDto, UpdateReport } from '../shared/types';
import {
  API,
  diskWorld,
  job as runJob,
  ok,
  registerDisk,
  waitJob,
  type DiskWorld,
} from './disk-helpers';

let w: DiskWorld | null = null;
afterEach(async () => {
  await w?.close();
  w = null;
});

const put = (file: string, content = 'x') => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
};
const folders = (W: DiskWorld) => ok<FolderDto[]>(W, 'GET', `${API}/folders`);
const byName = async (W: DiskWorld, name: string) =>
  (await folders(W)).find((f) => f.name === name)!;
const entryOf = async (W: DiskWorld, folderId: string) =>
  (await ok<ItemDto[]>(W, 'GET', `${API}/files?folder=${folderId}`))[0]!;
const update = (W: DiskWorld) => runJob<UpdateReport>(W, 'POST', `${API}/disk/update`);

describe('un projet suivi en place', () => {
  it('rangé sans copie ; déplacé sur la carte : rien ne bouge sur le PC ; introuvable puis retrouvé ; jamais archivé ; retiré sans y toucher', async () => {
    w = await diskWorld();
    const W = w;
    const real = path.join(W.dl, 'Outils', 'lanceur');
    put(path.join(real, 'lanceur.py'), 'import subprocess\nsubprocess.run(["notepad"])\n');
    put(path.join(real, 'requirements.txt'), 'rich\n');
    await runJob(W, 'POST', `${API}/deposit/apply`, {
      entries: [
        { path: real, newFolder: ['Programmation'], projects: [''], tracked: [''], labels: [] },
      ],
    });
    const folder = await byName(W, 'lanceur');
    expect(folder.tracked).toEqual({ path: path.resolve(real), missing: false });
    expect(existsSync(path.join(W.hub.dataDir, 'coffre', 'Programmation', 'lanceur'))).toBe(false);
    const entry = await entryOf(W, folder.id);
    expect(entry.path).toBe(path.resolve(real));
    // Indexed and searched like the others.
    const found = await ok<SearchDto>(W, 'GET', `${API}/search?q=lanceur.py`);
    expect(found.results[0]?.inner?.rel).toBe('lanceur.py');
    // Saved on the disk at its route.
    const s = await registerDisk(W, W.E);
    await update(W);
    expect(existsSync(path.join(s.root!, 'Programmation', 'lanceur', 'lanceur.py'))).toBe(true);
    // Its route changed on the map: nothing moves on the PC; the disk follows its route.
    const outils = await ok<FolderDto>(W, 'POST', `${API}/folders`, { route: ['Outils'] });
    await runJob(W, 'POST', `${API}/folders/${folder.id}/move`, { parentId: outils.id });
    expect(readFileSync(path.join(real, 'lanceur.py'), 'utf8')).toContain('notepad');
    expect((await byName(W, 'lanceur')).path).toEqual(['Outils', 'lanceur']);
    await update(W);
    expect(existsSync(path.join(s.root!, 'Outils', 'lanceur', 'lanceur.py'))).toBe(true);
    expect(existsSync(path.join(real, 'lanceur.py'))).toBe(true);
    // Changed in place: seen (« pas encore sur le disque »).
    writeFileSync(path.join(real, 'lanceur.py'), 'print("v2")\n');
    await ok(W, 'POST', `${API}/search/refresh`);
    expect((await entryOf(W, folder.id)).diskState).toBe('pending');
    await update(W);
    // Never archived (said).
    const archived = await runJob<{ archived: number; refused: { reason: string }[] }>(
      W,
      'POST',
      `${API}/files/archive`,
      { ids: [entry.id], confirm: true },
    );
    expect(archived.archived).toBe(0);
    expect(archived.refused[0]!.reason).toContain('suivi en place');
    // Renamed in the Explorer: « introuvable », never forgotten; the disk's copy intact.
    const moved = path.join(W.dl, 'Outils', 'lanceur-v2');
    renameSync(real, moved);
    await ok(W, 'POST', `${API}/search/refresh`);
    expect((await byName(W, 'lanceur')).tracked).toEqual({
      path: path.resolve(real),
      missing: true,
    });
    expect(existsSync(path.join(s.root!, 'Outils', 'lanceur', 'lanceur.py'))).toBe(true);
    // « Le retrouver… »: compared by its files first, then followed again.
    const seen = await runJob<{ compared: TrackCompareDto }>(
      W,
      'POST',
      `${API}/folders/${folder.id}/relocate`,
      { path: moved },
    );
    expect(seen.compared).toMatchObject({ same: 2, looksLike: true });
    expect((await byName(W, 'lanceur')).tracked!.missing).toBe(true);
    await runJob(W, 'POST', `${API}/folders/${folder.id}/relocate`, { path: moved, confirm: true });
    expect((await byName(W, 'lanceur')).tracked).toEqual({ path: moved, missing: false });
    // A folder that does not look like it: refused.
    const other = path.join(W.dl, 'autre');
    put(path.join(other, 'x.txt'), 'x');
    const refused = await ok<{ jobId: string }>(W, 'POST', `${API}/folders/${folder.id}/relocate`, {
      path: other,
      confirm: true,
    });
    const end = await waitJob(W, refused.jobId);
    expect(end.status).toBe('failed');
    expect(end.error).toContain('ne ressemble pas au projet');
    expect((await byName(W, 'lanceur')).tracked?.path).toBe(moved);
    // « Retirer du Coffre »: no longer followed, its folder intact; its disk copy to the disk's bin.
    await ok(W, 'DELETE', `${API}/folders/${folder.id}/project`);
    expect(readFileSync(path.join(moved, 'lanceur.py'), 'utf8')).toContain('v2');
    await update(W);
    expect(existsSync(path.join(s.root!, 'Outils', 'lanceur'))).toBe(false);
    await ok(W, 'POST', `${API}/files/${entry.id}/erase`, { confirm: true });
    expect(readFileSync(path.join(moved, 'lanceur.py'), 'utf8')).toContain('v2');
  });

  it('copié → suivi (dossier vide, ou un dossier qui le contient déjà, comparé) ; suivi → copié : rien de perdu', async () => {
    w = await diskWorld();
    const W = w;
    const src = path.join(W.dl, 'robot');
    put(path.join(src, 'platformio.ini'), '[env]\n');
    put(path.join(src, 'src', 'main.cpp'), 'void loop() {}\n');
    await runJob(W, 'POST', `${API}/deposit/apply`, {
      entries: [{ path: src, newFolder: ['Robots'], projects: [''], labels: [] }],
    });
    const folder = await byName(W, 'robot');
    const lib = path.join(W.hub.dataDir, 'coffre', 'Robots', 'robot');
    // Copied → followed: copied into an EMPTY folder; the Coffre's copy aside after success.
    const home = mkdtempSync(path.join(tmpdir(), 'pc-'));
    const there = path.join(home, 'robot-sur-le-pc');
    mkdirSync(there);
    put(path.join(home, 'plein', 'a.txt'));
    expect(
      (
        await W.hub.request('POST', `${API}/folders/${folder.id}/track`, {
          path: path.join(home, 'plein'),
          mode: 'copy',
        })
      ).status,
    ).toBe(409);
    const t = await runJob<{ undoId: string; aside: string }>(
      W,
      'POST',
      `${API}/folders/${folder.id}/track`,
      { path: there, mode: 'copy' },
    );
    expect(readFileSync(path.join(there, 'src', 'main.cpp'), 'utf8')).toContain('loop');
    expect(existsSync(lib)).toBe(false);
    expect(t.aside).toMatch(/^_Corbeille\/.* avant suivi /);
    expect((await byName(W, 'robot')).tracked?.path).toBe(there);
    // Followed → copied: the Coffre has its own copy again, the original intact.
    const u = await runJob<{ original: string }>(
      W,
      'POST',
      `${API}/folders/${folder.id}/untrack`,
      {},
    );
    expect(u.original).toBe(there);
    expect(readFileSync(path.join(lib, 'src', 'main.cpp'), 'utf8')).toContain('loop');
    expect(existsSync(path.join(there, 'src', 'main.cpp'))).toBe(true);
    expect((await byName(W, 'robot')).tracked).toBeNull();
    // A folder that already holds it: the differences shown first (nothing done without confirm).
    const copyThere = path.join(home, 'robot-modifie');
    put(path.join(copyThere, 'platformio.ini'), '[env]\n');
    put(path.join(copyThere, 'src', 'main.cpp'), 'void loop() { blink(); }\n');
    put(path.join(copyThere, 'notes.md'), '# n');
    const preview = await runJob<{ compared: TrackCompareDto }>(
      W,
      'POST',
      `${API}/folders/${folder.id}/track`,
      { path: copyThere, mode: 'existing' },
    );
    expect(preview.compared).toMatchObject({
      same: 1,
      changed: ['src/main.cpp'],
      added: ['notes.md'],
      missing: [],
    });
    expect(existsSync(lib)).toBe(true);
    expect((await byName(W, 'robot')).tracked).toBeNull();
    await runJob(W, 'POST', `${API}/folders/${folder.id}/track`, {
      path: copyThere,
      mode: 'existing',
      confirm: true,
    });
    expect((await byName(W, 'robot')).tracked?.path).toBe(copyThere);
    expect(readFileSync(path.join(copyThere, 'src', 'main.cpp'), 'utf8')).toContain('blink');
  });
});
