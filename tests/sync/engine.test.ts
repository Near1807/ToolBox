// The synchronisation engine on two real bases: the PC (better-sqlite3, the
// real hub) and the phone (sqlite-wasm, the phone host), with the 5 portable
// modules (ADR 0044). Changes on both sides, then an exchange: the same data
// on both devices; the conflicts kept; nothing applied by halves.
import { afterEach, describe, expect, it } from 'vitest';
import { Hlc } from '../../backend/core/sync/hlc';
import { SyncError, type Batch } from '../../backend/core/sync/engine';
import { beginExchange, serveExchange, VersionMismatch } from '../../backend/core/sync/protocol';
import { devices, type Devices } from './harness';

const TODO = '/api/modules/todo';
const IDEAS = '/api/modules/ideas';
const SPORT = '/api/modules/sport';
const TIMER = '/api/modules/timer';
const COURSES = '/api/modules/courses';

/** Both devices hold the same rows, module by module. */
const same = (d: Devices) => {
  for (const m of ['todo', 'ideas', 'sport', 'timer', 'courses']) {
    const a = d.rows('pc', m);
    const b = d.rows('phone', m);
    if (process.env.DBG)
      for (const t of Object.keys(a))
        for (const r of a[t]!) {
          const o = b[t]!.find((x) => x.id === r.id);
          if (JSON.stringify(o) !== JSON.stringify(r)) console.log(m, t, 'PC', r, 'PHONE', o);
        }
    expect(b, `module ${m}`).toEqual(a);
  }
};
const live = (rows: Record<string, unknown>[]) => rows.filter((r) => r.deleted_at === null);

