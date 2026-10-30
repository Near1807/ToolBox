// Courses, the rest of the logic on a real hub: migration 3 (nutrition and
// prices row by row), values written one by one, extras with a price in the
// cost of the list, the assistant reading nutrition and cost, recipe images
// (added, replaced to the Recycle Bin, removed, exported and imported).
import Database from 'better-sqlite3';
import { createCanvas } from '@napi-rs/canvas';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHost, createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import courses from '../backend';
import { addDays, localToday, mondayOf } from '../shared/dates';
import type { ListDto, MealDto, StateDto } from '../shared/types';

const API = '/api/modules/courses';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'courses-solid-'));
const trashed: string[] = [];
let saveTo: string | null = null;
const open = async () =>
  createTestHub({
    loadExamples: false,
    host: createTestHost({
      selectSaveFile: () => Promise.resolve(saveTo),
      trashItem: async (p) => {
        trashed.push(p);
      },
    }),
    modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
  });
const png = (w: number, h: number, file: string) => {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#c4602f';
  g.fillRect(0, 0, w, h);
  writeFileSync(file, c.toBuffer('image/png'));
  return file;
};

describe('courses migration 3', () => {
  it('nutrition JSON and price columns become rows, nothing lost', () => {
    const db = new Database(':memory:');
    const run = (upTo: number, from = 1) => {
      for (const m of courses.migrations ?? []) {
        if (m.version > upTo || m.version < from) continue;
        const shim = {
          exec: (s: string) => db.exec(s),
          prepare: (s: string) => db.prepare(s),
          table: (n: string) => `courses__${n}`,
        };
        db.transaction(() => (typeof m.up === 'string' ? db.exec(m.up) : m.up(shim as never)))();
      }
    };
    run(2);
    const at = '2026-10-29T10:00:00.000Z';
    db.prepare(
      "INSERT INTO courses__ingredients (id, created_at, updated_at, name, unit, nutrition, price, price_per) VALUES ('i1', ?, ?, 'Riz', 'g', '{\"kcal\":350,\"protein\":7}', 3.2, 'kg'), ('i2', ?, ?, 'Sel', 'pincée', '{}', NULL, ''), ('i3', ?, ?, 'Abîmé', 'g', 'xx', 1, 'boîte')",
    ).run(at, at, at, at, at, at);
    run(3, 3);
    expect(
      db
        .prepare(
          'SELECT ingredient_id, nutrient, value FROM courses__ingredient_nutrients ORDER BY nutrient',
        )
        .all(),
    ).toEqual([
      { ingredient_id: 'i1', nutrient: 'kcal', value: 350 },
      { ingredient_id: 'i1', nutrient: 'protein', value: 7 },
    ]);
    expect(
      db.prepare('SELECT ingredient_id, amount, per FROM courses__ingredient_prices').all(),
    ).toEqual([{ ingredient_id: 'i1', amount: 3.2, per: 'kg' }]);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM courses__changes WHERE op = 'create'").get() as {
          n: number;
        }
      ).n,
    ).toBe(3);
  });
});

