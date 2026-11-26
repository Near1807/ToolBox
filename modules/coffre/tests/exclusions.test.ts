// v0.51.0 (ADR 0068): what a project does not save — the default list, the
// .gitignore files (root and sub-folder, negation « ! »), Thomas's choices;
// .git never excluded; an excluded folder is not entered.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseChoices, ProjectRules, walkProject } from '../backend/exclusions';

const project = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'coffre-excl-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
};

describe('exclusions d’un projet', () => {
  it('.gitignore racine et sous-dossier, négation, liste par défaut, .git jamais exclu', async () => {
    const root = project({
      '.gitignore': '*.log\n/secret/\ndata/\n!data/garder.csv\n.git\n',
      'src/.gitignore': 'generated/\n!keep.log\n',
      'src/main.py': 'print(1)',
      'src/keep.log': 'garde',
      'src/debug.log': 'non',
      'src/generated/x.py': 'x',
      'secret/cle.txt': 'k',
      'data/a.csv': '1',
      'data/garder.csv': '2',
      'node_modules/pkg/index.js': '1',
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.pio/build/fw.bin': 'bin',
      'README.md': '# r',
    });
    const w = await walkProject(root, undefined, { measureExcluded: true });
    expect(w.files.map((f) => f.rel)).toEqual([
      '.git/HEAD',
      '.gitignore',
      'README.md',
      'src/.gitignore',
      'src/keep.log',
      'src/main.py',
    ]);
    const why = Object.fromEntries(w.excluded.map((e) => [e.rel, e.reason]));
    expect(why).toEqual({
      '.pio': 'défaut',
      data: '.gitignore', // a folder excluded: « !data/garder.csv » cannot bring a file back (git)
      node_modules: 'défaut',
      secret: '.gitignore',
      'src/debug.log': '.gitignore',
      'src/generated': '.gitignore',
    });
    expect(w.excluded.find((e) => e.rel === 'node_modules')).toMatchObject({ files: 1, bytes: 1 });
  });

  it('les choix de Thomas : « Ne pas sauvegarder » et « Le sauvegarder quand même » (gagne)', async () => {
    const root = project({
      '.gitignore': 'dist/\n',
      'dist/app.js': '1',
      'node_modules/a/i.js': '1',
      'photos/p.jpg': 'jpg',
      'main.rs': 'fn main(){}',
    });
    const choices = parseChoices(
      JSON.stringify({ exclude: ['photos', '../hors'], include: ['dist', 'node_modules'] }),
    );
    expect(choices).toEqual({ exclude: ['photos'], include: ['dist', 'node_modules'] });
    const w = await walkProject(root, choices);
    expect(w.files.map((f) => f.rel)).toEqual([
      '.gitignore',
      'dist/app.js',
      'main.rs',
      'node_modules/a/i.js',
    ]);
    expect(w.excluded.map((e) => [e.rel, e.reason])).toEqual([['photos', 'choisi']]);
    // .git never, even when chosen.
    const rules = new ProjectRules(root, { exclude: ['.git'], include: [] });
    expect(rules.reason('.git', true)).toBeNull();
  });
});
