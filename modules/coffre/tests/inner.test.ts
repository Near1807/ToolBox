// v0.51.0 A and D (ADR 0068): the files INSIDE a project, each one on its own —
// found by its name and its content (its line), opened alone (its project's
// page, VS Code at its line), in the views by label; what the project does not
// save (default list, .gitignore, Thomas's choices) never indexed nor searched.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ExclusionsDto,
  FolderDto,
  HomeDto,
  InnerFileDto,
  InnerGroupDto,
  InsideDto,
  SearchDto,
} from '../shared/types';
import { API, diskWorld, job as runJob, ok, type DiskWorld } from './disk-helpers';

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
async function indexed(W: DiskWorld) {
  const end = Date.now() + 60_000;
  for (;;) {
    const h = await ok<HomeDto>(W, 'GET', `${API}/home`);
    if (h.health.index.pending === 0 && !h.health.index.running) return h.health.index;
    if (Date.now() > end) throw new Error(`Index pas fini : ${JSON.stringify(h.health.index)}`);
    await new Promise((r) => setTimeout(r, 30));
  }
}
const search = (W: DiskWorld, q: string) =>
  ok<SearchDto>(W, 'GET', `${API}/search?q=${encodeURIComponent(q)}`);
/** A folder dropped as a project at a route. */
async function dropProject(W: DiskWorld, src: string, route: string[]) {
  await runJob(W, 'POST', `${API}/deposit/apply`, {
    entries: [{ path: src, newFolder: route, projects: [''], labels: [] }],
  });
  const folders = await ok<FolderDto[]>(W, 'GET', `${API}/folders`);
  return folders.find((f) => f.path.join('/') === [...route, path.basename(src)].join('/'))!;
}

