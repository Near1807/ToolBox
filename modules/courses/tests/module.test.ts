// Courses on a real hub: ingredients (no duplicates, merge), meals, the
// planning of a period, the list generated (added up, converted, scaled to
// the portions, by aisle), extras, ticks, the calendar source, the assistant.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { createTestHost, createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { EXAMPLE } from '../shared/exchange';
import { addDays, localToday, mondayOf, weekdayOf } from '../shared/dates';
import type { ListDto, PastListDto, StateDto, SummaryDto } from '../shared/types';

const API = '/api/modules/courses';
const open = async (saveTo: string | null = null) =>
  createTestHub({
    loadExamples: false,
    host: createTestHost({ selectSaveFile: () => Promise.resolve(saveTo) }),
    modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
  });

describe('courses', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
  });
  const state = async () => (await hub.request<StateDto>('GET', `${API}/state`)).body;
  const items = (l: ListDto) =>
    l.groups.flatMap((g) => g.items.map((i) => `${g.aisle} | ${i.name} | ${i.amount}`));

  async function setup() {
    hub = await open();
    const riz = (
      await hub.request<{ id: string }>('POST', `${API}/ingredients`, {
        name: 'Riz arborio',
        unit: 'g',
        aisle: 'Épicerie',
      })
    ).body;
    expect((await hub.request('POST', `${API}/ingredients`, { name: 'riz ARBORIO' })).status).toBe(
      409,
    );
    await hub.request('POST', `${API}/meals`, {
      name: 'Risotto',
      servings: 4,
      tags: ['VG'],
      items: [
        { ingredientId: riz.id, qty: 320, unit: 'g' },
        { name: 'Bouillon', qty: 1, unit: 'l' },
        { name: 'Parmesan', qty: 80, unit: 'g' },
      ],
    });
    await hub.request('POST', `${API}/meals`, {
      name: 'Porridge',
      servings: 1,
      items: [
        { name: 'Flocons d’avoine', qty: 60, unit: 'g' },
        { name: 'Lait', qty: 25, unit: 'cl' },
      ],
    });
    return state();
  }

  it('meals planned over a period give the list, added up, converted and scaled', async () => {
    const s = await setup();
    const risotto = s.meals.find((m) => m.name === 'Risotto')!;
    const porridge = s.meals.find((m) => m.name === 'Porridge')!;
    const soir = s.moments.find((m) => m.name === 'Soir')!;
    const matin = s.moments.find((m) => m.name === 'Matin')!;
    expect(s.moments.map((m) => m.name)).toEqual(['Matin', 'Midi', 'Collation', 'Soir']);
    const monday = mondayOf(localToday());
    await hub.request('PUT', `${API}/list`, { from: monday, to: addDays(monday, 6) });
    await hub.request('POST', `${API}/plan`, {
      date: monday,
      momentId: soir.id,
      mealId: risotto.id,
      servings: 2,
    });
    await hub.request('POST', `${API}/plan`, {
      date: addDays(monday, 2),
      momentId: soir.id,
      mealId: risotto.id,
      servings: 3,
    });
    for (let d = 0; d < 5; d++)
      await hub.request('POST', `${API}/plan`, {
        date: addDays(monday, d),
        momentId: matin.id,
        mealId: porridge.id,
        servings: 1,
      });
    // Out of the period: not in the list.
    await hub.request('POST', `${API}/plan`, {
      date: addDays(monday, 10),
      momentId: soir.id,
      mealId: risotto.id,
      servings: 4,
    });
    const list = (await state()).list;
    expect(list.mealsPlanned).toBe(7);
    expect(items(list)).toEqual([
      'Épicerie | Riz arborio | 400 g', // 320 × (2 + 3) / 4
      'Sans rayon | Bouillon | 1,25 l',
      'Sans rayon | Flocons d’avoine | 300 g',
      'Sans rayon | Lait | 1,25 l', // 25 cl × 5
      'Sans rayon | Parmesan | 100 g',
    ]);
  });

  it('merge two ingredients; extras (usual or by hand); ticks; text to copy', async () => {
    const s = await setup();
    const riz = s.ingredients.find((i) => i.name === 'Riz arborio')!;
    const other = (
      await hub.request<{ id: string }>('POST', `${API}/ingredients`, {
        name: 'Riz rond',
        unit: 'kg',
      })
    ).body;
    await hub.request('POST', `${API}/meals`, {
      name: 'Riz au lait',
      servings: 2,
      items: [{ ingredientId: other.id, qty: 0.2, unit: 'kg' }],
    });
    await hub.request('POST', `${API}/ingredients/merge`, { from: other.id, into: riz.id });
    const after = await state();
    expect(after.ingredients.some((i) => i.name === 'Riz rond')).toBe(false);
    expect(after.meals.find((m) => m.name === 'Riz au lait')!.items[0]!.ingredientId).toBe(riz.id);
    const midi = after.moments.find((m) => m.name === 'Midi')!;
    await hub.request('POST', `${API}/plan`, {
      date: after.list.from,
      momentId: midi.id,
      mealId: after.meals.find((m) => m.name === 'Riz au lait')!.id,
      servings: 2,
    });
    await hub.request('POST', `${API}/extras`, { name: 'Café', aisle: 'Épicerie' });
    expect((await hub.request('POST', `${API}/extras`, { name: 'café' })).status).toBe(409);
    await hub.request('POST', `${API}/list/extras`, { name: 'Café', aisle: 'Épicerie' });
    const list = (
      await hub.request<ListDto>('POST', `${API}/list/extras`, { name: 'Filtres', qty: '1 boîte' })
    ).body;
    expect(items(list)).toEqual([
      'Épicerie | Riz arborio | 200 g',
      'Épicerie | Café | ',
      'Sans rayon | Filtres | 1 boîte',
    ]);
    const ticked = (
      await hub.request<ListDto>('POST', `${API}/list/check`, {
        key: `ing:${riz.id}`,
        checked: true,
      })
    ).body;
    expect(ticked.groups[0]!.items[0]!.checked).toBe(true);
    const { text } = (await hub.request<{ text: string }>('GET', `${API}/list/text`)).body;
    expect(text).toContain('- [x] Riz arborio — 200 g');
    expect(text).toContain('## Épicerie');
  });

  it('calendar source and the assistant (reading free, changes behind their right)', async () => {
    const s = await setup();
    const soir = s.moments.find((m) => m.name === 'Soir')!;
    const today = localToday();
    await hub.request('POST', `${API}/plan`, {
      date: today,
      momentId: soir.id,
      mealId: s.meals.find((m) => m.name === 'Risotto')!.id,
      servings: 2,
    });
    const cal = await hub.request<{
      events: { title: string; start: string; durationMin: number; status: string }[];
    }>('GET', `/api/core/calendar?from=${today}&to=${today}`);
    expect(cal.body.events).toEqual([
      expect.objectContaining({
        title: 'Soir : Risotto',
        start: `${today}T19:30`,
        durationMin: 45,
        status: '2 portions',
      }),
    ]);
    expect(
      await hub.hub.assistant.run('courses.what-to-eat', { day: 'today', moment: 'soir' }),
    ).toMatchObject({
      message: 'Aujourd’hui soir : Risotto (2 portions).',
    });
    expect(hub.hub.assistant.rights().find((r) => r.id === 'courses.edit-meals')).toMatchObject({
      granted: false,
    });
    expect((await hub.hub.assistant.run('courses.add-extra', { name: 'café' })).status).toBe(
      'forbidden',
    );
    hub.hub.assistant.setRight('courses.edit-meals', true);
    expect(await hub.hub.assistant.run('courses.add-extra', { name: 'café' })).toMatchObject({
      status: 'done',
      message: '« café » ajouté aux courses.',
    });
    const tuesday = String(2);
    const planned = await hub.hub.assistant.run('courses.plan-meal', {
      meal: 'risoto',
      day: tuesday,
      moment: 'soir',
    });
    const expected = addDays(today, (2 - weekdayOf(today) + 7) % 7);
    expect(planned).toMatchObject({
      status: 'done',
      message: `Risotto planifié le ${expected} au soir.`,
    });
    if (planned.status === 'done' && planned.undoId) await hub.hub.assistant.undo(planned.undoId);
    expect(
      await hub.hub.assistant.run('courses.what-to-eat', { day: tuesday, moment: 'soir' }),
    ).toMatchObject({
      message: expect.stringMatching(expected === today ? /Risotto/ : /^Rien de prévu/),
    });
  });

  it('starts empty: no ingredient nor recipe shipped', async () => {
    hub = await open();
    const s = await state();
    expect(s.ingredients).toEqual([]);
    expect(s.meals).toEqual([]);
  });

  it('import: preview first (nothing written), then only what was confirmed; export gives the same file', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'courses-json-'));
    const out = path.join(dir, 'export.json');
    hub = await open(out);
    await hub.request('POST', `${API}/ingredients`, {
      name: 'Oignon',
      unit: 'pièce',
      aisle: 'Légumes',
    });
    const text = JSON.stringify(EXAMPLE, null, 2);
    const preview = (
      await hub.request<{
        ingredients: { name: string; status: string }[];
        toCreate: { name: string }[];
      }>('POST', `${API}/import/preview`, { text })
    ).body;
    expect(preview.ingredients.map((i) => `${i.name} ${i.status}`)).toEqual([
      'Riz arborio new',
      'Oignon differs',
      'Bouillon de légumes new',
    ]);
    expect(preview.toCreate.map((c) => c.name)).toEqual(['Parmesan']);
    expect((await state()).ingredients).toHaveLength(1); // the preview wrote nothing
    // Not confirmed: Oignon stays as it is, Parmesan is not created, so the recipe waits.
    const first = (
      await hub.request<{ ingredientsAdded: number; recipesSkipped: string[]; backup: string }>(
        'POST',
        `${API}/import/apply`,
        { text },
      )
    ).body;
    expect(first).toMatchObject({ ingredientsAdded: 2, recipesSkipped: ['Risotto'] });
    expect(first.backup).toBeTruthy();
    expect((await state()).ingredients.find((i) => i.name === 'Oignon')).toMatchObject({
      aisle: 'Légumes',
      pieceG: null,
    });
    // Confirmed this time.
    const second = (
      await hub.request('POST', `${API}/import/apply`, {
        text,
        overwrite: ['Oignon'],
        create: ['Parmesan'],
      })
    ).body;
    expect(second).toMatchObject({ ingredientsUpdated: 1, ingredientsCreated: 1, recipesAdded: 1 });
    const s = await state();
    expect(s.ingredients.find((i) => i.name === 'Oignon')).toMatchObject({
      aisle: 'Fruits et légumes',
      pieceG: 150,
      price: 0.3,
      pricePer: 'pièce',
    });
    const risotto = s.meals.find((m) => m.name === 'Risotto')!;
    // Per portion: 80 g of rice, 1/4 onion, 25 cl of stock, 20 g of parmesan (no data).
    expect(risotto.perServing.cost.euros).toBe(Math.round((0.256 + 0.075) * 100) / 100);
    expect(risotto.perServing.cost.missing).toEqual(['Bouillon de légumes', 'Parmesan']);
    expect(risotto.perServing.nutrition.missing).toContain('Parmesan');
    // Export, then import into an empty ToolBox: the same file again.
    await hub.request('POST', `${API}/export-json`);
    const exported = JSON.parse(readFileSync(out, 'utf8')) as typeof EXAMPLE;
    await hub.close();
    const out2 = path.join(dir, 'export2.json');
    hub = await open(out2);
    await hub.request('POST', `${API}/import/apply`, {
      text: JSON.stringify(exported),
      create: [],
    });
    await hub.request('POST', `${API}/export-json`);
    expect(JSON.parse(readFileSync(out2, 'utf8'))).toEqual(exported);
    expect(exported.ingredients.find((i) => i.name === 'Riz arborio')).toEqual(
      EXAMPLE.ingredients[0],
    );
  });

  it('a list per period: new period = clean list; the old one in the history, reusable', async () => {
    const s = await setup();
    const riz = s.ingredients.find((i) => i.name === 'Riz arborio')!;
    const monday = mondayOf(localToday());
    await hub.request('PUT', `${API}/list`, { from: monday, to: addDays(monday, 6) });
    await hub.request('POST', `${API}/plan`, {
      date: monday,
      momentId: s.moments[3]!.id,
      mealId: s.meals.find((m) => m.name === 'Risotto')!.id,
      servings: 2,
    });
    await hub.request('POST', `${API}/plan`, {
      date: addDays(monday, 7),
      momentId: s.moments[3]!.id,
      mealId: s.meals.find((m) => m.name === 'Risotto')!.id,
      servings: 2,
    });
    await hub.request('POST', `${API}/list/check`, { key: `ing:${riz.id}`, checked: true });
    await hub.request('POST', `${API}/list/extras`, { name: 'Café' });
    // Next week: the same rice, not ticked.
    const next = (
      await hub.request<ListDto>('PUT', `${API}/list`, {
        from: addDays(monday, 7),
        to: addDays(monday, 13),
      })
    ).body;
    const rice = next.groups.flatMap((g) => g.items).find((i) => i.name === 'Riz arborio')!;
    expect(rice.checked).toBe(false);
    expect(next.groups.flatMap((g) => g.items).some((i) => i.name === 'Café')).toBe(false);
    const history = (await hub.request<{ lists: PastListDto[] }>('GET', `${API}/lists/history`))
      .body.lists;
    expect(history).toHaveLength(1);
    expect(
      history[0]!.groups.flatMap((g) => g.items).find((i) => i.name === 'Riz arborio')!.checked,
    ).toBe(true);
    // Reused as a base: its articles not already in the list come as extras.
    const reused = (
      await hub.request<{ added: number; list: ListDto }>(
        'POST',
        `${API}/lists/${history[0]!.id}/reuse`,
      )
    ).body;
    expect(reused.added).toBe(1); // Café: the risotto's ingredients are already in this week's list
    // Back to the first week: its list as it was.
    const back = (
      await hub.request<ListDto>('PUT', `${API}/list`, { from: monday, to: addDays(monday, 6) })
    ).body;
    expect(back.groups.flatMap((g) => g.items).find((i) => i.name === 'Riz arborio')!.checked).toBe(
      true,
    );
  });

  it('summary of the period: days, totals, averages, protein ranking, goals', async () => {
    hub = await open();
    const riz = (
      await hub.request<{ id: string }>('POST', `${API}/ingredients`, {
        name: 'Riz',
        unit: 'g',
        nutrition: { kcal: 350, protein: 7 },
        price: 3,
        pricePer: 'kg',
      })
    ).body;
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
      name: 'Riz',
      servings: 1,
      items: [{ ingredientId: riz.id, qty: 100, unit: 'g' }],
    });
    await hub.request('POST', `${API}/meals`, {
      name: 'Omelette',
      servings: 1,
      items: [{ ingredientId: oeuf.id, qty: 3, unit: 'pièce' }],
    });
    const s = await state();
    const monday = mondayOf(localToday());
    await hub.request('PUT', `${API}/list`, { from: monday, to: addDays(monday, 6) });
    const meal = (n: string) => s.meals.find((m) => m.name === n)!.id;
    await hub.request('POST', `${API}/plan`, {
      date: monday,
      momentId: s.moments[1]!.id,
      mealId: meal('Riz'),
      servings: 1,
    });
    await hub.request('POST', `${API}/plan`, {
      date: monday,
      momentId: s.moments[3]!.id,
      mealId: meal('Omelette'),
      servings: 1,
    });
    await hub.request('POST', `${API}/plan`, {
      date: addDays(monday, 1),
      momentId: s.moments[3]!.id,
      mealId: meal('Omelette'),
      servings: 2,
    });
    await hub.request('PUT', `${API}/goals`, { proteinPerDay: 30, budgetPerWeek: 20 });
    const sum = (await hub.request<SummaryDto>('GET', `${API}/summary`)).body;
    expect(sum.days).toHaveLength(7);
    expect(sum.days[0]!.nutrition.values.protein).toBe(7 + 22.5);
    expect(sum.days[1]!.nutrition.values.protein).toBe(45);
    expect(sum.days[0]!.cost.euros).toBe(1.35);
    expect(sum.total.cost.euros).toBe(3.45);
    expect(sum.average.days).toBe(2);
    expect(sum.average.nutrition.protein).toBe(Math.round(((29.5 + 45) / 2) * 10) / 10);
    expect(sum.meals.map((m) => m.name)).toEqual(['Omelette', 'Riz']);
    expect(sum.goals).toEqual({ proteinPerDay: 30, kcalPerDay: 0, budgetPerWeek: 20 });
  });
});
