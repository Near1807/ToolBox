// v0.48.0 F: importing an arborescence — 4 levels, ~500 files, a Python
// project without Git, a node_modules: the preview right, the project ONE
// element, the dependencies left out, the originals intact, everything « à
// compléter », cancel, resumed after a restart, ONE « Annuler »; a folder put
// in the Coffre by hand proposed for adoption, never adopted alone.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ContextDto,
  FoundFolderDto,
  HomeDto,
  ImportNodeDto,
  ImportPreviewDto,
  ImportStatusDto,
  ItemDto,
} from '../shared/types';
import {
  API,
  deposit,
  diskWorld,
  job as runJob,
  ok,
  snapshot,
  type DiskWorld,
} from './disk-helpers';

let w: DiskWorld | null = null;
afterEach(async () => {
  await w?.close();
  w = null;
  delete process.env.TOOLBOX_COFFRE_IMPORT_PAUSE_MS;
});

function put(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** « Programmation »: 4 levels, ~500 files, two projects, system files, duplicates. */
function programmation(base: string): string {
  const root = path.join(base, 'Programmation');
  put(path.join(root, 'notes.md'), '# Notes générales');
  put(path.join(root, 'Thumbs.db'), 'x');
  put(path.join(root, '~$brouillon.docx'), 'x');
  for (let i = 1; i <= 120; i++)
    put(path.join(root, 'Cours', 'Semestre 1', 'Algo', `chapitre ${i}.txt`), `Algo ${i}`);
  for (let i = 1; i <= 120; i++)
    put(path.join(root, 'Cours', 'Semestre 2', 'Réseaux', `labo ${i}.txt`), `Réseaux ${i}`);
  // A Python project without Git (its code files say it).
  const calc = path.join(root, 'Projets', 'calculatrice');
  put(path.join(calc, 'main.py'), 'from utils import add\nprint(add(1, 2))\n');
  put(path.join(calc, 'utils.py'), 'def add(a, b):\n    return a + b\n');
  put(path.join(calc, 'tests', 'test_main.py'), 'def test(): pass\n');
  put(path.join(calc, 'data', 'valeurs.csv'), 'a,b\n1,2\n');
  put(path.join(calc, '__pycache__', 'utils.cpython-312.pyc'), 'bytecode');
  // A JavaScript project with its node_modules.
  const site = path.join(root, 'Projets', 'site-web');
  put(path.join(site, 'package.json'), '{"name":"site"}');
  put(path.join(site, 'src', 'app.js'), 'console.log(1)');
  for (let i = 0; i < 60; i++)
    put(path.join(site, 'node_modules', `pkg${i}`, 'index.js'), `module.exports = ${i}`);
  // Resources: 180 files, two of them identical, one already in the Coffre.
  for (let i = 1; i <= 180; i++) put(path.join(root, 'Ressources', `fiche ${i}.txt`), `Fiche ${i}`);
  put(path.join(root, 'Ressources', 'copie de fiche 1.txt'), 'Fiche 1');
  put(path.join(root, 'Ressources', 'deja.txt'), 'déjà dans le Coffre');
  return root;
}

const find = (n: ImportNodeDto, rel: string): ImportNodeDto | null =>
  n.rel === rel ? n : (n.children.map((c) => find(c, rel)).find(Boolean) ?? null);

async function until(cond: () => Promise<boolean>, ms = 30_000, seen?: () => Promise<unknown>) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  // What was seen last: tells a slow run from a stuck one.
  throw new Error(`Délai dépassé${seen ? ` : ${JSON.stringify(await seen())}` : ''}`);
}

