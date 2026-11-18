// v0.42.0 → v0.43.0 (ADR 0049): the categories are objects with an
// identifier and settings that act. Without any action everything is as
// before (the same colours and defaults); create (unique without case nor
// accents), settings (counted, conflicts, defaults), rename (ONE row: the
// elements, the import mapping and a re-import follow by the id) and delete
// (elements moved, never deleted), each with « Annuler »; a task's category.
process.env.TZ = 'Europe/Brussels';

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, dumpTables, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import {
  categoryColor,
  type CategoryDto,
  DEFAULT_OFF,
  mergeCategories,
} from '../shared/categories';
import { categoryIdOf } from '../shared/category-id';
import { blockInk, colorValue, PALETTE, parseColor } from '../shared/palette';
import type { ImportPreview } from '../shared/importing';
import type { AgendaEventDto, AgendaSourceDto, RangeDto } from '../shared/types';

const API = '/api/modules/agenda';
const MODULES = path.resolve(__dirname, '..', '..');

describe('the palette', () => {
  it('the 16 hues of the list are the ones of the themes’ palette.css', () => {
    const css = readFileSync(
      path.resolve(__dirname, '../../../frontend/src/themes/palette.css'),
      'utf8',
    );
    const ids = (selector: RegExp) =>
      [...selector.exec(css)![1]!.matchAll(/--hue-([a-z]+)\s*:/g)].map((m) => m[1]);
    const want = PALETTE.map((p) => p.id);
    expect(ids(/:root\s*\{([^}]*)\}/)).toEqual(want);
    expect(ids(/:root\[data-scheme='light'\]\s*\{([^}]*)\}/)).toEqual(want);
  });
});

describe('the list (pure)', () => {
  it('rows first; fixed, tools and names of the data without a row: their colour of before, the id they will get', () => {
    const list = mergeCategories({
      rows: [],
      counts: new Map([
        ['cours', 3],
        ['scouts', 2],
      ]),
      names: ['Cours', 'Scouts', 'scouts'],
      offByDefault: DEFAULT_OFF,
      idOf: categoryIdOf,
    });
    expect(list.slice(0, 7).map((c) => c.name)).toEqual([
      'Rendez-vous',
      'Cours',
      'Réunions',
      'Examens',
      'Loisirs',
      'Perso',
      'Deadline',
    ]);
    for (const c of list) if (c.key !== 'deadline') expect(c.css).toBe(categoryColor(c.name));
    expect(list.find((c) => c.key === 'deadline')).toMatchObject({
      css: 'var(--danger)',
      shape: 'deadline',
      origin: 'fixed',
    });
    expect(list.find((c) => c.name === 'Sport')).toMatchObject({
      origin: 'tool',
      shownByDefault: false,
      counted: true,
      conflicts: true,
    });
    // « scouts » and « Scouts »: one category, Thomas's (renamed and deleted like his own).
    expect(list.filter((c) => c.key === 'scouts')).toHaveLength(1);
    expect(list.find((c) => c.name === 'Scouts')).toMatchObject({
      origin: 'mine',
      events: 2,
      stored: false,
      id: categoryIdOf('Scouts'),
    });
    // The same id whatever the case or the accents.
    expect(categoryIdOf('Réunions')).toBe(categoryIdOf(' reunions '));
  });

  it('a free colour gets the readable ink, and says when it stays low', () => {
    const dark = {
      surface: parseColor('#1e1e24')!,
      text: parseColor('#f2f2f5')!,
      bg: parseColor('#121216')!,
    };
    const light = {
      surface: parseColor('#ffffff')!,
      text: parseColor('#1d1d22')!,
      bg: parseColor('#f6f6f8')!,
    };
    for (const s of [dark, light])
      for (const hex of ['#ffeb3b', '#0d47a1', '#ff00ff', '#808080', '#00ff00']) {
        const ink = blockInk(parseColor(hex)!, s.surface, { text: s.text, other: s.bg });
        // The surface takes 70 % of the block: a theme's text stays readable on it.
        expect(ink.ratio, `${hex}`).toBeGreaterThanOrEqual(4.5);
        expect(ink.low).toBe(false);
      }
    // Two inks close to the colour: flagged.
    const grey = parseColor('#777777')!;
    expect(blockInk(grey, grey, { text: grey, other: grey }).low).toBe(true);
    expect(colorValue('p:violet', 'var(--series-1)')).toBe('var(--hue-violet)');
    expect(colorValue('#AA00ff', 'x')).toBe('#aa00ff');
    expect(colorValue(null, 'var(--series-2)')).toBe('var(--series-2)');
  });
});

