// v0.50.0 (ADR 0067): the model « tout est dossier » — real cases with
// invented data: a folder arrives as it is, « Projet » proposed with its reason,
// a project is ONE entry (indivisible), « Fin de route », the map's folders,
// creating a folder and a file, labels (copy / paste, defaults, named sets).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnalyzeResultDto, FolderDto, InsideDto, ItemDto, LabelSetDto } from '../shared/types';
import { API, analyze, diskWorld, job as runJob, ok, type DiskWorld } from './disk-helpers';

let w: DiskWorld | null = null;
afterEach(async () => {
  await w?.close();
  w = null;
});

const put = (file: string, content: string | Buffer = 'x') => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
};
const folders = (W: DiskWorld) => ok<FolderDto[]>(W, 'GET', `${API}/folders`);
const byRoute = (list: FolderDto[], route: string) =>
  list.find((f) => f.path.join('/') === route) ?? null;

describe('le modèle « tout est dossier »', () => {
  it('« auto_mail » (sans Git) : déposé tel quel, Projet proposé parce qu’il contient du code', async () => {
    w = await diskWorld();
    const W = w;
    const src = path.join(W.dl, 'auto_mail');
    put(path.join(src, 'mails.txt'), 'liste');
    put(path.join(src, 'main.py'), 'print(1)');
    put(path.join(src, 'test.py'), 'assert True');
    put(path.join(src, 'notice.pdf'), '%PDF-1.4');
    const [p] = await analyze(W, { paths: [src] });
    expect(p!.isDirectory).toBe(true);
    expect(p!.projects).toEqual([{ rel: '', reason: 'contient du code', nested: false }]);
    // Accepted: one entry (a project), one folder on the map with its badge.
    await runJob(W, 'POST', `${API}/deposit/apply`, {
      entries: [{ path: src, newFolder: ['Programmation'], projects: [''], labels: [] }],
    });
    const list = await folders(W);
    const project = byRoute(list, 'Programmation/auto_mail')!;
    expect(project).toMatchObject({ project: true, endOfRoute: true, count: 4 });
    const files = await ok<ItemDto[]>(W, 'GET', `${API}/files?folder=${project.id}`);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ kind: 'project', inProject: true });
    // Indivisible: no file of it moves on its own.
    const refused = await W.hub.request('PATCH', `${API}/files/${files[0]!.id}`, { later: true });
    expect(refused.status).toBe(409);
    // The original untouched; the copy as it is.
    expect(readFileSync(path.join(src, 'main.py'), 'utf8')).toBe('print(1)');
    const lib = path.join(W.hub.dataDir, 'coffre', 'Programmation', 'auto_mail');
    expect(readFileSync(path.join(lib, 'mails.txt'), 'utf8')).toBe('liste');
  });

  it('un cours avec 4 scripts Python et un seul .git à sa racine : un projet, tout ensemble', async () => {
    w = await diskWorld();
    const W = w;
    const src = path.join(W.dl, 'Algo');
    for (const n of ['tri.py', 'graphe.py', 'pile.py', 'file.py'])
      put(path.join(src, 'scripts', n), `# ${n}`);
    put(path.join(src, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    put(
      path.join(src, '.git', 'logs', 'HEAD'),
      '0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 Thomas <t@x> 1764000000 +0100\tcommit (initial): Premier tri\n',
    );
    put(path.join(src, 'node_modules', 'pkg', 'index.js'), '//');
    const [p] = await analyze(W, { paths: [src] });
    expect(p!.projects?.[0]).toEqual({ rel: '', reason: '.git', nested: false });
    expect(p!.setAside?.map((s) => s.name)).toEqual(['node_modules']);
    await runJob(W, 'POST', `${API}/deposit/apply`, {
      entries: [{ path: src, newFolder: ['Cours'], projects: [''], labels: [] }],
    });
    const project = byRoute(await folders(W), 'Cours/Algo')!;
    expect(project.project).toBe(true);
    // The map stops there: no « scripts » folder row.
    expect(byRoute(await folders(W), 'Cours/Algo/scripts')).toBeNull();
    const lib = path.join(W.hub.dataDir, 'coffre', 'Cours', 'Algo');
    expect(existsSync(path.join(lib, '.git', 'HEAD'))).toBe(true);
    expect(existsSync(path.join(lib, 'node_modules'))).toBe(false);
    // Inside: the tree (hidden folders apart), the branch and the last commit, read only.
    const inside = await ok<InsideDto>(W, 'GET', `${API}/folders/${project.id}/inside`);
    expect(inside.entries.map((e) => e.rel)).toEqual([
      'scripts',
      'scripts/file.py',
      'scripts/graphe.py',
      'scripts/pile.py',
      'scripts/tri.py',
    ]);
    expect(inside.git).toMatchObject({ branch: 'main', commit: { message: 'Premier tri' } });
    const hidden = await ok<InsideDto>(W, 'GET', `${API}/folders/${project.id}/inside?hidden=1`);
    expect(hidden.entries.some((e) => e.rel === '.git/HEAD' && e.hidden)).toBe(true);
  });

  it('40 diapositives : un nœud, ses fichiers dans sa vue ; une Fin de route cache ses sous-dossiers de la carte', async () => {
    w = await diskWorld();
    const W = w;
    const slides = path.join(W.dl, 'Slides');
    for (let i = 1; i <= 40; i++)
      put(path.join(slides, `cours ${String(i).padStart(2, '0')}.pptx`), `s${i}`);
    const labo = path.join(W.dl, 'Labo');
    put(path.join(labo, 'Séance 1', 'mesures.csv'), '1;2');
    put(path.join(labo, 'Séance 2', 'mesures.csv'), '3;4');
    const proposals = await analyze(W, { paths: [slides, labo] });
    expect(proposals.every((p) => !p.projects?.length)).toBe(true);
    await runJob(W, 'POST', `${API}/deposit/apply`, {
      entries: [
        { path: slides, newFolder: ['Cours', 'Réseaux'], labels: [] },
        { path: labo, newFolder: ['Cours', 'Physique'], labels: [] },
      ],
    });
    let list = await folders(W);
    const s = byRoute(list, 'Cours/Réseaux/Slides')!;
    expect(s.count).toBe(40);
    expect(byRoute(list, 'Cours')!.total).toBe(42);
    const l = byRoute(list, 'Cours/Physique/Labo')!;
    const end = await ok<FolderDto>(W, 'POST', `${API}/folders/${l.id}/end`, { on: true });
    expect(end.endOfRoute).toBe(true);
    list = await folders(W);
    // Its sub-folders are « inside » (the map stops on it); browsed in its view.
    expect(byRoute(list, 'Cours/Physique/Labo/Séance 1')!.inside).toBe(true);
    const inside = await ok<InsideDto>(W, 'GET', `${API}/folders/${l.id}/inside`);
    expect(inside.entries.filter((e) => !e.dir).every((e) => e.itemId)).toBe(true);
    // Nothing moved on the PC.
    expect(
      existsSync(
        path.join(W.hub.dataDir, 'coffre', 'Cours', 'Physique', 'Labo', 'Séance 2', 'mesures.csv'),
      ),
    ).toBe(true);
  });

  it('un projet React : node_modules écarté (ni copié ni compté), caché ; poser / enlever Projet ne bouge rien', async () => {
    w = await diskWorld();
    const W = w;
    const src = path.join(W.dl, 'site');
    put(path.join(src, 'package.json'), '{}');
    put(path.join(src, 'src', 'App.jsx'), 'export default 1');
    put(path.join(src, 'README.md'), '# Site');
    for (let i = 0; i < 30; i++) put(path.join(src, 'node_modules', `p${i}`, 'i.js'), '//');
    await runJob(W, 'POST', `${API}/deposit/apply`, {
      entries: [{ path: src, newFolder: ['Programmation'], projects: [''], labels: [] }],
    });
    const project = byRoute(await folders(W), 'Programmation/site')!;
    expect(project.count).toBe(3);
    const inside = await ok<InsideDto>(W, 'GET', `${API}/folders/${project.id}/inside`);
    expect(inside.readme).toBe('README.md');
    expect(inside.entries.some((e) => e.name === 'node_modules')).toBe(false);
    // « Enlever Projet »: its files become files of folders; « Annuler » folds them back.
    const off = await ok<FolderDto & { undoId: string }>(
      W,
      'POST',
      `${API}/folders/${project.id}/project`,
      { on: false },
    );
    expect(off.project).toBe(false);
    expect(byRoute(await folders(W), 'Programmation/site/src')).not.toBeNull();
    const deep = await ok<ItemDto[]>(W, 'GET', `${API}/files?folder=${project.id}&deep=1`);
    expect(deep.map((i) => i.name).sort()).toEqual(['App.jsx', 'README.md', 'package.json']);
    await ok(W, 'POST', `${API}/undo`, { undoId: off.undoId });
    expect(byRoute(await folders(W), 'Programmation/site')!.project).toBe(true);
    expect(byRoute(await folders(W), 'Programmation/site/src')).toBeNull();
  });

  it('créer : un dossier, « notes.md », « main.py », « lanceur.bat » (jamais lancé sans confirmation), jamais d’écrasement', async () => {
    w = await diskWorld();
    const W = w;
    const made = await ok<FolderDto>(W, 'POST', `${API}/folders`, { route: ['Cours', 'Réseaux'] });
    expect(made.path).toEqual(['Cours', 'Réseaux']);
    expect(existsSync(path.join(W.hub.dataDir, 'coffre', 'Cours', 'Réseaux'))).toBe(true);
    const notes = await ok<{ item: ItemDto; open: string }>(W, 'POST', `${API}/files/create`, {
      folderId: made.id,
      name: 'notes.md',
    });
    expect(notes.item).toMatchObject({ name: 'notes.md', size: 0 });
    expect(notes.open).toBe('app');
    const py = await ok<{ open: string }>(W, 'POST', `${API}/files/create`, {
      folderId: made.id,
      name: 'main.py',
    });
    expect(py.open).toBe('vscode');
    const bat = await ok<{ item: ItemDto; open: string }>(W, 'POST', `${API}/files/create`, {
      folderId: made.id,
      name: 'lanceur.bat',
    });
    // A script is code: VS Code (v0.47.1), never its application without a confirmation.
    expect(bat.open).toBe('vscode');
    const launched = await W.hub.request('POST', `${API}/files/${bat.item.id}/open`, {
      how: 'app',
    });
    expect(launched.status).toBe(409);
    const twice = await W.hub.request('POST', `${API}/files/create`, {
      folderId: made.id,
      name: 'notes.md',
    });
    expect(twice.status).toBe(409);
    expect(
      (await W.hub.request('POST', `${API}/files/create`, { name: 'sans-extension' })).status,
    ).toBe(400);
    expect((await W.hub.request('POST', `${API}/files/create`, { name: 'a:b.txt' })).status).toBe(
      400,
    );
  });

  it('étiquettes : par défaut d’un dossier (la plus proche l’emporte, jamais rétroactives sans clic), copier / coller, ensembles, choisi jamais écrasé', async () => {
    w = await diskWorld();
    const W = w;
    const cours = await ok<FolderDto>(W, 'POST', `${API}/folders`, { route: ['Cours'] });
    const slides = await ok<FolderDto>(W, 'POST', `${API}/folders`, {
      route: ['Cours', 'Réseaux', 'Slides'],
    });
    const reseaux = byRoute(await folders(W), 'Cours/Réseaux')!;
    // A file already there before the defaults: never changed without a click.
    const old = await ok<{ item: ItemDto }>(W, 'POST', `${API}/files/create`, {
      folderId: slides.id,
      name: 'avant.txt',
    });
    await ok(W, 'PATCH', `${API}/folders/${cours.id}`, {
      defaults: [{ family: 'free', value: 'école' }],
    });
    await ok(W, 'PATCH', `${API}/folders/${reseaux.id}`, {
      defaults: [
        { family: 'course', value: 'Réseaux' },
        { family: 'nature', value: 'support du prof' },
      ],
    });
    expect(
      (await ok<ItemDto>(W, 'GET', `${API}/files/${old.item.id}`)).labels.some(
        (l) => l.origin === 'default',
      ),
    ).toBe(false);
    // The window's proposal for a file dropped into Slides: Réseaux's defaults (the nearest).
    const ppt = path.join(W.dl, 'cours 1.pptx');
    put(ppt, 'pptx');
    const [p] = await analyze(W, { paths: [ppt], folderId: slides.id });
    const defaults = p!.labels.filter((l) => l.origin === 'default');
    expect(defaults.map((l) => `${l.family}:${l.value}`).sort()).toEqual([
      'course:Réseaux',
      'nature:support du prof',
    ]);
    expect(defaults[0]!.reason).toMatch(/par défaut du dossier « Réseaux »/);
    // « Appliquer aux fichiers déjà présents »: preview, then with « Annuler ».
    const preview = await ok<{ files: number }>(
      W,
      'POST',
      `${API}/folders/${reseaux.id}/defaults/apply`,
      { preview: true },
    );
    expect(preview.files).toBe(1);
    const applied = await ok<{ files: number; undoId: string }>(
      W,
      'POST',
      `${API}/folders/${reseaux.id}/defaults/apply`,
      {},
    );
    expect(applied.files).toBe(1);
    // Copy the labels of one file, paste them on 5 others (add, then replace); one « Annuler ».
    const five: string[] = [];
    for (let i = 1; i <= 5; i++)
      five.push(
        (
          await ok<{ item: ItemDto }>(W, 'POST', `${API}/files/create`, {
            folderId: cours.id,
            name: `f${i}.txt`,
          })
        ).item.id,
      );
    await ok(W, 'PUT', `${API}/files/${five[0]}/labels`, { family: 'prof', values: ['PCH'] });
    const pasted = await ok<{ items: ItemDto[]; undoId: string }>(
      W,
      'POST',
      `${API}/files/labels/paste`,
      {
        ids: five,
        labels: [
          { family: 'year', value: '2026' },
          { family: 'free', value: 'exam' },
        ],
        mode: 'add',
      },
    );
    expect(pasted.items[0]!.labels.some((l) => l.family === 'prof' && l.value === 'PCH')).toBe(
      true,
    );
    expect(
      pasted.items.every((i) =>
        i.labels.some((l) => l.family === 'free' && l.value === 'exam' && l.origin === 'chosen'),
      ),
    ).toBe(true);
    const replaced = await ok<{ items: ItemDto[] }>(W, 'POST', `${API}/files/labels/paste`, {
      ids: five,
      labels: [{ family: 'nature', value: 'synthèse' }],
      mode: 'replace',
    });
    expect(replaced.items.every((i) => i.labels.length === 1)).toBe(true);
    // A chosen label is never replaced by the deductions (« Deviner à nouveau »).
    const again = await ok<ItemDto>(W, 'POST', `${API}/files/${five[0]}/guess`, {});
    expect(again.labels.find((l) => l.family === 'nature')).toMatchObject({
      value: 'synthèse',
      origin: 'chosen',
    });
    // A named set: created, reused by « coller », renamed, deleted (with « Annuler »).
    const set = await ok<LabelSetDto>(W, 'POST', `${API}/label-sets`, {
      name: 'Slides de cours',
      labels: [
        { family: 'nature', value: 'support du prof' },
        { family: 'course', value: 'Réseaux' },
      ],
    });
    expect(
      (
        await W.hub.request('POST', `${API}/label-sets`, {
          name: 'slides de cours',
          labels: set.labels,
        })
      ).status,
    ).toBe(409);
    await ok(W, 'POST', `${API}/files/labels/paste`, {
      ids: [five[1]],
      labels: set.labels,
      mode: 'add',
    });
    const renamed = await ok<LabelSetDto>(W, 'PATCH', `${API}/label-sets/${set.id}`, {
      name: 'Diapos',
    });
    expect(renamed.name).toBe('Diapos');
    const gone = await ok<{ undoId: string }>(W, 'DELETE', `${API}/label-sets/${set.id}`);
    expect(await ok<LabelSetDto[]>(W, 'GET', `${API}/label-sets`)).toEqual([]);
    await ok(W, 'POST', `${API}/undo`, { undoId: gone.undoId });
    expect((await ok<LabelSetDto[]>(W, 'GET', `${API}/label-sets`))[0]!.name).toBe('Diapos');
  });

  it('un projet se déplace, s’archive et se supprime entier ; un projet dans un projet est refusé', async () => {
    w = await diskWorld();
    const W = w;
    const src = path.join(W.dl, 'outil');
    put(path.join(src, 'Cargo.toml'), '[package]');
    put(path.join(src, 'src', 'main.rs'), 'fn main(){}');
    put(path.join(src, 'plugins', 'extra', 'package.json'), '{}');
    const [p] = await analyze(W, { paths: [src] });
    expect(p!.projects).toEqual([
      { rel: '', reason: 'Cargo.toml', nested: false },
      { rel: 'plugins/extra', reason: 'package.json', nested: true },
    ]);
    await runJob(W, 'POST', `${API}/deposit/apply`, {
      entries: [
        { path: src, newFolder: ['Programmation'], projects: ['', 'plugins/extra'], labels: [] },
      ],
    });
    const list = await folders(W);
    const project = byRoute(list, 'Programmation/outil')!;
    // Moved whole (a task): on the PC as a block.
    await runJob(W, 'POST', `${API}/folders/${project.id}/move`, { newParent: ['Archives'] });
    expect(
      existsSync(
        path.join(W.hub.dataDir, 'coffre', 'Archives', 'outil', 'plugins', 'extra', 'package.json'),
      ),
    ).toBe(true);
    // Nothing enters a project from the Coffre.
    const other = await ok<FolderDto>(W, 'POST', `${API}/folders`, { route: ['Divers'] });
    expect(
      (await W.hub.request('POST', `${API}/folders/${other.id}/move`, { parentId: project.id }))
        .status,
    ).toBe(409);
    expect(
      (await W.hub.request('POST', `${API}/files/create`, { folderId: project.id, name: 'x.txt' }))
        .status,
    ).toBe(409);
    // To the Recycle Bin whole (its folder leaves the map), back with « Annuler ».
    const gone = await ok<{ undoId: string }>(W, 'DELETE', `${API}/folders/${project.id}/project`);
    expect(byRoute(await folders(W), 'Archives/outil')).toBeNull();
    await ok(W, 'POST', `${API}/undo`, { undoId: gone.undoId });
    expect(byRoute(await folders(W), 'Archives/outil')!.project).toBe(true);
    expect(
      existsSync(path.join(W.hub.dataDir, 'coffre', 'Archives', 'outil', 'src', 'main.rs')),
    ).toBe(true);
  });
});

void (null as unknown as AnalyzeResultDto);