describe('synchronisation PC ↔ téléphone (moteur)', () => {
  let d: Devices;
  afterEach(async () => d?.close());

  it('changes on both devices, for each of the 5 modules → the same data on both', async () => {
    d = await devices();
    d.first('merge');
    // To-do
    const a = await d.onPc<{ id: string }>('POST', `${TODO}/tasks`, {
      title: 'Appeler Paul',
      tags: ['perso'],
    });
    await d.onPhone('POST', `${TODO}/tasks`, { title: 'Acheter des cordes', tags: ['studio'] });
    // Boîte à idées
    await d.onPhone('POST', `${IDEAS}/ideas`, {
      title: 'Un break avec des cordes',
      tags: ['arrangement'],
    });
    await d.onPc('POST', `${IDEAS}/ideas`, { title: 'Pochette', tags: ['visuel'] });
    // Sport: the template on the PC, an exercise on the phone
    await d.onPc('PUT', `${SPORT}/template`, {
      items: [
        { weekday: 1, name: 'Haut du corps', start: '18:00', durationMin: 60, exercises: [] },
      ],
    });
    await d.onPhone('POST', `${SPORT}/exercises`, { name: 'Gainage', note: '' });
    // Timer: a preset on each side
    await d.onPc('POST', `${TIMER}/presets`, {
      name: 'Long',
      config: { mode: 'simple', workMin: 50 },
    });
    await d.onPhone('POST', `${TIMER}/presets`, {
      name: 'Court',
      config: { mode: 'simple', workMin: 10 },
    });
    // Courses: ingredients on each side, a meal, a setting (objectives) on the phone
    await d.onPc('POST', `${COURSES}/ingredients`, { name: 'Riz', unit: 'g', aisle: 'Épicerie' });
    await d.onPhone('POST', `${COURSES}/ingredients`, {
      name: 'Œuf',
      unit: 'pièce',
      aisle: 'Frais',
    });
    await d.onPhone('PUT', `${COURSES}/goals`, { proteinPerDay: 140 });
    const first = d.exchange();
    expect(first.sent).toBeGreaterThan(0);
    expect(first.received).toBeGreaterThan(0);
    // Then edits of what came from the other side.
    await d.onPhone('PATCH', `${TODO}/tasks/${a.id}`, { done: true });
    d.exchange();
    same(d);
    expect(
      live(d.rows('pc', 'todo').tasks!)
        .map((t) => t.title)
        .sort(),
    ).toEqual(['Acheter des cordes', 'Appeler Paul']);
    expect(d.rows('pc', 'todo').tasks!.find((t) => t.id === a.id)!.done_at).not.toBeNull();
    // The synchronised setting reached the PC; a display setting did not travel.
    expect(d.pc.hub.settings.get('courses', 'goalProteinPerDay')).toBe(140);
    // A third exchange with nothing new: nothing moves.
    expect(d.exchange()).toEqual({ received: 0, sent: 0, conflicts: 0 });
  });

  it('clocks 10 minutes apart: the change made last still wins (HLC)', async () => {
    d = await devices();
    d.first('merge');
    const t = await d.onPc<{ id: string }>('POST', `${TODO}/tasks`, { title: 'Version du PC' });
    d.exchange();
    // The phone's clock is 10 minutes late.
    const engine = d.phoneEngine as unknown as { hlc: Hlc };
    engine.hlc = new Hlc(d.phoneEngine.device, () => Date.now() - 600_000, engine.hlc.current());
    await d.onPhone('PATCH', `${TODO}/tasks/${t.id}`, {
      title: 'Version du téléphone, faite après',
    });
    d.exchange();
    same(d);
    expect(d.rows('pc', 'todo').tasks!.find((r) => r.id === t.id)!.title).toBe(
      'Version du téléphone, faite après',
    );
  });

  it('the same field changed on both sides: the most recent wins, the other is in the conflicts', async () => {
    d = await devices();
    d.first('merge');
    const t = await d.onPc<{ id: string }>('POST', `${TODO}/tasks`, { title: 'Avant' });
    d.exchange();
    await d.onPhone('PATCH', `${TODO}/tasks/${t.id}`, { title: 'Téléphone' });
    await new Promise((r) => setTimeout(r, 5));
    await d.onPc('PATCH', `${TODO}/tasks/${t.id}`, { title: 'PC, plus récent' });
    const r = d.exchange();
    expect(r.conflicts).toBeGreaterThan(0);
    same(d);
    expect(d.rows('phone', 'todo').tasks!.find((x) => x.id === t.id)!.title).toBe(
      'PC, plus récent',
    );
    for (const engine of [d.pcEngine, d.phoneEngine]) {
      const c = engine.conflicts().find((x) => x.field === 'title')!;
      expect(c).toMatchObject({
        kind: 'field',
        kept: '"PC, plus récent"',
        discarded: '"Téléphone"',
      });
      expect([c.kept_device, c.discarded_device].sort()).toEqual(
        [d.pcEngine.device, d.phoneEngine.device].sort(),
      );
    }
    // A field changed on one side only is no conflict.
    await d.onPhone('PATCH', `${TODO}/tasks/${t.id}`, { title: 'Seulement ici' });
    expect(d.exchange().conflicts).toBe(0);
  });

  it('deleted on one side, changed on the other: stays deleted (restorable), with the change, listed', async () => {
    d = await devices();
    d.first('merge');
    const t = await d.onPc<{ id: string }>('POST', `${TODO}/tasks`, { title: 'À supprimer' });
    d.exchange();
    await d.onPc('DELETE', `${TODO}/tasks/${t.id}`);
    await d.onPhone('PATCH', `${TODO}/tasks/${t.id}`, { title: 'Modifiée sur le téléphone' });
    d.exchange();
    same(d);
    const row = d.rows('pc', 'todo').tasks!.find((x) => x.id === t.id)!;
    expect(row.deleted_at).not.toBeNull();
    expect(row.title).toBe('Modifiée sur le téléphone');
    expect(
      d.pcEngine.conflicts().some((c) => c.kind === 'deleted-edited' && c.row_id === t.id),
    ).toBe(true);
    // Restored on the phone: restored everywhere.
    await d.onPhone('POST', `${TODO}/tasks/${t.id}/restore`);
    d.exchange();
    expect(d.rows('pc', 'todo').tasks!.find((x) => x.id === t.id)!.deleted_at).toBeNull();
  });

  it('the same name created on both devices: never merged alone, in « Conflits », « Fusionner » works', async () => {
    d = await devices();
    d.first('merge');
    await d.onPc('POST', `${COURSES}/ingredients`, { name: 'Riz', unit: 'g' });
    await d.onPhone('POST', `${COURSES}/ingredients`, { name: 'riz', unit: 'g' });
    d.exchange();
    same(d);
    expect(live(d.rows('pc', 'courses').ingredients!)).toHaveLength(2);
    const c = d.pcEngine.conflicts().find((x) => x.kind === 'name')!;
    expect(c.label).toMatch(/Ingrédient « Riz » existe deux fois/);
    expect(d.phoneEngine.conflicts().some((x) => x.kind === 'name')).toBe(true);
    // « Fusionner » (the module's merge), then synchronised.
    const merge = d.pcEngine.mergeFor(c)!;
    await d.onPc('POST', `/api/modules/${merge.scope}${merge.route}`, merge.body);
    d.pcEngine.resolveConflict(c.id, 'fusionné');
    d.exchange();
    same(d);
    expect(live(d.rows('phone', 'courses').ingredients!)).toHaveLength(1);
    // No merge for that kind: listed only.
    await d.onPc('POST', `${TIMER}/presets`, {
      name: 'Lecture',
      config: { mode: 'simple', workMin: 20 },
    });
    await d.onPhone('POST', `${TIMER}/presets`, {
      name: 'lecture',
      config: { mode: 'simple', workMin: 25 },
    });
    d.exchange();
    const p = d.pcEngine
      .conflicts()
      .find((x) => x.kind === 'name' && x.entity === 'timer/presets')!;
    expect(d.pcEngine.mergeFor(p)).toBeNull();
  });

  it('a tag created on both devices (the base holds one): the PC’s is kept, listed', async () => {
    d = await devices();
    d.first('merge');
    await d.onPc('POST', `${IDEAS}/ideas`, { title: 'A', tags: ['live'] });
    await d.onPhone('POST', `${IDEAS}/ideas`, { title: 'B', tags: ['live'] });
    // A tag has a row once coloured: coloured on both devices.
    await d.onPc('PUT', `${IDEAS}/tags/live`, { color: 3 });
    await d.onPhone('PUT', `${IDEAS}/tags/live`, { color: 5 });
    d.exchange();
    same(d);
    expect(live(d.rows('pc', 'ideas').tags!).filter((t) => t.name === 'live')).toHaveLength(1);
    expect(live(d.rows('pc', 'ideas').ideas!)).toHaveLength(2);
    expect(
      d.pcEngine.conflicts().some((c) => c.kind === 'duplicate' && c.entity === 'ideas/tags'),
    ).toBe(true);
  });

  it('the same week filled on both devices: the PC’s is kept; the phone’s untouched sessions go, a changed one stays', async () => {
    d = await devices();
    d.first('merge');
    const template = {
      items: [
        { weekday: 1, name: 'Haut', start: '18:00', durationMin: 60, exercises: [] },
        { weekday: 3, name: 'Course', start: '07:00', durationMin: 30, exercises: [] },
      ],
    };
    await d.onPc('PUT', `${SPORT}/template`, template);
    d.exchange(); // The template on both, no week yet.
    const nextMonday = (await d.onPc<{ week: string }>('GET', `${SPORT}/week`)).week;
    const week = new Date(`${nextMonday}T12:00:00Z`);
    week.setUTCDate(week.getUTCDate() + 7);
    const monday = week.toISOString().slice(0, 10);
    // Each device fills next week (before any exchange).
    await d.onPc('GET', `${SPORT}/week?start=${monday}`);
    const onPhone = await d.onPhone<{ days: { sessions: { id: string; name: string }[] }[] }>(
      'GET',
      `${SPORT}/week?start=${monday}`,
    );
    const phoneSessions = onPhone.days.flatMap((x) => x.sessions);
    expect(phoneSessions).toHaveLength(2);
    // One of the phone's sessions is changed (a comment).
    await d.onPhone('PATCH', `${SPORT}/sessions/${phoneSessions[1]!.id}`, { comment: 'genou' });
    d.exchange();
    same(d);
    const weeks = live(d.rows('pc', 'sport').weeks!).filter((w) => w.week === monday);
    expect(weeks).toHaveLength(1);
    const sessions = live(d.rows('pc', 'sport').sessions!).filter((s) => s.week === monday);
    // The PC's two, and the phone's changed one (listed).
    expect(sessions.map((s) => s.name).sort()).toEqual(['Course', 'Course', 'Haut']);
    expect(sessions.find((s) => s.id === phoneSessions[0]!.id)).toBeUndefined();
    expect(
      d.pcEngine
        .conflicts()
        .some((c) => c.row_id === phoneSessions[1]!.id && /modifiée/.test(c.label)),
    ).toBe(true);
  });

  it('a batch played twice changes nothing; a batch that fails half-way applies nothing', async () => {
    d = await devices();
    d.first('merge');
    await d.onPhone('POST', `${TODO}/tasks`, { title: 'Une' });
    const request = JSON.parse(JSON.stringify(beginExchange(d.phoneEngine, d.pcEngine.device)));
    serveExchange(d.pcEngine, d.phoneEngine.device, request);
    const before = JSON.stringify(d.rows('pc', 'todo'));
    const again = d.pcEngine.applyBatch(d.phoneEngine.device, request.batch, request.received);
    expect(again).toMatchObject({ applied: 0, skipped: request.batch.changes.length });
    expect(JSON.stringify(d.rows('pc', 'todo'))).toBe(before);
    // A batch whose second change breaks (a required column missing): the first is not kept.
    await d.onPhone('POST', `${TODO}/tasks`, { title: 'Deux' });
    const bad = beginExchange(d.phoneEngine, d.pcEngine.device).batch as Batch;
    const good = bad.changes.find((c) => c.entity === 'tasks' && c.op === 'create')!;
    const broken = { ...good, id: 'x-broken', entity_id: 'x-broken-row', data: { tags: '[]' } };
    expect(() =>
      d.pcEngine.applyBatch(
        d.phoneEngine.device,
        { ...bad, changes: [...bad.changes, broken] },
        {},
      ),
    ).toThrow();
    expect(JSON.stringify(d.rows('pc', 'todo'))).toBe(before);
  });

  it('versions different: the PC refuses, the phone sends nothing and keeps its changes', async () => {
    d = await devices();
    d.first('merge');
    await d.onPhone('POST', `${TODO}/tasks`, { title: 'En attente' });
    const request = beginExchange(d.phoneEngine, d.pcEngine.device);
    const older = {
      ...request,
      versions: { ...request.versions, todo: request.versions.todo! - 1 },
    };
    expect(() => serveExchange(d.pcEngine, d.phoneEngine.device, older)).toThrow(VersionMismatch);
    expect(() => serveExchange(d.pcEngine, d.phoneEngine.device, older)).toThrow(
      /Mets à jour l’application|téléphone a une version plus ancienne/,
    );
    const newer = { ...request, versions: { ...request.versions, courses: 99 } };
    expect(() => serveExchange(d.pcEngine, d.phoneEngine.device, newer)).toThrow(
      /Mets à jour ToolBox sur le PC/,
    );
    // Nothing reached the PC; the phone's change is still to send.
    expect(live(d.rows('pc', 'todo').tasks!)).toHaveLength(0);
    expect(beginExchange(d.phoneEngine, d.pcEngine.device).batch.changes.length).toBe(
      request.batch.changes.length,
    );
    d.exchange();
    expect(live(d.rows('pc', 'todo').tasks!)).toHaveLength(1);
  });

  it('first synchronisation « Partir des données du PC »: the phone = the PC', async () => {
    d = await devices();
    // Test data on the phone, real data on the PC.
    await d.onPhone('POST', `${COURSES}/ingredients`, { name: 'Riz', unit: 'g' });
    await d.onPhone('POST', `${TODO}/tasks`, { title: 'Essai' });
    await d.onPc('POST', `${COURSES}/ingredients`, { name: 'Pâtes', unit: 'g' });
    await d.onPc('POST', `${TODO}/tasks`, { title: 'Vraie tâche' });
    await d.onPc('PUT', `${COURSES}/goals`, { proteinPerDay: 120 });
    await d.onPhone('PUT', `${COURSES}/goals`, { proteinPerDay: 90 });
    d.first('replace');
    same(d);
    expect(live(d.rows('phone', 'todo').tasks!).map((t) => t.title)).toEqual(['Vraie tâche']);
    expect(d.phone.settings.get('courses', 'goalProteinPerDay')).toBe(120);
    // Then the usual synchronisation, both ways.
    await d.onPhone('POST', `${TODO}/tasks`, { title: 'Après, du téléphone' });
    await d.onPc('POST', `${TODO}/tasks`, { title: 'Après, du PC' });
    d.exchange();
    same(d);
    expect(live(d.rows('pc', 'todo').tasks!)).toHaveLength(3);
  });

  it('first synchronisation « Fusionner »: everything of both, names listed, preview without writing', async () => {
    d = await devices();
    await d.onPhone('POST', `${COURSES}/ingredients`, { name: 'Riz', unit: 'g' });
    await d.onPhone('POST', `${TODO}/tasks`, { title: 'Du téléphone' });
    await d.onPc('POST', `${COURSES}/ingredients`, { name: 'Riz', unit: 'g' });
    await d.onPc('POST', `${TODO}/tasks`, { title: 'Du PC' });
    const before = JSON.stringify(d.rows('pc', 'todo'));
    const preview = d.pcEngine.preview(JSON.parse(JSON.stringify(d.phoneEngine.snapshot())));
    expect(JSON.stringify(d.rows('pc', 'todo'))).toBe(before);
    expect(preview.tables.find((t) => t.entity === 'tasks')).toMatchObject({
      onlyHere: 1,
      onlyThere: 1,
    });
    // « Riz » on both; and the default moments, created by each device at its first start.
    expect(preview.names).toContainEqual({ scope: 'courses', label: 'Ingrédient', name: 'Riz' });
    expect(preview.names.filter((n) => n.label === 'Moment')).toHaveLength(4);
    d.first('merge');
    same(d);
    expect(live(d.rows('pc', 'todo').tasks!)).toHaveLength(2);
    expect(
      d.pcEngine.conflicts().filter((c) => c.kind === 'name' && /Ingrédient/.test(c.label)),
    ).toHaveLength(1);
    d.exchange();
    same(d);
  });

  it('only the 5 modules’ tables travel: never the archives, legacy ids, nor another module', async () => {
    d = await devices();
    for (const m of ['todo', 'ideas', 'timer'])
      for (const t of d.pcEngine.tables(m))
        expect(t.endsWith('_v1') || t === 'legacy_ids').toBe(false);
    expect([...d.pcEngine.scopes()].sort()).toEqual([
      'core',
      'courses',
      'ideas',
      'sport',
      'timer',
      'todo',
    ]);
    const forged = (entity: string, scope = 'todo'): Batch => ({
      device: d.phoneEngine.device,
      upTo: {},
      changes: [
        {
          scope,
          id: 'forged',
          at: new Date().toISOString(),
          entity,
          entity_id: 'x',
          op: 'create',
          data: {},
          hlc: '000001762387200000.00000.x',
          origin: d.phoneEngine.device,
          seq: 1,
        },
      ],
    });
    for (const [entity, scope] of [
      ['legacy_ids', 'todo'],
      ['tasks_v1', 'todo'],
      ['changes', 'todo'],
      ['tracks', 'music-library'],
      ['settings', 'core'],
    ])
      expect(() => d.pcEngine.applyBatch(d.phoneEngine.device, forged(entity!, scope), {})).toThrow(
        SyncError,
      );
  });
});
