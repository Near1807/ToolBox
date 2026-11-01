// Keeping of a recipe (batch cooking, v0.26): migration 4 adds columns only,
// the fields stay empty until Thomas fills them in, a JSON file without them
// imports exactly as before, and the preview shows what a file would change.
import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestHub,
  loadModuleFolder,
  migrationDatabaseFor,
  type TestHub,
} from '@hub/sdk/testing';
import courses from '../backend';
import type { MealDto, StateDto } from '../shared/types';

const API = '/api/modules/courses';
const open = async () =>
  createTestHub({
    loadExamples: false,
    modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
  });

describe('migration 4 (batch cooking)', () => {
  it('adds columns only: existing recipes and plan unchanged, keeping empty', () => {
    const db = new Database(':memory:');
    const run = (from: number, to: number) => {
      for (const m of courses.migrations ?? []) {
        if (m.version < from || m.version > to) continue;
        db.transaction(() =>
          typeof m.up === 'string' ? db.exec(m.up) : m.up(migrationDatabaseFor(db, 'courses')),
        )();
      }
    };
    run(1, 3);
    const at = '2026-10-29T10:00:00.000Z';
    db.prepare(
      "INSERT INTO courses__meals (id, created_at, updated_at, name, servings, tags, note) VALUES ('m1', ?, ?, 'Curry', 4, '[\"batch\"]', 'épicé')",
    ).run(at, at);
    db.prepare(
      "INSERT INTO courses__plan (id, created_at, updated_at, date, moment_id, meal_id, servings) VALUES ('p1', ?, ?, '2026-11-02', 'x', 'm1', 2)",
    ).run(at, at);
    const before = {
      meals: db.prepare('SELECT * FROM courses__meals').all(),
      plan: db.prepare('SELECT * FROM courses__plan').all(),
      changes: db.prepare('SELECT COUNT(*) AS n FROM courses__changes').get(),
    };
    run(4, 4);
    expect(db.prepare('SELECT * FROM courses__meals').all()).toEqual(
      (before.meals as Record<string, unknown>[]).map((m) => ({
        ...m,
        fridge_days: null,
        freezable: 0,
        freezer_days: null,
      })),
    );
    expect(db.prepare('SELECT * FROM courses__plan').all()).toEqual(before.plan);
    expect(db.prepare('SELECT COUNT(*) AS n FROM courses__changes').get()).toEqual(before.changes);
    for (const t of ['batch_grids', 'batch_plans', 'batch_sessions', 'batch_portions'])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM courses__${t}`).get()).toEqual({ n: 0 });
  });
});

describe('keeping of a recipe', () => {
  let hub: TestHub;
  afterEach(async () => hub?.close());
  const meal = async (name: string) =>
    (await hub.request<StateDto>('GET', `${API}/state`)).body.meals.find(
      (m) => m.name === name,
    ) as MealDto;

  it('empty by default, edited in the recipe, freezer days only when freezable', async () => {
    hub = await open();
    await hub.request('POST', `${API}/meals`, { name: 'Curry', servings: 4, items: [] });
    expect(await meal('Curry')).toMatchObject({
      fridgeDays: null,
      freezable: false,
      freezerDays: null,
    });
    const id = (await meal('Curry')).id;
    await hub.request('PUT', `${API}/meals/${id}`, {
      name: 'Curry',
      servings: 4,
      items: [],
      fridgeDays: 3,
      freezable: true,
      freezerDays: 60,
    });
    expect(await meal('Curry')).toMatchObject({ fridgeDays: 3, freezable: true, freezerDays: 60 });
    await hub.request('PUT', `${API}/meals/${id}`, {
      name: 'Curry',
      servings: 4,
      items: [],
      freezable: false,
    });
    expect(await meal('Curry')).toMatchObject({
      fridgeDays: 3,
      freezable: false,
      freezerDays: null,
    });
    expect(
      (
        await hub.request('PUT', `${API}/meals/${id}`, {
          name: 'Curry',
          servings: 4,
          items: [],
          fridgeDays: 1.5,
        })
      ).status,
    ).toBe(400);
  });

  it('JSON: an old file (no keeping) imports as before and changes nothing; differences shown', async () => {
    hub = await open();
    await hub.request('POST', `${API}/meals`, {
      name: 'Curry',
      servings: 4,
      items: [],
      fridgeDays: 3,
      freezable: true,
      freezerDays: 60,
    });
    const old = {
      recipes: [
        { name: 'Curry', servings: 4, tags: [], note: '', ingredients: [] },
        { name: 'Dal', servings: 2, ingredients: [] },
      ],
    };
    const preview = (
      await hub.request<{ recipes: { name: string; status: string; changes: string[] }[] }>(
        'POST',
        `${API}/import/preview`,
        { text: JSON.stringify(old) },
      )
    ).body;
    expect(preview.recipes).toMatchObject([
      { name: 'Curry', status: 'same', changes: [] },
      { name: 'Dal', status: 'new' },
    ]);
    // Even replaced on purpose, an old file leaves the keeping as it is.
    await hub.request('POST', `${API}/import/apply`, {
      text: JSON.stringify(old),
      replaceRecipes: ['Curry'],
    });
    expect(await meal('Curry')).toMatchObject({ fridgeDays: 3, freezable: true, freezerDays: 60 });
    expect(await meal('Dal')).toMatchObject({
      fridgeDays: null,
      freezable: false,
      freezerDays: null,
    });

    const newer = {
      recipes: [
        {
          name: 'Curry',
          servings: 4,
          tags: [],
          note: '',
          ingredients: [],
          fridgeDays: 2,
          freezable: true,
          freezerDays: 90,
        },
      ],
    };
    const p2 = (
      await hub.request<{ recipes: { status: string; changes: string[] }[] }>(
        'POST',
        `${API}/import/preview`,
        { text: JSON.stringify(newer) },
      )
    ).body;
    expect(p2.recipes[0]).toEqual(
      expect.objectContaining({
        status: 'differs',
        changes: ['frigo 3 j → 2 j', 'congélateur 60 j → 90 j'],
      }),
    );
    // Not ticked: nothing changes.
    await hub.request('POST', `${API}/import/apply`, { text: JSON.stringify(newer) });
    expect((await meal('Curry')).fridgeDays).toBe(3);
    await hub.request('POST', `${API}/import/apply`, {
      text: JSON.stringify(newer),
      replaceRecipes: ['Curry'],
    });
    expect(await meal('Curry')).toMatchObject({ fridgeDays: 2, freezerDays: 90 });
    const bad = { recipes: [{ name: 'X', ingredients: [], fridgeDays: -1 }] };
    const p3 = (
      await hub.request<{ errors: { message: string }[] }>('POST', `${API}/import/preview`, {
        text: JSON.stringify(bad),
      })
    ).body;
    expect(p3.errors[0]!.message).toMatch(/fridgeDays/);
  });
});