describe('les fichiers intérieurs d’un projet', () => {
  it('« auto_mail » : main.py trouvé seul par son nom et son contenu (ligne), ouvert seul, vue Python', async () => {
    w = await diskWorld();
    const W = w;
    const src = path.join(W.dl, 'auto_mail');
    put(path.join(src, 'mails.txt'), 'liste des destinataires');
    put(
      path.join(src, 'main.py'),
      'import os\n\nimport smtplib\n\ndef envoyer():\n    serveur = smtplib.SMTP("localhost")\n',
    );
    put(path.join(src, 'test.py'), 'def test_envoi():\n    assert True\n');
    put(path.join(src, 'notice.pdf'), '%PDF-1.4');
    const folder = await dropProject(W, src, ['Programmation']);
    await indexed(W);
    // By its name: the file itself, « Programmation › auto_mail (projet) ».
    const byName = await search(W, 'main.py');
    expect(byName.results[0]!.inner).toMatchObject({ rel: 'main.py', name: 'main.py', ext: 'py' });
    expect(byName.results[0]!.item).toMatchObject({ kind: 'project', name: 'auto_mail' });
    // By its content: that file, at the line of the word.
    const byText = await search(W, 'smtplib');
    const hit = byText.results.find((r) => r.inner?.rel === 'main.py')!;
    expect(hit.inner!.line).toBe(3);
    expect(hit.hits[0]!.snippet).toContain('smtplib');
    expect(byText.results.some((r) => r.inner?.rel === 'test.py')).toBe(false);
    // Ctrl+K: the file, its project's page positioned on it.
    const hub = await W.hub.request<{
      groups: { results: { title: string; hint: string; open: string }[] }[];
    }>('GET', `/api/core/search?q=smtplib`);
    const ctrlK = hub.body.groups.flatMap((g) => g.results).find((r) => r.title === 'main.py')!;
    expect(ctrlK.hint).toContain('Programmation › auto_mail (projet)');
    expect(ctrlK.open).toBe(`/m/coffre/c/${folder.id}?f=main.py&line=3&q=smtplib`);
    // Its reader alone (its own page or window): its labels deduced or the project's.
    const project = byName.results[0]!.item;
    const file = await ok<InnerFileDto>(W, 'GET', `${API}/files/${project.id}/inner?rel=main.py`);
    expect(file).toMatchObject({ name: 'main.py', folderId: folder.id });
    expect(file.url).toBeTruthy();
    expect(file.labels.find((l) => l.family === 'language')).toMatchObject({
      value: 'Python',
      origin: 'guessed',
    });
    // VS Code on the project, at the line (a fake VS Code writes its arguments).
    const fake = path.join(W.dl, 'vscode');
    const exe = path.join(fake, 'Programs', 'Microsoft VS Code', 'Code.exe');
    const argsFile = path.join(W.dl, 'args.txt');
    put(exe, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\n`);
    chmodSync(exe, 0o755);
    const before = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = fake;
    try {
      const r = await ok<{ args: string[] }>(W, 'POST', `${API}/folders/${folder.id}/open`, {
        rel: 'main.py',
        how: 'vscode',
        line: 3,
      });
      const root = path.join(W.hub.dataDir, 'coffre', 'Programmation', 'auto_mail');
      expect(r.args).toEqual([root, '-g', `${path.join(root, 'main.py')}:3`]);
      for (let i = 0; i < 100 && !readFileSafe(argsFile); i++)
        await new Promise((res) => setTimeout(res, 20));
      expect(readFileSafe(argsFile).trim().split('\n')).toEqual(r.args);
    } finally {
      if (before === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = before;
    }
    // The view « Python »: the files inside the project, grouped by it.
    const view = await ok<InnerGroupDto[]>(
      W,
      'GET',
      `${API}/inner-files?family=language&value=Python`,
    );
    expect(view).toHaveLength(1);
    expect(view[0]!.project.id).toBe(project.id);
    expect(view[0]!.files.map((f) => f.rel)).toEqual(['main.py', 'test.py']);
  });

  it('projet React : node_modules (pas copié) et ce que dit le .gitignore ni indexés ni cherchés ; « le sauvegarder quand même »', async () => {
    w = await diskWorld();
    const W = w;
    const src = path.join(W.dl, 'site-react');
    put(path.join(src, 'package.json'), '{"name":"site"}');
    put(path.join(src, '.gitignore'), 'generated/\n*.local\n');
    put(path.join(src, 'src', 'App.jsx'), 'export const App = () => <h1>Bonjour fusée</h1>;\n');
    put(path.join(src, 'generated', 'bundle.js'), 'const fusee = "fusée minifiée";\n');
    put(path.join(src, 'node_modules', 'react', 'index.js'), 'fusée');
    put(path.join(src, '.env.local'), 'SECRET=fusée');
    const folder = await dropProject(W, src, ['Web']);
    await indexed(W);
    const ex = await ok<ExclusionsDto>(W, 'GET', `${API}/folders/${folder.id}/exclusions`);
    expect(ex.excluded.map((e) => [e.rel, e.reason])).toEqual([
      ['.env.local', '.gitignore'],
      ['generated', '.gitignore'],
    ]);
    // node_modules (default list): not even copied in the Coffre (as in v0.49).
    expect(ex.files).toBe(3); // .gitignore, package.json, src/App.jsx
    // Searched: only what it saves.
    expect((await search(W, 'fusee')).results.map((r) => r.inner?.rel)).toEqual(['src/App.jsx']);
    // The inside: the excluded ones are hidden, and say why when shown.
    const inside = await ok<InsideDto>(W, 'GET', `${API}/folders/${folder.id}/inside?hidden=1`);
    expect(inside.entries.find((e) => e.rel === 'generated')).toMatchObject({
      excluded: true,
      excludedReason: '.gitignore',
      hidden: true,
    });
    const plain = await ok<InsideDto>(W, 'GET', `${API}/folders/${folder.id}/inside`);
    expect(plain.entries.some((e) => e.rel === 'generated')).toBe(false);
    // « Le sauvegarder quand même »: indexed and searched; « Annuler » puts it back.
    const r = await runJob<{ undoId: string; files: number }>(
      W,
      'POST',
      `${API}/folders/${folder.id}/exclusions`,
      { rel: 'generated', action: 'include' },
    );
    expect(r.files).toBe(4);
    await indexed(W);
    expect((await search(W, 'fusee')).results.map((x) => x.inner?.rel).sort()).toEqual([
      'generated/bundle.js',
      'src/App.jsx',
    ]);
    await ok(W, 'POST', `${API}/undo`, { undoId: r.undoId });
    expect((await search(W, 'fusee')).results.map((x) => x.inner?.rel)).toEqual(['src/App.jsx']);
    // .git: never excluded.
    expect(
      (
        await W.hub.request('POST', `${API}/folders/${folder.id}/exclusions`, {
          rel: '.git',
          action: 'exclude',
        })
      ).status,
    ).toBe(409);
    // The original never touched.
    expect(readFileSync(path.join(src, 'generated', 'bundle.js'), 'utf8')).toContain('fusée');
  });
});

describe('un cours avec 4 scripts et un seul .git', () => {
  it('chaque script trouvé seul par son nom et son contenu ; .git sauvegardé, jamais exclu', async () => {
    w = await diskWorld();
    const W = w;
    const src = path.join(W.dl, 'Algo');
    for (const [n, body] of [
      ['tri.py', 'def tri(liste):\n    return sorted(liste)\n'],
      ['graphe.py', 'def parcours_largeur(g):\n    pass\n'],
      ['pile.py', 'class Pile:\n    pass\n'],
      ['file.py', 'class File:\n    pass\n'],
    ])
      put(path.join(src, 'scripts', n!), body);
    put(path.join(src, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    put(path.join(src, '.git', 'config'), '[core]\n\tbare = false\n');
    const folder = await dropProject(W, src, ['Cours']);
    await indexed(W);
    for (const n of ['tri.py', 'graphe.py', 'pile.py', 'file.py']) {
      const r = await search(W, n);
      expect(r.results[0]!.inner?.rel).toBe(`scripts/${n}`);
    }
    const r = await search(W, 'parcours_largeur');
    expect(r.results.map((x) => x.inner?.rel)).toEqual(['scripts/graphe.py']);
    expect(r.results[0]!.inner!.line).toBe(1);
    // .git is saved (never excluded): in the project's files.
    const ex = await ok<ExclusionsDto>(W, 'GET', `${API}/folders/${folder.id}/exclusions`);
    expect(ex.excluded).toEqual([]);
    expect(ex.files).toBe(6);
  });
});

function readFileSafe(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
