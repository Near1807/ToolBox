// Preparations (v0.27) on a real hub: the expansion read everywhere (list,
// facts, filters), « Extraire en préparation » and « Remplacer par ses
// ingrédients » that never change it, the warning before changing a used
// preparation, the refusal to delete it, the merge of an ingredient used in a
// preparation, the migration 5 (data intact).
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
import { filterMeals, NO_FILTER } from '../shared/meal-filter';
import type { ListDto, MealDto, StateDto, SummaryDto } from '../shared/types';

const API = '/api/modules/courses';
export const openHub = async () =>
  createTestHub({
    loadExamples: false,
    modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
  });

/** Everything computed from the ingredients of the recipes, for « strictly the same ». */
export async function computed(hub: TestHub) {
  const s = (await hub.request<StateDto>('GET', `${API}/state`)).body;
  const summary = (await hub.request<SummaryDto>('GET', `${API}/summary`)).body;
  const sorted = (m: MealDto) => m.items.map((i) => `${i.ingredientId}|${i.qty}|${i.unit}`).sort();
  return {
    meals: s.meals.map((m) => ({ name: m.name, items: sorted(m), perServing: m.perServing })),
    list: s.list.groups,
    cost: s.list.cost,
    days: summary.days,
    total: summary.total,
    planned: summary.meals,
  };
}

