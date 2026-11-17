// v0.42.0: the categories, a list managed by Thomas. Without any action
// everything is as before (no row written, the same colours and defaults);
// create, colour, rename (events, week type, import mapping, re-import) and
// delete (events moved, never deleted), each with « Annuler ».
process.env.TZ = 'Europe/Brussels';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, dumpTables, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import {
  categoryColor,
  type CategoryDto,
  DEFAULT_OFF,
  mergeCategories,
} from '../shared/categories';
import { blockInk, colorValue, PALETTE, parseColor } from '../shared/palette';
import type { ImportPreview } from '../shared/importing';
import type { AgendaEventDto, AgendaSourceDto, RangeDto } from '../shared/types';

const API = '/api/modules/agenda';

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
  it('without any row: the fixed ones, the tools’, the used ones, with their colour of before', () => {
    const list = mergeCategories({
      rows: [],
      used: new Map([
        ['Cours', 3],
        ['Scouts', 2],
      ]),
      offByDefault: DEFAULT_OFF,
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
    });
    expect(list.find((c) => c.name === 'Scouts')).toMatchObject({ origin: 'used', events: 2 });
    expect(list.find((c) => c.name === 'Cours')!.events).toBe(3);
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
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
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

  it('nothing written while Thomas does nothing; the week answers as before', async () => {
    await open();
    await call('POST', '/events', {
      title: 'Dentiste',
      start: '2026-11-18T09:00',
      end: '2026-11-18T09:30',
    });
    const week = await call<RangeDto>('GET', '/range?from=2026-11-16&to=2026-11-22');
    expect(week.categoryInfo.find((c) => c.name === 'Rendez-vous')!.css).toBe('var(--series-1)');
    expect(week.categories).toEqual(['Rendez-vous']);
    expect(tables().agenda__categories).toEqual([]);
  });

  it('create (with a colour), its switch, refused twice; colour of a fixed one, back to the original', async () => {
    await open();
    const made = await call<CategoryDto>('POST', '/categories', {
      name: '  Soirée ',
      color: 'p:violet',
    });
    expect(made).toMatchObject({
      name: 'Soirée',
      origin: 'mine',
      css: 'var(--hue-violet)',
      shape: 'normal',
      counted: true,
      shownByDefault: true,
      events: 0,
    });
    expect(await status('POST', '/categories', { name: 'soirée' })).toBe(409);
    expect(await status('POST', '/categories', { name: 'Cours' })).toBe(409);
    expect(await status('POST', '/categories', { name: 'X', color: 'red' })).toBe(400);
    // Its switch, even with no event yet.
    const week = await call<RangeDto>('GET', '/range?from=2026-11-16&to=2026-11-22');
    expect(week.categories).toContain('Soirée');
    // A fixed one: its colour only (its name and shape stay).
    const blue = await call<CategoryDto>('PATCH', '/categories/Cours', { color: 'p:bleu' });
    expect(blue).toMatchObject({ css: 'var(--hue-bleu)', origin: 'fixed', name: 'Cours' });
    expect(await status('PATCH', '/categories/Cours', { shape: 'deadline' })).toBe(403);
    expect(await status('POST', '/categories/Cours/rename', { name: 'Labo' })).toBe(403);
    expect(await status('DELETE', '/categories/Cours')).toBe(403);
    const back = await call<CategoryDto>('PATCH', '/categories/Cours', { color: null });
    expect(back.css).toBe('var(--series-2)');
    // A free colour, kept in lower case.
    expect((await call<CategoryDto>('PATCH', '/categories/Soirée', { color: '#AA22CC' })).css).toBe(
      '#aa22cc',
    );
    // Its order.
    await call('PUT', '/categories/order', { keys: ['soirée', 'cours'] });
    expect((await list()).slice(0, 3).map((c) => c.name)).toEqual([
      'Soirée',
      'Cours',
      'Rendez-vous',
    ]);
  });

  it('rename: events, week type, import mapping follow (re-import still targets it); « Annuler »', async () => {
    await open();
    await call('POST', '/categories', { name: 'Labo' });
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
    await call('PATCH', `/weekly/${weekly.weekly.id}`, { category: 'Labo' });
    const labo = (await one('Labo'))!;
    expect(labo.events).toBeGreaterThan(1);
    const before = JSON.stringify(tables());

    const renamed = await call<{ category: CategoryDto; undoId: string; backup: string }>(
      'POST',
      '/categories/Labo/rename',
      { name: 'Labos TP' },
    );
    expect(renamed.category).toMatchObject({ name: 'Labos TP', events: labo.events });
    expect(renamed.backup).toBeTruthy();
    const t = tables();
    const events = t.agenda__events as { category: string; origin: string | null }[];
    expect(events.filter((e) => e.category === 'Labo')).toEqual([]);
    expect(events.filter((e) => e.category === 'Labos TP').length).toBe(labo.events - 1);
    expect((t.agenda__weekly as { category: string }[])[0]!.category).toBe('Labos TP');
    const source = await call<AgendaSourceDto[]>('GET', '/sources');
    expect(source[0]!.mapping).toEqual({ H: 'Labos TP', X: 'Examens' });
    expect(await one('Labo')).toBeUndefined();
    // The same file again: nothing to add or change (the imported category followed).
    const again = await call<ImportPreview>('POST', '/import/preview', {
      format: 'ics',
      text: ics,
      sourceId: done.source.id,
      period: 'all',
    });
    expect([again.add.length, again.modified.length]).toEqual([0, 0]);
    // « Annuler »: every row as it was.
    await call('POST', '/categories/undo', { undoId: renamed.undoId });
    const after = tables();
    const strip = (x: Record<string, unknown[]>) =>
      Object.fromEntries(
        Object.entries(x)
          .filter(([k]) => k !== 'agenda__changes')
          .map(([k, rows]) => [
            k,
            (rows as Record<string, unknown>[]).map(({ updated_at: _u, ...r }) => r),
          ]),
      );
    expect(strip(after)).toEqual(strip(JSON.parse(before) as Record<string, unknown[]>));
    expect(await status('POST', '/categories/undo', { undoId: renamed.undoId })).toBe(404);
  });

  it('delete: asks where to move its events, never deletes them; « Annuler »', async () => {
    await open();
    await call('POST', '/categories', { name: 'Soirée', color: 'p:violet' });
    const made = await call<AgendaEventDto>('POST', '/events', {
      title: 'Ciné',
      start: '2026-11-20T20:00',
      end: '2026-11-20T22:00',
      category: 'Soirée',
    });
    expect(await status('DELETE', '/categories/Soirée')).toBe(400);
    expect(await status('DELETE', '/categories/Soirée?moveTo=soirée')).toBe(400);
    const gone = await call<{ moved: number; undoId: string; backup: string }>(
      'DELETE',
      '/categories/Soirée?moveTo=Loisirs',
    );
    expect(gone.moved).toBe(1);
    expect(gone.backup).toBeTruthy();
    const row = (
      tables().agenda__events as { id: string; category: string; deleted_at: null }[]
    )[0]!;
    expect(row).toMatchObject({ id: made.id, category: 'Loisirs', deleted_at: null });
    expect(await one('Soirée')).toBeUndefined();
    await call('POST', '/categories/undo', { undoId: gone.undoId });
    expect((await one('Soirée'))!).toMatchObject({ css: 'var(--hue-violet)', events: 1 });
    expect((tables().agenda__events as { category: string }[])[0]!.category).toBe('Soirée');
    // Without events: deleted directly.
    await call('POST', '/categories', { name: 'Vide' });
    await call('DELETE', '/categories/Vide');
    expect(await one('Vide')).toBeUndefined();
  });
});