describe('importer une arborescence', () => {
  it('aperçu juste, projet entier, node_modules décoché, originaux intacts, « à compléter », un seul Annuler', async () => {
    w = await diskWorld();
    const W = w;
    await deposit(W, { 'deja.txt': 'déjà dans le Coffre' }, ['Divers']);
    const root = programmation(W.dl);
    const before = snapshot(root);
    const p = await runJob<ImportPreviewDto>(W, 'POST', `${API}/import/preview`, { source: root });
    expect(p.route).toEqual([]);
    expect(p.tree.name).toBe('Programmation');
    expect(p.totals.projects).toBe(2);
    const calc = find(p.tree, 'Projets/calculatrice')!;
    expect(calc.marker).toBe('fichiers de code');
    expect(calc.files).toBe(4);
    expect(calc.deps.map((d) => d.name)).toEqual(['__pycache__']);
    const site = find(p.tree, 'Projets/site-web')!;
    expect(site.marker).toBe('package.json');
    expect(site.deps).toEqual([expect.objectContaining({ name: 'node_modules', files: 60 })]);
    expect(find(p.tree, 'Cours/Semestre 1/Algo')!.files).toBe(120);
    expect(p.ignored.sort()).toEqual(['Thumbs.db', '~$brouillon.docx']);
    expect(p.duplicates.map((d) => d.rel).sort()).toEqual([
      'Ressources/deja.txt',
      'Ressources/fiche 1.txt',
    ]);
    expect(p.totals.files).toBe(1 + 240 + 4 + 2 + 182);
    // Nothing written by the preview.
    expect((await ok<ContextDto[]>(W, 'GET', `${API}/contexts`)).length).toBe(1);
    // « Importer »: the default choices (duplicates and dependencies left out).
    const st = await ok<ImportStatusDto>(W, 'POST', `${API}/import/start`, { source: root });
    await until(
      async () => (await ok<ImportStatusDto>(W, 'GET', `${API}/import/${st.id}`)).state === 'done',
    );
    const done = await ok<ImportStatusDto>(W, 'GET', `${API}/import/${st.id}`);
    expect(done.items).toBe(1 + 240 + 2 + 180);
    const lib = (...x: string[]) => path.join(W.hub.dataDir, 'coffre', ...x);
    expect(existsSync(lib('Programmation', 'Cours', 'Semestre 2', 'Réseaux', 'labo 7.txt'))).toBe(
      true,
    );
    expect(existsSync(lib('Programmation', 'Projets', 'site-web', 'src', 'app.js'))).toBe(true);
    expect(existsSync(lib('Programmation', 'Projets', 'site-web', 'node_modules'))).toBe(false);
    expect(existsSync(lib('Programmation', 'Projets', 'calculatrice', '__pycache__'))).toBe(false);
    expect(existsSync(lib('Programmation', 'Thumbs.db'))).toBe(false);
    // The originals: untouched.
    expect(snapshot(root)).toEqual(before);
    // The projects: one element each; everything « à compléter ».
    const contexts = await ok<ContextDto[]>(W, 'GET', `${API}/contexts`);
    const projets = contexts.find((c) => c.path.join('/') === 'Programmation/Projets')!;
    const inProjets = await ok<ItemDto[]>(W, 'GET', `${API}/items?context=${projets.id}`);
    expect(inProjets.map((i) => [i.name, i.kind]).sort()).toEqual([
      ['calculatrice', 'project'],
      ['site-web', 'project'],
    ]);
    const todo = await ok<ItemDto[]>(W, 'GET', `${API}/items?state=tocomplete`);
    expect(todo).toHaveLength(done.items);
    const home = await ok<HomeDto>(W, 'GET', `${API}/home`);
    expect(home.toCompleteCount).toBe(done.items);
    // The mark goes when the sheet is checked (one, then a lot).
    await ok(W, 'PATCH', `${API}/items/${todo[0]!.id}`, { toComplete: false });
    await ok(W, 'POST', `${API}/items/batch`, {
      ids: todo.slice(1, 6).map((i) => i.id),
      complete: true,
      tagsAdd: ['prog'],
    });
    expect((await ok<ItemDto[]>(W, 'GET', `${API}/items?state=tocomplete`)).length).toBe(
      done.items - 6,
    );
    // ONE « Annuler »: back to before (the originals still intact).
    await ok(W, 'POST', `${API}/undo`, { undoId: done.undoId });
    expect(existsSync(lib('Programmation'))).toBe(false);
    expect((await ok<ContextDto[]>(W, 'GET', `${API}/contexts`)).map((c) => c.name)).toEqual([
      'Divers',
    ]);
    expect(snapshot(root)).toEqual(before);
  }, 120_000);

  it('choix : un projet importé en dossiers, les dépendances gardées, sous une route', async () => {
    w = await diskWorld();
    const W = w;
    const root = programmation(W.dl);
    const st = await ok<ImportStatusDto>(W, 'POST', `${API}/import/start`, {
      source: root,
      newContext: ['Archives'],
      asFolder: ['Projets/calculatrice'],
      deps: ['Projets/site-web/node_modules'],
      keepDuplicates: true,
    });
    await until(
      async () => (await ok<ImportStatusDto>(W, 'GET', `${API}/import/${st.id}`)).state === 'done',
    );
    const lib = (...x: string[]) =>
      path.join(W.hub.dataDir, 'coffre', 'Archives', 'Programmation', ...x);
    expect(existsSync(lib('Projets', 'site-web', 'node_modules', 'pkg3', 'index.js'))).toBe(true);
    expect(existsSync(lib('Projets', 'calculatrice', 'main.py'))).toBe(true);
    const contexts = await ok<ContextDto[]>(W, 'GET', `${API}/contexts`);
    expect(
      contexts.some(
        (c) => c.path.join('/') === 'Archives/Programmation/Projets/calculatrice/tests',
      ),
    ).toBe(true);
    expect(existsSync(lib('Ressources', 'copie de fiche 1.txt'))).toBe(true);
  }, 120_000);

  it('annuler pendant l’import ; reprise après un redémarrage, sans doublon', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'coffre-import-'));
    w = await diskWorld({ dataDir });
    let W = w;
    const root = programmation(W.dl);
    process.env.TOOLBOX_COFFRE_IMPORT_PAUSE_MS = '15';
    // Cancelled: nothing left.
    const a = await ok<ImportStatusDto>(W, 'POST', `${API}/import/start`, { source: root });
    await until(
      async () => (await ok<ImportStatusDto>(W, 'GET', `${API}/import/${a.id}`)).done > 20,
    );
    await ok(W, 'POST', `${API}/import/${a.id}/cancel`, {});
    await until(
      async () =>
        (await ok<ImportStatusDto>(W, 'GET', `${API}/import/${a.id}`)).state === 'cancelled',
      60_000,
      async () => {
        const st = await ok<ImportStatusDto>(W, 'GET', `${API}/import/${a.id}`);
        const jobs = await ok<{ id: string }[]>(W, 'GET', '/api/core/jobs?module=coffre');
        const job = jobs.find((j) => j.id === st.jobId) ?? null;
        return { st, job };
      },
    );
    expect(existsSync(path.join(dataDir, 'coffre', 'Programmation'))).toBe(false);
    expect(await ok<ContextDto[]>(W, 'GET', `${API}/contexts`)).toEqual([]);
    // Stopped by a restart in the middle, resumed at the next start.
    const b = await ok<ImportStatusDto>(W, 'POST', `${API}/import/start`, { source: root });
    await until(
      async () => (await ok<ImportStatusDto>(W, 'GET', `${API}/import/${b.id}`)).done > 60,
    );
    const dl = W.dl;
    await W.close();
    w = null;
    delete process.env.TOOLBOX_COFFRE_IMPORT_PAUSE_MS;
    w = await diskWorld({ dataDir });
    W = w;
    void dl;
    await until(
      async () => (await ok<ImportStatusDto>(W, 'GET', `${API}/import/${b.id}`)).state === 'done',
      60_000,
    );
    const st = await ok<ImportStatusDto>(W, 'GET', `${API}/import/${b.id}`);
    expect(st.items).toBe(1 + 240 + 2 + 181);
    const algo = path.join(dataDir, 'coffre', 'Programmation', 'Cours', 'Semestre 1', 'Algo');
    const names = readdirSync(algo);
    expect(names).toHaveLength(120);
    expect(names.some((n) => n.includes('(2)') || n.startsWith('.~import-'))).toBe(false);
  }, 180_000);

  it('dossier copié à la main dans le Coffre : proposé, jamais adopté seul ; adopté sans copie', async () => {
    w = await diskWorld();
    const W = w;
    await deposit(W, { 'a.md': 'a' }, ['Cours']);
    const src = programmation(mkdtempSync(path.join(tmpdir(), 'coffre-main-')));
    const target = path.join(W.hub.dataDir, 'coffre', 'Cours', 'Programmation');
    cpSync(path.join(src, 'Cours'), target, { recursive: true });
    const found = await ok<FoundFolderDto[]>(W, 'GET', `${API}/import/found`);
    expect(found).toEqual([
      expect.objectContaining({ rel: 'Cours/Programmation', files: 240, route: ['Cours'] }),
    ]);
    // Nothing adopted alone.
    expect((await ok<ContextDto[]>(W, 'GET', `${API}/contexts`)).map((c) => c.name)).toEqual([
      'Cours',
    ]);
    const before = snapshot(target);
    const p = await runJob<ImportPreviewDto>(W, 'POST', `${API}/import/preview`, {
      source: target,
      adopt: true,
    });
    expect(p.mode).toBe('adopt');
    expect(p.route).toEqual(['Cours']);
    const st = await ok<ImportStatusDto>(W, 'POST', `${API}/import/start`, {
      source: target,
      adopt: true,
    });
    await until(
      async () => (await ok<ImportStatusDto>(W, 'GET', `${API}/import/${st.id}`)).state === 'done',
    );
    expect((await ok<ImportStatusDto>(W, 'GET', `${API}/import/${st.id}`)).items).toBe(240);
    // Not copied, not moved: the same files.
    expect(snapshot(target)).toEqual(before);
    expect(await ok<FoundFolderDto[]>(W, 'GET', `${API}/import/found`)).toEqual([]);
    // « Annuler » an adoption: only the sheets go, the files stay.
    await ok(W, 'POST', `${API}/undo`, {
      undoId: (await ok<ImportStatusDto>(W, 'GET', `${API}/import/${st.id}`)).undoId,
    });
    expect(snapshot(target)).toEqual(before);
    expect((await ok<FoundFolderDto[]>(W, 'GET', `${API}/import/found`)).length).toBe(1);
  }, 120_000);

  it('reprise d’un projet arrêté entre la mise en place de son dossier et sa fiche : jamais « (2) »', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'coffre-place-'));
    w = await diskWorld({ dataDir });
    let W = w;
    const root = programmation(W.dl);
    process.env.TOOLBOX_COFFRE_TEST_STOP_AFTER_PLACE = 'site-web';
    const st = await ok<ImportStatusDto>(W, 'POST', `${API}/import/start`, { source: root });
    const placed = path.join(dataDir, 'coffre', 'Programmation', 'Projets', 'site-web');
    await until(async () => existsSync(path.join(placed, 'package.json')));
    // The folder is in place, its sheet not written: ToolBox closes now.
    await new Promise((r) => setTimeout(r, 100));
    await W.close();
    w = null;
    delete process.env.TOOLBOX_COFFRE_TEST_STOP_AFTER_PLACE;
    w = await diskWorld({ dataDir });
    W = w;
    await until(
      async () => (await ok<ImportStatusDto>(W, 'GET', `${API}/import/${st.id}`)).state === 'done',
      60_000,
    );
    const projets = readdirSync(path.join(dataDir, 'coffre', 'Programmation', 'Projets')).sort();
    expect(projets).toEqual(['calculatrice', 'site-web']);
    const items = await ok<ItemDto[]>(W, 'GET', `${API}/items`);
    expect(items.filter((i) => i.name === 'site-web')).toHaveLength(1);
  }, 120_000);
});
