// v0.45.0: the Coffre's pages without a screen — the rangement window's
// entries and what « Ranger » sends, the context typed, sorts and families,
// the readers' registry (a fake reader needs no change anywhere else), safe
// Markdown, coloured code that stays escaped, the isolated HTML frame.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ContextDto, ItemDto, ProposalDto } from '../shared/types';
import {
  applyEntry,
  chooseValues,
  contextOfPath,
  entriesOf,
  familiesOf,
  isHeldDuplicate,
  parseContextPath,
  sortItems,
} from '../frontend/logic';
import { readerFor, readers, registerReader } from '../frontend/readers';
import { ReaderView } from '../frontend/ReaderView';
import { highlight } from '../frontend/readers/code.reader';
import { IsolatedFrame, isolatedDocument, ISOLATED_CSP } from '../frontend/readers/html.reader';
import { renderMarkdown } from '../frontend/readers/markdown.reader';

const proposal = (over: Partial<ProposalDto> = {}): ProposalDto => ({
  path: '/dl/cours.pdf',
  name: 'cours.pdf',
  isDirectory: false,
  fileCount: 1,
  size: 10,
  sha256: 'a',
  duplicate: null,
  context: {
    kind: 'existing',
    id: 'c1',
    path: ['Cours', 'Thermo'],
    reason: 'mot « thermo » du nom',
  },
  attributes: [{ key: 'nature', value: 'document', origin: 'guessed', reason: 'extension .pdf' }],
  ...over,
});

const ctx = (id: string, path: string[], count = 1): ContextDto => ({
  id,
  parentId: null,
  name: path[path.length - 1]!,
  color: null,
  css: 'var(--series-1)',
  sort: null,
  path,
  count,
  fresh: 0,
  coverItemId: null,
});

const item = (name: string, over: Partial<ItemDto> = {}): ItemDto => ({
  id: name,
  kind: 'file',
  name,
  ext: name.split('.').pop() ?? '',
  size: 1,
  sha256: null,
  contextId: null,
  contextPath: null,
  arrival: false,
  pinned: false,
  trashedAt: null,
  externalPath: null,
  sourcePath: null,
  fileDate: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  attributes: [],
  alsoIn: [],
  url: null,
  path: null,
  ...over,
});

describe('fenêtre de rangement', () => {
  it('reprend la proposition (devinée, avec sa raison) ou le contexte où l’on a déposé (choisi)', () => {
    const [guessed] = entriesOf([proposal()]);
    expect(guessed!.choice).toEqual({
      kind: 'existing',
      id: 'c1',
      origin: 'guessed',
      reason: 'mot « thermo » du nom',
    });
    const [fixed] = entriesOf([proposal()], { fixed: 'c9' });
    expect(fixed!.choice).toMatchObject({ kind: 'existing', id: 'c9', origin: 'chosen' });
    const [none] = entriesOf([proposal({ context: null })]);
    expect(none!.choice).toBeNull();
    const [made] = entriesOf([
      proposal({
        context: { kind: 'new', path: ['Cours', 'Réseaux'], reason: 'cours de l’Agenda' },
      }),
    ]);
    expect(made!.choice).toMatchObject({ kind: 'new', path: ['Cours', 'Réseaux'] });
  });

  it('« Ranger » envoie le contexte, « Ranger plus tard » envoie dans Arrivée', () => {
    const [e] = entriesOf([proposal()]);
    expect(applyEntry(e!)).toMatchObject({
      path: '/dl/cours.pdf',
      contextId: 'c1',
      arrival: false,
    });
    expect(applyEntry(e!, true)).toMatchObject({
      contextId: null,
      newContext: null,
      arrival: true,
    });
    const [n] = entriesOf([
      proposal({ context: { kind: 'new', path: ['Cours', 'X'], reason: '' } }),
    ]);
    expect(applyEntry(n!)).toMatchObject({
      contextId: null,
      newContext: ['Cours', 'X'],
      arrival: false,
    });
    const [link] = entriesOf([proposal()], { as: 'link' });
    expect(applyEntry(link!).as).toBe('link');
  });

  it('un doublon est laissé de côté par « Tout valider » tant qu’il n’est pas « gardé quand même »', () => {
    const [d] = entriesOf([
      proposal({ duplicate: { id: 'x', name: 'cours.pdf', contextPath: null } }),
    ]);
    expect(isHeldDuplicate(d!)).toBe(true);
    expect(isHeldDuplicate({ ...d!, keepDuplicate: true })).toBe(false);
    const [link] = entriesOf([proposal({ duplicate: { id: 'x', name: 'a', contextPath: null } })], {
      as: 'link',
    });
    expect(isHeldDuplicate(link!)).toBe(false);
  });

  it('une valeur changée est « choisie », les autres clés restent', () => {
    const list = chooseValues(proposal().attributes, 'language', ['CSS', ' CSS ', '']);
    expect(list).toEqual([
      { key: 'nature', value: 'document', origin: 'guessed', reason: 'extension .pdf' },
      { key: 'language', value: 'CSS', origin: 'chosen', reason: null },
    ]);
    expect(chooseValues(list, 'nature', [])).toEqual([list[1]]);
  });

  it('un contexte écrit : « Cours › Thermo », « Cours/Thermo », l’existant retrouvé sans accents ni casse', () => {
    expect(parseContextPath(' Cours ›  Thermo ')).toEqual(['Cours', 'Thermo']);
    expect(parseContextPath('Cours/Thermo')).toEqual(['Cours', 'Thermo']);
    expect(parseContextPath('  ')).toEqual([]);
    const list = [ctx('a', ['Cours', 'Électricité'])];
    expect(contextOfPath(list, ['cours', 'electricite'])?.id).toBe('a');
    expect(contextOfPath(list, ['Cours'])).toBeNull();
  });
});