describe('preparations', () => {
  let hub: TestHub;
  afterEach(async () => hub?.close());
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await hub.request<T>(method, `${API}${url}`, body);
    if (r.status >= 400)
      throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const state = () => call<StateDto>('GET', '/state');
  const items = (l: ListDto) =>
    l.groups.flatMap((g) => g.items.map((i) => `${i.name} | ${i.amount}`));

  async function bolognaise() {
    hub = await openHub();
    for (const [name, unit, kcal, protein] of [
      ['Viande hachée', 'g', 125, 21],
      ['Coulis', 'g', 32, 1.6],
      ['Oignon', 'pièce', 40, 1.1],
      ['Pâtes', 'g', 359, 12.5],
      ['Parmesan', 'g', 392, 33],
    ] as const)
      await call('POST', '/ingredients', {
        name,
        unit,
        pieceG: unit === 'pièce' ? 150 : null,
        nutrition: { kcal, protein },
        price: 10,
        pricePer: unit === 'pièce' ? 'pièce' : 'kg',
      });
    let s = await state();
    const id = (n: string) => s.ingredients.find((i) => i.name === n)!.id;
    await call('POST', '/meals', {
      name: 'Bolognaise',
      servings: 4,
      items: [
        { ingredientId: id('Viande hachée'), qty: 500, unit: 'g' },
        { ingredientId: id('Coulis'), qty: 700, unit: 'g' },
        { ingredientId: id('Oignon'), qty: 1.5, unit: 'pièce' },
        { ingredientId: id('Pâtes'), qty: 400, unit: 'g' },
        { ingredientId: id('Parmesan'), qty: 40, unit: 'g' },
      ],
    });
    s = await state();
    const meal = s.meals[0]!;
    await call('PUT', '/list', { from: '2026-11-02', to: '2026-11-08' });
    await call('POST', '/plan', {
      date: '2026-11-03',
      momentId: s.moments[3]!.id,
      mealId: meal.id,
      servings: 2,
    });
    return { s: await state(), id };
  }

  it('servings 4 with « Sauce × 4 », 2 portions planned: list and facts exact', async () => {
    const { s, id } = await bolognaise();
    const before = await computed(hub);
    const sauce = await call<{ id: string }>('POST', '/preps', {
      name: 'Sauce bolognaise',
      items: [
        { ingredientId: id('Viande hachée'), qty: 125, unit: 'g' },
        { ingredientId: id('Coulis'), qty: 175, unit: 'g' },
        { ingredientId: id('Oignon'), qty: 0.375, unit: 'pièce' },
      ],
    });
    await call('PUT', `/meals/${s.meals[0]!.id}`, {
      name: 'Bolognaise',
      servings: 4,
      items: [
        { kind: 'prep', prepId: sauce.id, qty: 4 },
        { ingredientId: id('Pâtes'), qty: 400, unit: 'g' },
        { ingredientId: id('Parmesan'), qty: 40, unit: 'g' },
      ],
    });
    const after = await state();
    expect(after.meals[0]!.split).toBe(true);
    expect(items(after.list)).toEqual([
      'Coulis | 350 g',
      'Oignon | 0,75 pièce (≈ 112,5 g)',
      'Parmesan | 20 g',
      'Pâtes | 200 g',
      'Viande hachée | 250 g',
    ]);
    expect(await computed(hub)).toEqual(before);
    expect(after.preps[0]).toMatchObject({
      name: 'Sauce bolognaise',
      usedBy: [{ name: 'Bolognaise' }],
      fridgeDays: null,
      freezable: false,
    });
    // A filter on an ingredient found only through the preparation.
    const names = new Map(after.ingredients.map((i) => [i.id, i.name]));
    expect(filterMeals(after.meals, names, { ...NO_FILTER, q: 'viande' })).toHaveLength(1);
  });

  it('« Extraire en préparation » (preview, then applied) and « Remplacer par ses ingrédients »: same expansion', async () => {
    const { s } = await bolognaise();
    const before = await computed(hub);
    const meal = s.meals[0]!;
    const taken = meal.lines.slice(0, 3).map((l) => l.id);
    const journal = () => {
      const db = new Database(path.join(hub.dataDir, 'hub.db'), { readonly: true });
      const n = (db.prepare('SELECT COUNT(*) AS n FROM courses__changes').get() as { n: number }).n;
      db.close();
      return n;
    };
    const n = journal();
    const preview = await call<{ preview: { portions: number; items: { qty: number }[] } }>(
      'POST',
      `/meals/${meal.id}/extract`,
      { lineIds: taken, name: 'Sauce bolognaise' },
    );
    expect(journal()).toBe(n); // a preview writes nothing
    expect(preview.preview.portions).toBe(4);
    expect(preview.preview.items.map((i) => i.qty)).toEqual([125, 175, 0.375]);
    await call('POST', `/meals/${meal.id}/extract`, {
      lineIds: taken,
      name: 'Sauce bolognaise',
      apply: true,
    });
    let after = await state();
    expect(after.meals[0]!.lines.map((l) => l.kind)).toEqual(['prep', 'ingredient', 'ingredient']);
    expect(await computed(hub)).toEqual(before);
    // An odd number of portions: still exact.
    await call('POST', `/meals/${meal.id}/inline`, { lineId: after.meals[0]!.lines[0]!.id });
    expect(await computed(hub)).toEqual(before);
    after = await state();
    expect(after.meals[0]!.split).toBe(false);
    // Same lines again into the existing preparation (same proportions): its portions found.
    const again = await call<{ preview: { existing: boolean; portions: number } }>(
      'POST',
      `/meals/${meal.id}/extract`,
      {
        lineIds: after.meals[0]!.lines.slice(0, 3).map((l) => l.id),
        prepId: after.preps[0]!.id,
        apply: true,
      },
    );
    expect(again.preview).toMatchObject({ existing: true, portions: 4 });
    expect(await computed(hub)).toEqual(before);
    // 3 portions: 500 / 3 is not a round number, the expansion is still exactly 500.
    await call('POST', `/meals/${meal.id}/inline`, {
      lineId: (await state()).meals[0]!.lines[0]!.id,
    });
    const lines = (await state()).meals[0]!.lines.slice(0, 3).map((l) => l.id);
    await call('POST', `/meals/${meal.id}/extract`, {
      lineIds: lines,
      name: 'Sauce en 3',
      portions: 3,
      apply: true,
    });
    expect(await computed(hub)).toEqual(before);
  });

  it('a used preparation: warning before a change of composition, deletion refused', async () => {
    const { s } = await bolognaise();
    const meal = s.meals[0]!;
    await call('POST', `/meals/${meal.id}/extract`, {
      lineIds: meal.lines.slice(0, 3).map((l) => l.id),
      name: 'Sauce bolognaise',
      apply: true,
    });
    const prep = (await state()).preps[0]!;
    const body = {
      name: prep.name,
      items: prep.items.map((i, k) => ({ ...i, qty: k === 0 ? 150 : i.qty })),
    };
    const refused = await hub.request<{ error: string }>('PUT', `${API}/preps/${prep.id}`, body);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain(
      'Utilisée par 1 recette : leurs apports et listes de courses vont changer (Bolognaise)',
    );
    expect((await state()).preps[0]!.items[0]!.qty).toBe(125); // nothing written
    // Keeping only: no warning (the facts do not change).
    await call('PUT', `/preps/${prep.id}`, {
      name: prep.name,
      fridgeDays: 3,
      freezable: true,
      freezerDays: 90,
    });
    await call('PUT', `/preps/${prep.id}`, { ...body, confirmed: true });
    expect((await state()).preps[0]).toMatchObject({ fridgeDays: 3, freezerDays: 90 });
    expect((await state()).preps[0]!.items[0]!.qty).toBe(150);
    const del = await hub.request('DELETE', `${API}/preps/${prep.id}`);
    expect(del.status).toBe(409);
    expect(JSON.stringify(del.body)).toContain('utilisée par Bolognaise');
    await call('POST', `/meals/${meal.id}/inline`, {
      lineId: (await state()).meals[0]!.lines[0]!.id,
    });
    await call('DELETE', `/preps/${prep.id}`);
    expect((await state()).preps).toEqual([]);
    await call('POST', `/preps/${prep.id}/restore`);
    expect((await state()).preps).toHaveLength(1);
    // A name already taken (accents, case and ligatures ignored).
    expect(
      (await hub.request('POST', `${API}/preps`, { name: 'SAUCE BOLOGNAISE', items: [] })).status,
    ).toBe(409);
  });

  it('an ingredient used only in a preparation counts as used and follows a merge', async () => {
    const { s, id } = await bolognaise();
    await call('POST', '/ingredients', { name: 'Riz', unit: 'g' });
    await call('POST', '/ingredients', { name: 'Riz rond', unit: 'g' });
    const st = await state();
    const riz = st.ingredients.find((i) => i.name === 'Riz')!.id;
    const rond = st.ingredients.find((i) => i.name === 'Riz rond')!.id;
    const prep = await call<{ id: string }>('POST', '/preps', {
      name: 'Riz cuit',
      items: [{ ingredientId: rond, qty: 80, unit: 'g' }],
    });
    await call('PUT', `/meals/${s.meals[0]!.id}`, {
      name: 'Bolognaise',
      servings: 4,
      items: [
        { kind: 'prep', prepId: prep.id, qty: 4 },
        { ingredientId: id('Pâtes'), qty: 400, unit: 'g' },
      ],
    });
    // Used through the preparation (the « Ingrédients » tab counts the expansion).
    expect((await state()).meals[0]!.items.some((i) => i.ingredientId === rond)).toBe(true);
    await call('POST', '/ingredients/merge', { from: rond, into: riz });
    const after = await state();
    expect(after.preps[0]!.items[0]!.ingredientId).toBe(riz);
    expect(items(after.list)).toContain('Riz | 160 g');
  });
});

