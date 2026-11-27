// v0.51.0 B, C, D4, E (ADR 0068): a project's copy on the disk, FILE BY FILE —
// one file changed: only it is copied (its old version in the history);
// deleted / renamed: to the history; an update interrupted leaves it « pas
// encore sur le disque » and the next one finishes; a copy made whole (v0.50)
// adopted without copying again; a version of one file restored; what the
// project no longer saves proposed, never removed alone; Git writing: put off.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { FolderDto, ItemDto, UpdateReport } from '../shared/types';
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
interface PlanStep {
  kind: string;
  itemId: string;
  files?: number;
  removed?: number;
  adopt?: boolean;
}

/** A project of `n` files dropped in the Coffre, a disk registered. */
async function world(n = 40) {
  // Its own data folder (kept when the hub is closed: a restart in the test).
  w = await diskWorld({ dataDir: mkdtempSync(path.join(tmpdir(), 'coffre-proj-')) });
  const W = w;
  const src = path.join(W.dl, 'robot');
  put(path.join(src, 'platformio.ini'), '[env:esp32]\n');
  put(path.join(src, 'src', 'main.cpp'), 'void setup() {}\n');
  put(path.join(src, 'mails.txt'), 'liste');
  put(path.join(src, 'test.py'), 'assert True\n');
  for (let i = 0; i < n; i++) put(path.join(src, 'lib', `l${i}.h`), `// ${i}\n`.repeat(50));
  put(path.join(src, '.pio', 'build', 'firmware.bin'), 'bin'.repeat(1000));
  await runJob(W, 'POST', `${API}/deposit/apply`, {
    entries: [{ path: src, newFolder: ['Robots'], projects: [''], labels: [] }],
  });
  const folder = (await ok<FolderDto[]>(W, 'GET', `${API}/folders`)).find(
    (f) => f.name === 'robot',
  )!;
  const project = (await ok<ItemDto[]>(W, 'GET', `${API}/files?folder=${folder.id}`))[0]!;
  const s = await registerDisk(W, W.E);
  const lib = path.join(W.hub.dataDir, 'coffre', 'Robots', 'robot');
  const onDisk = path.join(s.root!, 'Robots', 'robot');
  return { W, folder, project, lib, onDisk, root: s.root! };
}
const update = (W: DiskWorld) => runJob<UpdateReport>(W, 'POST', `${API}/disk/update`);
const plan = (W: DiskWorld) => ok<{ steps: PlanStep[] }>(W, 'GET', `${API}/disk/plan`);
const state = async (W: DiskWorld, id: string) =>
  (await ok<ItemDto>(W, 'GET', `${API}/files/${id}`)).diskState;