describe('the categories through the routes', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });
  const open = async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 15, 10) });
    hub = await createTestHub({
      loadExamples: false,
      modules: await Promise.all(
        ['todo', 'agenda'].map((id) => loadModuleFolder(path.join(MODULES, id))),
      ),
    });
  };
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await hub.request<T>(method, `${API}${url}`, body);
    if (r.status !== 200)
      throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const status = async (method: string, url: string, body?: unknown) =>
    (await hub.request(method, `${API}${url}`, body)).status;
  const tables = () => dumpTables(hub.dataDir, 'agenda');
  const list = () => call<CategoryDto[]>('GET', '/categories');
  const one = async (name: string) => (await list()).find((c) => c.name === name);
  const week = () => call<RangeDto>('GET', '/range?from=2026-11-16&to=2026-11-22');

  it('a new base: the fixed and the tools’ categories stored, with the same id everywhere; an element points to its category', async () => {
    await open();
    const rows = tables().agenda__categories as { id: string; name: string; builtin: number }[];
    expect(rows.map((r) => r.name).sort()).toEqual(
      [
        'Cours',
        'Cuisine',
        'Deadline',
        'Examens',
        'Loisirs',
        'Musique',
        'Perso',
        'Repas',
        'Rendez-vous',
        'Réunions',
        'Sport',
        'Timer',
        'Tâches',
      ].sort(),
    );
    for (const r of rows) {
      expect(r.id).toBe(categoryIdOf(r.name));
      expect(r.builtin).toBe(1);
    }
    const made = await call<AgendaEventDto>('POST', '/events', {
      title: 'Dentiste',
      start: '2026-11-18T09:00',
      end: '2026-11-18T09:30',
    });
    expect(made.categoryId).toBe(categoryIdOf('Rendez-vous'));
    const w = await week();
    expect(w.categoryInfo.find((c) => c.name === 'Rendez-vous')!.css).toBe('var(--series-1)');
    expect(w.categories).toEqual(['Rendez-vous']);
  });

  it('create (unique without case nor accents), settings that act, defaults returned; built-in ones: settings only', async () => {
    await open();
    const made = await call<CategoryDto>('POST', '/categories', {
      name: '  Scouts ',
      color: 'p:vert',
      defaultDuration: 120,
      defaultLocation: 'Local',
    });
    expect(made).toMatchObject({
      name: 'Scouts',
      origin: 'mine',
      css: 'var(--hue-vert)',
      shape: 'normal',
      counted: true,
      conflicts: true,
      defaultDuration: 120,
      defaultLocation: 'Local',
      stored: true,
    });
    expect(made.id).not.toBe(categoryIdOf('Scouts')); // made by hand: a random UUID
    expect(await status('POST', '/categories', { name: 'scouts' })).toBe(409);
    expect(await status('POST', '/categories', { name: 'Reunions' })).toBe(409);
    expect(await status('POST', '/categories', { name: 'X', color: 'red' })).toBe(400);
    // Its switch, even with no event yet.
    expect((await week()).categories).toContain('Scouts');
    // Settings act: not counted, no conflicts.
    const set = await call<CategoryDto>('PATCH', `/categories/${made.id}`, {
      counted: false,
      conflicts: false,
    });
    expect(set).toMatchObject({ counted: false, conflicts: false });
    // A built-in one: colour and settings, never its name nor its type.
    const cours = (await one('Cours'))!;
    expect(
      (await call<CategoryDto>('PATCH', `/categories/${cours.id}`, { color: 'p:bleu' })).css,
    ).toBe('var(--hue-bleu)');
    expect(await status('PATCH', `/categories/${cours.id}`, { shape: 'deadline' })).toBe(403);
    expect(await status('POST', `/categories/${cours.id}/rename`, { name: 'Labo' })).toBe(403);
    expect(await status('DELETE', `/categories/${cours.id}`)).toBe(403);
    expect((await call<CategoryDto>('PATCH', `/categories/${cours.id}`, { color: null })).css).toBe(
      'var(--series-2)',
    );
    // An element in it, by its id.
    const e = await call<AgendaEventDto>('POST', '/events', {
      title: 'Réunion',
      start: '2026-11-21T14:00',
      end: '2026-11-21T16:00',
      categoryId: made.id,
    });
    expect(e).toMatchObject({ category: 'Scouts', categoryId: made.id });
    // Its order.
    await call('PUT', '/categories/order', { keys: [made.id, cours.id] });
    expect((await list()).slice(0, 3).map((c) => c.name)).toEqual([
      'Scouts',
      'Cours',
      'Rendez-vous',
    ]);
  });

  it('rename: ONE row; elements, week type, import mapping and a re-import follow by the id; « Annuler »', async () => {
    await open();
    const labo = await call<CategoryDto>('POST', '/categories', { name: 'Labo' });
    const ics = readFileSync(path.join(__dirname, 'fixtures', 'horaire-ecam.ics'), 'utf8');
    const choice = {
      format: 'ics',
      text: ics,
      name: 'Horaire ECAM',
      mapping: { H: 'Labo', X: 'Examens' },
      period: 'all',
    };
    const p = await call<ImportPreview>('POST', '/import/preview', choice);
    const done = await call<{ source: AgendaSourceDto }>('POST', '/import/apply', {
      ...choice,
      accept: p.add.map((l) => l.key),
    });
    const weekly = await call<{ weekly: { id: string } }>('POST', '/quick', {
      text: 'badminton tous les jeudis 19h 2h',
    });
    await call('PATCH', `/weekly/${weekly.weekly.id}`, { categoryId: labo.id });
    const before = tables();
    const md5 = (rows: unknown) => createHash('md5').update(JSON.stringify(rows)).digest('hex');

    const renamed = await call<{ category: CategoryDto; undoId: string }>(
      'POST',
      `/categories/${labo.id}/rename`,
      { name: 'Labos TP' },
    );
    expect(renamed.category).toMatchObject({ id: labo.id, name: 'Labos TP' });
    const after = tables();
    // Only the category's row changed.
    for (const t of ['agenda__events', 'agenda__weekly', 'agenda__sources'])
      expect(md5(after[t]), t).toBe(md5(before[t]));
    // Everything shows the new name.
    const source = (await call<AgendaSourceDto[]>('GET', '/sources'))[0]!;
    expect(source.mapping).toEqual({ H: 'Labos TP', X: 'Examens' });
    expect(source.categories).toContain('Labos TP');
    expect((await week()).weekly[0]!.category).toBe('Labos TP');
    // The same file again: nothing to add or change; a new event of « H » goes to « Labos TP ».
    const again = await call<ImportPreview>('POST', '/import/preview', {
      format: 'ics',
      text: ics,
      sourceId: done.source.id,
      period: 'all',
    });
    expect([again.add.length, again.modified.length]).toEqual([0, 0]);
    expect(again.categories.find((c) => c.value === 'H')!.category).toBe('Labos TP');
    // « Annuler »: the old name.
    await call('POST', '/categories/undo', { undoId: renamed.undoId });
    expect((await one('Labo'))!.id).toBe(labo.id);
    expect(await status('POST', '/categories/undo', { undoId: renamed.undoId })).toBe(404);
  });

  it('delete: asks where to move its elements, never deletes them; « Annuler »', async () => {
    await open();
    const soiree = await call<CategoryDto>('POST', '/categories', {
      name: 'Soirée',
      color: 'p:violet',
    });
    const made = await call<AgendaEventDto>('POST', '/events', {
      title: 'Ciné',
      start: '2026-11-20T20:00',
      end: '2026-11-20T22:00',
      categoryId: soiree.id,
    });
    const loisirs = (await one('Loisirs'))!;
    expect(await status('DELETE', `/categories/${soiree.id}`)).toBe(400);
    expect(await status('DELETE', `/categories/${soiree.id}?moveTo=${soiree.id}`)).toBe(400);
    const gone = await call<{ moved: number; undoId: string; backup: string }>(
      'DELETE',
      `/categories/${soiree.id}?moveTo=${loisirs.id}`,
    );
    expect(gone.moved).toBe(1);
    expect(gone.backup).toBeTruthy();
    const row = (tables().agenda__events as Record<string, unknown>[])[0]!;
    expect(row).toMatchObject({ id: made.id, category_id: loisirs.id, deleted_at: null });
    expect(await one('Soirée')).toBeUndefined();
    await call('POST', '/categories/undo', { undoId: gone.undoId });
    expect((await one('Soirée'))!).toMatchObject({ css: 'var(--hue-violet)', events: 1 });
    expect((tables().agenda__events as Record<string, unknown>[])[0]!.category_id).toBe(soiree.id);
    // Without elements: deleted directly.
    const vide = await call<CategoryDto>('POST', '/categories', { name: 'Vide' });
    await call('DELETE', `/categories/${vide.id}`);
    expect(await one('Vide')).toBeUndefined();
  });

  it('a task of the To-do gets a category of the Agenda; the To-do does not change', async () => {
    await open();
    const ecam = await call<CategoryDto>('POST', '/categories', {
      name: 'ECAM',
      color: 'p:indigo',
    });
    const task = await call<{ id: string }>('POST', '/tasks', {
      title: 'Rapport',
      plannedAt: '2026-11-19T14:00',
      durationMin: 60,
    });
    const todoBefore = JSON.stringify(dumpTables(hub.dataDir, 'todo'));
    const set = await call<{ categoryId: string; before: string | null }>(
      'PUT',
      `/tasks/${task.id}/category`,
      { categoryId: ecam.id },
    );
    expect(set).toMatchObject({ categoryId: ecam.id, before: null });
    expect(JSON.stringify(dumpTables(hub.dataDir, 'todo'))).toBe(todoBefore);
    const t = (await week()).tasks.find((x) => x.id === task.id)!;
    expect(t).toMatchObject({ category: 'ECAM', categoryId: ecam.id });
    // « Annuler »: back to « Tâches ».
    await call('PUT', `/tasks/${task.id}/category`, { categoryId: set.before });
    expect((await week()).tasks.find((x) => x.id === task.id)!.category).toBe('Tâches');
  });
});