describe('migration 5 (preparations)', () => {
  it('adds tables and columns only: existing rows unchanged, journal untouched', () => {
    const db = new Database(':memory:');
    const run = (from: number, to: number) => {
      for (const m of courses.migrations ?? []) {
        if (m.version < from || m.version > to) continue;
        db.transaction(() =>
          typeof m.up === 'string' ? db.exec(m.up) : m.up(migrationDatabaseFor(db, 'courses')),
        )();
      }
    };
    run(1, 4);
    const at = '2026-10-29T10:00:00.000Z';
    db.prepare(
      "INSERT INTO courses__meals (id, created_at, updated_at, name, servings, tags, note, fridge_days, freezable, freezer_days) VALUES ('m1', ?, ?, 'Curry', 4, '[]', '', 3, 1, 60)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO courses__meal_items (id, created_at, updated_at, meal_id, ingredient_id, qty, unit) VALUES ('i1', ?, ?, 'm1', 'riz', 300, 'g')",
    ).run(at, at);
    db.prepare(
      "INSERT INTO courses__batch_portions (id, created_at, updated_at, session_id, plan_entry_id, meal_id, date, moment_id, servings, frozen) VALUES ('b1', ?, ?, 's', 'p', 'm1', '2026-11-03', 'x', 2, 1)",
    ).run(at, at);
    const dump = () =>
      Object.fromEntries(
        ['meals', 'meal_items', 'batch_portions', 'plan'].map((t) => [
          t,
          db.prepare(`SELECT * FROM courses__${t}`).all(),
        ]),
      );
    const before = dump();
    const journal = db.prepare('SELECT COUNT(*) AS n FROM courses__changes').get();
    run(5, 5);
    const after = dump();
    expect(after.meals).toEqual(before.meals);
    expect(after.plan).toEqual(before.plan);
    expect(after.meal_items).toEqual(
      (before.meal_items as object[]).map((r) => ({ ...r, position: null })),
    );
    expect(after.batch_portions).toEqual(
      (before.batch_portions as object[]).map((r) => ({ ...r, prep_id: null, basis: null })),
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM courses__changes').get()).toEqual(journal);
    for (const t of ['preps', 'prep_items', 'meal_preps'])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM courses__${t}`).get()).toEqual({ n: 0 });
  });
});