describe('listes', () => {
  it('trie par nom (nombres compris), taille, date, nature', () => {
    const list = [
      item('b10.pdf', { size: 5, fileDate: '2025-01-01' }),
      item('b2.pdf', { size: 9, fileDate: '2026-01-01' }),
      item('a.py', {
        size: 1,
        attributes: [{ key: 'nature', value: 'code', origin: 'guessed', reason: null }],
      }),
    ];
    expect(sortItems(list, 'name').map((i) => i.name)).toEqual(['a.py', 'b2.pdf', 'b10.pdf']);
    expect(sortItems(list, 'size').map((i) => i.name)).toEqual(['b2.pdf', 'b10.pdf', 'a.py']);
    expect(sortItems(list, 'date')[0]!.name).toBe('b2.pdf');
    expect(sortItems(list, 'nature').map((i) => i.name)).toEqual(['a.py', 'b2.pdf', 'b10.pdf']);
  });

  it('les tuiles par famille : la famille seule quand elle n’a pas d’enfant ou des éléments', () => {
    const families = familiesOf([
      ctx('c', ['Cours'], 0),
      ctx('t', ['Cours', 'Thermo']),
      ctx('a', ['Administratif'], 3),
    ]);
    expect(families.map((f) => f.family)).toEqual(['Administratif', 'Cours']);
    expect(families[1]!.tiles.map((t) => t.id)).toEqual(['t']);
    expect(families[0]!.tiles.map((t) => t.id)).toEqual(['a']);
  });
});

describe('lecteurs', () => {
  it('chaque fichier *.reader.tsx est enregistré tout seul', () => {
    expect(
      readers()
        .map((r) => r.id)
        .sort(),
    ).toEqual(['audio', 'code', 'html', 'image', 'markdown', 'pdf', 'text', 'video'].sort());
  });

  it('un lecteur ajouté (factice) est utilisé sans rien changer ailleurs', () => {
    const source = { name: 'plan.zzz', ext: 'zzz', size: 3, url: '/api/media/t/plan.zzz' };
    expect(
      renderToStaticMarkup(createElement(ReaderView, { source, mode: 'full', icon: 'file' })),
    ).not.toContain('factice');
    registerReader({
      id: 'factice',
      label: 'Factice',
      extensions: ['zzz'],
      component: ({ source: s, mode }) => createElement('b', null, `factice ${s.name} ${mode}`),
    });
    expect(readerFor(source)?.id).toBe('factice');
    expect(
      renderToStaticMarkup(createElement(ReaderView, { source, mode: 'thumb', icon: 'file' })),
    ).toContain('factice plan.zzz thumb');
  });

  it('la taille, la priorité et l’absence de fichier décident du lecteur', () => {
    registerReader({
      id: 'gros',
      label: 'g',
      extensions: ['yyy'],
      maxBytes: 10,
      component: () => null,
    });
    registerReader({
      id: 'mieux',
      label: 'm',
      extensions: ['yyy'],
      priority: 5,
      maxBytes: 5,
      component: () => null,
    });
    const s = (size: number) => ({ name: 'f.yyy', ext: 'yyy', size, url: '/f' });
    expect(readerFor(s(3))?.id).toBe('mieux');
    expect(readerFor(s(8))?.id).toBe('gros');
    expect(readerFor(s(80))).toBeNull();
    expect(readerFor({ ...s(3), url: null })).toBeNull();
    expect(readerFor({ name: 'a.PDF', ext: 'PDF', size: 1, url: '/a' })?.id).toBe('pdf');
    expect(readerFor({ name: 'a.docx', ext: 'docx', size: 1, url: '/a' })).toBeNull();
  });

  it('Markdown : le HTML du fichier reste du texte, aucune image n’est chargée', () => {
    const html = renderMarkdown(
      '# Titre\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![logo](https://exemple.be/a.png)\n\n**gras** [lien](https://exemple.be)',
    );
    expect(html).toContain('<h1>Titre</h1>');
    expect(html).toContain('<strong>gras</strong>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('code coloré : le texte du fichier reste échappé', () => {
    const html = highlight('x = "<b>"  # </span><script>', 'py');
    expect(html).toContain('hljs-string');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    expect(highlight('rien', 'docx')).toBeNull();
  });

  it('HTML isolé : sandbox vide (aucun script), aucune requête permise', () => {
    expect(ISOLATED_CSP).toContain("default-src 'none'");
    const doc = isolatedDocument(
      '<script>fetch("https://x.be")</script><img src="https://x.be/a.png">',
    );
    expect(doc.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    const frame = renderToStaticMarkup(createElement(IsolatedFrame, { doc, title: 'page' }));
    expect(frame).toMatch(/sandbox=""/);
    expect(frame).not.toMatch(/allow-scripts|allow-same-origin/);
    expect(frame.toLowerCase()).toContain('referrerpolicy="no-referrer"');
  });
});