describe('courses (solidified)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    saveTo = null;
  });
  const state = async () => (await hub.request<StateDto>('GET', `${API}/state`)).body;
  const journal = (entity: string) => {
    const db = new Database(path.join(hub.dataDir, 'hub.db'), { readonly: true });
    const rows = db
      .prepare('SELECT op, data FROM courses__changes WHERE entity = ? ORDER BY at')
      .all(entity) as { op: string; data: string | null }[];
    db.close();
    return rows;
  };

  it('nutrition and price written value by value', async () => {
    hub = await open();
    const riz = (
      await hub.request<{ id: string }>('POST', `${API}/ingredients`, {
        name: 'Riz',
        unit: 'g',
        nutrition: { kcal: 350, protein: 7 },
        price: 3.2,
        pricePer: 'kg',
      })
    ).body;
    expect(journal('ingredient_nutrients').map((j) => j.op)).toEqual(['create', 'create']);
    await hub.request('PATCH', `${API}/ingredients/${riz.id}`, {
      nutrition: { kcal: 350, protein: 7.5, fiber: 1.5 },
    });
    expect(journal('ingredient_nutrients').slice(2)).toEqual([
      { op: 'update', data: JSON.stringify({ value: 7.5 }) },
      { op: 'create', data: expect.stringContaining('"nutrient":"fiber"') },
    ]);
    // Price alone, then its unit alone; then removed.
    await hub.request('PATCH', `${API}/ingredients/${riz.id}`, { price: 2.9 });
    await hub.request('PATCH', `${API}/ingredients/${riz.id}`, { pricePer: 'pièce' });
    expect((await state()).ingredients[0]).toMatchObject({
      price: 2.9,
      pricePer: 'pièce',
      nutrition: { kcal: 350, protein: 7.5, fiber: 1.5 },
    });
    await hub.request('PATCH', `${API}/ingredients/${riz.id}`, { price: '' });
    expect((await state()).ingredients[0]).toMatchObject({ price: null, pricePer: null });
    expect(journal('ingredient_prices').map((j) => j.op)).toEqual([
      'create',
      'update',
      'update',
      'delete',
    ]);
  });

  it('extras with a price count in the list; the usual price is copied; one without is named', async () => {
    hub = await open();
    const riz = (
      await hub.request<{ id: string }>('POST', `${API}/ingredients`, {
        name: 'Riz',
        unit: 'g',
        price: 3,
        pricePer: 'kg',
      })
    ).body;
    await hub.request('POST', `${API}/meals`, {
      name: 'Riz',
      servings: 1,
      items: [{ ingredientId: riz.id, qty: 100, unit: 'g' }],
    });
    const s = await state();
    await hub.request('PUT', `${API}/list`, {
      from: mondayOf(localToday()),
      to: addDays(mondayOf(localToday()), 6),
    });
    await hub.request('POST', `${API}/plan`, {
      date: mondayOf(localToday()),
      momentId: s.moments[1]!.id,
      mealId: s.meals[0]!.id,
      servings: 2,
    });
    await hub.request('POST', `${API}/extras`, { name: 'Café', aisle: 'Épicerie', price: '4,50' });
    await hub.request('POST', `${API}/list/extras`, { name: 'café' });
    let list = (
      await hub.request<ListDto>('POST', `${API}/list/extras`, { name: 'Filtres', qty: '1 boîte' })
    ).body;
    const items = list.groups.flatMap((g) => g.items);
    expect(items.find((i) => i.name === 'café')).toMatchObject({ price: 4.5, aisle: 'Épicerie' });
    expect(list.mealsCost.euros).toBe(0.6);
    expect(list.extrasCost).toEqual({ euros: 4.5, missing: ['Filtres'] });
    expect(list.cost).toEqual({ euros: 5.1, missing: ['Filtres'] });
    const filtres = items.find((i) => i.name === 'Filtres')!;
    list = (await hub.request<ListDto>('PATCH', `${API}/list/extras/${filtres.id}`, { price: 2 }))
      .body;
    expect(list.cost).toEqual({ euros: 7.1, missing: [] });
    expect(
      (await hub.request('PATCH', `${API}/list/extras/${filtres.id}`, { price: -1 })).status,
    ).toBe(400);
    const cafe = (await state()).list.habitual[0]!;
    list = (await hub.request<ListDto>('PATCH', `${API}/extras/${cafe.id}`, { price: 5 })).body;
    expect(list.habitual[0]!.price).toBe(5);
    // The article already in the list keeps its price.
    expect(list.groups.flatMap((g) => g.items).find((i) => i.name === 'café')!.price).toBe(4.5);
    // The assistant reads the cost.
    expect(await hub.hub.assistant.run('courses.cost', { what: 'list' })).toMatchObject({
      status: 'done',
      message: 'Liste de courses : 7,10 € estimés, sur les quantités utilisées, pas les paquets.',
    });
  });

  it('assistant reads the nutrition of the week and of a day', async () => {
    hub = await open();
    const oeuf = (
      await hub.request<{ id: string }>('POST', `${API}/ingredients`, {
        name: 'Œuf',
        unit: 'pièce',
        pieceG: 60,
        nutrition: { kcal: 145, protein: 12.5 },
        price: 0.35,
        pricePer: 'pièce',
      })
    ).body;
    await hub.request('POST', `${API}/meals`, {
      name: 'Omelette',
      servings: 1,
      items: [{ ingredientId: oeuf.id, qty: 3, unit: 'pièce' }],
    });
    const s = await state();
    const today = localToday();
    await hub.request('PUT', `${API}/list`, { from: today, to: addDays(today, 6) });
    await hub.request('POST', `${API}/plan`, {
      date: today,
      momentId: s.moments[3]!.id,
      mealId: s.meals[0]!.id,
      servings: 2,
    });
    expect(
      await hub.hub.assistant.run('courses.nutrition', { nutrient: 'protein', day: 'week' }),
    ).toMatchObject({
      status: 'done',
      message: `Du ${today} au ${addDays(today, 6)} : 45 g de protéines au total, soit 45 g de protéines par jour en moyenne (incomplet : des ingrédients n’ont pas de valeurs).`,
    });
    expect(await hub.hub.assistant.run('courses.nutrition', { day: 'today' })).toMatchObject({
      message: `Le ${today} : 522 kcal de calories et 45 g de protéines (incomplet).`,
    });
    expect(await hub.hub.assistant.run('courses.cost', { what: 'week' })).toMatchObject({
      message: `Repas du ${today} au ${addDays(today, 6)} : 2,10 € estimés.`,
    });
  });

  it('recipe images: added, replaced (old one to the Recycle Bin), removed; export and import', async () => {
    hub = await open();
    trashed.length = 0;
    const meal = (
      await hub.request<{ id: string }>('POST', `${API}/meals`, {
        name: 'Risotto',
        servings: 4,
        items: [],
      })
    ).body;
    const big = png(2400, 1600, path.join(tmp, 'big.png'));
    const r = await hub.request<{ meal: MealDto }>('PUT', `${API}/meals/${meal.id}/image`, {
      path: big,
    });
    expect(r.status).toBe(200);
    expect(r.body.meal.image).toMatchObject({
      width: 1200,
      height: 800,
      url: expect.stringMatching(/^\/api\/media\//),
    });
    const dir = path.join(hub.dataDir, 'modules', 'courses', 'images');
    expect(readdirSync(dir)).toHaveLength(1);
    const first = readdirSync(dir)[0]!;
    expect(readFileSync(path.join(dir, first)).subarray(0, 3).toString('hex')).toBe('ffd8ff'); // JPEG
    // Not an image: refused, nothing changed.
    writeFileSync(path.join(tmp, 'fake.png'), 'pas une image');
    expect(
      (
        await hub.request('PUT', `${API}/meals/${meal.id}/image`, {
          path: path.join(tmp, 'fake.png'),
        })
      ).status,
    ).toBe(400);
    // Replaced: the old file to the Recycle Bin.
    const small = png(300, 200, path.join(tmp, 'small.png'));
    const data = `data:image/png;base64,${readFileSync(small).toString('base64')}`;
    const r2 = await hub.request<{ meal: MealDto }>('PUT', `${API}/meals/${meal.id}/image`, {
      data,
    });
    expect(r2.body.meal.image).toMatchObject({ width: 300, height: 200 });
    expect(trashed).toEqual([path.join(dir, first)]);
    // Export (complete, with the image) then import into an empty ToolBox.
    saveTo = path.join(tmp, 'export.json');
    await hub.request('POST', `${API}/export-json`);
    const exported = JSON.parse(readFileSync(saveTo, 'utf8')) as { recipes: { image: string }[] };
    expect(exported.recipes[0]!.image).toMatch(/^data:image\/jpeg;base64,/);
    // Removed: the file to the Recycle Bin too.
    await hub.request('DELETE', `${API}/meals/${meal.id}/image`);
    expect((await state()).meals[0]!.image).toBeNull();
    expect(trashed).toHaveLength(2);
    await hub.close();
    hub = await open();
    const bad = {
      ...exported,
      recipes: [
        ...exported.recipes,
        { name: 'Sans image', servings: 1, ingredients: [], image: 'data:text/plain;base64,AAAA' },
      ],
    };
    const preview = (
      await hub.request<{ warnings: { message: string }[] }>('POST', `${API}/import/preview`, {
        text: JSON.stringify(bad),
      })
    ).body;
    expect(preview.warnings).toHaveLength(1);
    const done = (
      await hub.request<{ recipesAdded: number; imagesAdded: number }>(
        'POST',
        `${API}/import/apply`,
        { text: JSON.stringify(bad) },
      )
    ).body;
    expect(done).toMatchObject({ recipesAdded: 2, imagesAdded: 1 });
    const meals = (await state()).meals;
    expect(meals.find((m) => m.name === 'Risotto')!.image).toMatchObject({
      width: 300,
      height: 200,
    });
    expect(meals.find((m) => m.name === 'Sans image')!.image).toBeNull();
    expect(existsSync(path.join(hub.dataDir, 'modules', 'courses', 'images'))).toBe(true);
  });
});