describe('un projet sur le disque, fichier par fichier', () => {
  it('copié, puis seul le fichier modifié ; supprimé et renommé vers l’historique ; versions d’un fichier', async () => {
    const { W, project, lib, onDisk } = await world();
    const first = await update(W);
    expect(first).toMatchObject({ copied: 1, files: 44 });
    expect(existsSync(path.join(onDisk, '.pio'))).toBe(false); // excluded: never saved
    expect(await state(W, project.id)).toBe('active');
    // One file changed: the plan says « 1 fichier », only it is copied.
    writeFileSync(path.join(lib, 'src', 'main.cpp'), 'void setup() { led(); }\n');
    await ok(W, 'POST', `${API}/search/refresh`);
    expect(await state(W, project.id)).toBe('pending');
    expect((await plan(W)).steps).toEqual([
      expect.objectContaining({ kind: 'update', itemId: project.id, files: 1, removed: 0 }),
    ]);
    const second = await update(W);
    expect(second).toMatchObject({ updated: 1, files: 1 });
    expect(readFileSync(path.join(onDisk, 'src', 'main.cpp'), 'utf8')).toContain('led()');
    // Its old version, in the history of that file.
    const v = await ok<{ versions: { id: string; name: string }[] }>(
      W,
      'GET',
      `${API}/files/${project.id}/versions?rel=${encodeURIComponent('src/main.cpp')}`,
    );
    expect(v.versions).toHaveLength(1);
    expect(v.versions[0]!.name).toBe('main.cpp');
    // Deleted and renamed: to the history; the new name copied.
    rmSync(path.join(lib, 'test.py'));
    renameSync(path.join(lib, 'mails.txt'), path.join(lib, 'contacts.txt'));
    await ok(W, 'POST', `${API}/search/refresh`);
    expect((await plan(W)).steps[0]).toMatchObject({ files: 1, removed: 2 });
    const third = await update(W);
    expect(third.files).toBe(1);
    expect(existsSync(path.join(onDisk, 'test.py'))).toBe(false);
    expect(existsSync(path.join(onDisk, 'mails.txt'))).toBe(false);
    expect(readFileSync(path.join(onDisk, 'contacts.txt'), 'utf8')).toBe('liste');
    for (const rel of ['test.py', 'mails.txt'])
      expect(
        (
          await ok<{ versions: unknown[] }>(
            W,
            'GET',
            `${API}/files/${project.id}/versions?rel=${rel}`,
          )
        ).versions,
      ).toHaveLength(1);
    expect(await state(W, project.id)).toBe('active');
    // C: « Restaurer cette version » of main.cpp — the current one kept first; Annuler.
    const r = await ok<{ undoId: string }>(
      W,
      'POST',
      `${API}/files/${project.id}/versions/${v.versions[0]!.id}/restore`,
      { confirm: true },
    );
    expect(readFileSync(path.join(lib, 'src', 'main.cpp'), 'utf8')).toBe('void setup() {}\n');
    await ok(W, 'POST', `${API}/undo`, { undoId: r.undoId });
    expect(readFileSync(path.join(lib, 'src', 'main.cpp'), 'utf8')).toContain('led()');
    // The project's own manifest on the disk.
    const manifest = JSON.parse(
      readFileSync(
        path.join(onDisk, '..', '..', '_ToolBox', 'Base', 'projets', `${project.id}.json`),
        'utf8',
      ),
    ) as { files: { path: string }[] };
    expect(manifest.files.map((f) => f.path)).toContain('contacts.txt');
  });

  it('interrompue : « pas encore sur le disque », la suivante termine ; copie v0.50 adoptée sans recopie', async () => {
    const { W, project, lib, onDisk } = await world(1500);
    // Interrupted in the middle of the project (slowed down for the test).
    process.env.TOOLBOX_COFFRE_COPY_PAUSE_MS = '2';
    const { jobId } = await ok<{ jobId: string }>(W, 'POST', `${API}/disk/update`);
    for (let i = 0; i < 400; i++) {
      if (existsSync(path.join(onDisk, 'lib', 'l10.h'))) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await W.hub.request('POST', `/api/core/jobs/${jobId}/cancel`);
    const stopped = await waitJob(W, jobId);
    delete process.env.TOOLBOX_COFFRE_COPY_PAUSE_MS;
    expect(stopped.status).toBe('cancelled');
    expect(await state(W, project.id)).toBe('pending');
    // The next one finishes: only what was not copied yet.
    const done = await update(W);
    expect(done.files).toBeGreaterThan(0);
    expect(done.files).toBeLessThan(1504);
    expect(await state(W, project.id)).toBe('active');
    expect(readFileSync(path.join(onDisk, 'lib', 'l1499.h'), 'utf8')).toContain('1499');
    // A copy made whole by v0.50 (no manifest): compared, never copied again.
    await W.close();
    const db = new Database(path.join(W.hub.dataDir, 'hub.db'));
    db.exec('DELETE FROM coffre__inner_copies');
    db.exec(`UPDATE coffre__copies SET sha256 = 'v050' WHERE item_id = '${project.id}'`);
    db.close();
    w = await diskWorld({ dataDir: W.hub.dataDir, volumes: { E: W.E, F: W.F } });
    const W2 = w;
    for (let i = 0; i < 100; i++) {
      if ((await ok<{ connected: boolean }>(W2, 'GET', `${API}/disk`)).connected) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect((await plan(W2)).steps[0]).toMatchObject({ adopt: true });
    const adopted = await update(W2);
    expect(adopted.files).toBe(0);
    expect(await state(W2, project.id)).toBe('active');
    expect(readFileSync(path.join(lib, 'lib', 'l0.h'), 'utf8')).toContain('0');
  });

  it('ce qui n’est plus sauvegardé : proposé, jamais retiré seul ; Git qui écrit : reporté', async () => {
    const { W, folder, project, lib, onDisk } = await world(3);
    put(path.join(lib, 'data', 'mesures.csv'), '1;2;3');
    await ok(W, 'POST', `${API}/search/refresh`);
    await update(W);
    expect(existsSync(path.join(onDisk, 'data', 'mesures.csv'))).toBe(true);
    // A .gitignore later: data/ no longer saved — proposed, still on the disk.
    put(path.join(lib, '.gitignore'), 'data/\n');
    await ok(W, 'POST', `${API}/search/refresh`);
    await update(W);
    expect(existsSync(path.join(onDisk, 'data', 'mesures.csv'))).toBe(true);
    const proposed = await ok<{ itemId: string; entries: { rel: string; bytes: number }[] }[]>(
      W,
      'GET',
      `${API}/disk/excluded`,
    );
    expect(proposed).toEqual([
      expect.objectContaining({
        itemId: project.id,
        entries: [expect.objectContaining({ rel: 'data', bytes: 5 })],
      }),
    ]);
    // A click: to the disk's history (never erased); the PC's file untouched.
    const r = await runJob<{ removed: number }>(W, 'POST', `${API}/disk/excluded/remove`, {
      itemIds: [project.id],
    });
    expect(r.removed).toBe(1);
    expect(existsSync(path.join(onDisk, 'data'))).toBe(false);
    expect(existsSync(path.join(lib, 'data', 'mesures.csv'))).toBe(true);
    expect(await ok(W, 'GET', `${API}/disk/excluded`)).toEqual([]);
    // E: Git writing (.git/index.lock): put off to the end, then « pas encore sur le disque ».
    put(path.join(lib, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    put(path.join(lib, '.git', 'index.lock'), '');
    writeFileSync(path.join(lib, 'src', 'main.cpp'), 'changé');
    await ok(W, 'POST', `${API}/search/refresh`);
    const locked = await update(W);
    expect(locked.problems).toEqual([
      expect.objectContaining({
        itemId: project.id,
        reason: expect.stringContaining('Git écrivait dans le projet (.git/index.lock)'),
      }),
    ]);
    expect(await state(W, project.id)).toBe('pending');
    rmSync(path.join(lib, '.git', 'index.lock'));
    await update(W);
    expect(await state(W, project.id)).toBe('active');
    expect(readFileSync(path.join(onDisk, 'src', 'main.cpp'), 'utf8')).toBe('changé');
    // The inside: the branch read, no git command.
    const inside = await ok<{ git: { branch: string } | null }>(
      W,
      'GET',
      `${API}/folders/${folder.id}/inside`,
    );
    expect(inside.git?.branch).toBe('main');
  });
});
