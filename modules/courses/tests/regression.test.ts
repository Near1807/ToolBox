// Non-regression of the recipes' readers (v0.27, preparations): a realistic
// base built through the API, then everything the module computes from the
// ingredients of a recipe (meals per portion, list, cost, summary, history,
// text, batch, export, assistant). The reference (fixtures/regression.json)
// was written by the v0.26.0 code, before preparations existed: the same
// base must give exactly the same answers. Ids and dates are made relative
// (first appearance order, days from the Monday of the period).
//
// To rewrite the reference (only on purpose): TOOLBOX_WRITE_REFERENCE=1.
import path from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHost, createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { addDays, localToday, mondayOf } from '../shared/dates';
import type { StateDto } from '../shared/types';

const API = '/api/modules/courses';
const REFERENCE = path.join(__dirname, 'fixtures', 'regression.json');

/** A file like Thomas's: units of every kind, decimals, piece weights, gaps in the facts. */
export const REALISTIC = {
  format: 'toolbox-courses',
  version: 1,
  ingredients: [
    {
      name: 'Riz basmati',
      unit: 'g',
      aisle: 'Épicerie',
      nutrition: { kcal: 350, protein: 7.5, carbs: 78, fat: 0.9, fiber: 1.3, salt: 0 },
      price: { amount: 2.9, per: 'kg' },
    },
    {
      name: 'Œuf',
      unit: 'pièce',
      aisle: 'Frais',
      pieceWeightG: 60,
      nutrition: { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5, saturated: 3.1, salt: 0.36 },
      price: { amount: 0.32, per: 'pièce' },
    },
    {
      name: 'Viande hachée 5 %',
      unit: 'g',
      aisle: 'Boucherie',
      nutrition: { kcal: 125, protein: 21, fat: 5, saturated: 2.2, salt: 0.18 },
      price: { amount: 11.5, per: 'kg' },
    },
    {
      name: 'Coulis de tomate',
      unit: 'g',
      aisle: 'Épicerie',
      nutrition: { kcal: 32, protein: 1.6, carbs: 5.1, sugars: 4.2, fiber: 1.4, salt: 0.5 },
      price: { amount: 2.1, per: 'kg' },
    },
    {
      name: 'Oignon',
      unit: 'pièce',
      aisle: 'Fruits et légumes',
      pieceWeightG: 150,
      nutrition: { kcal: 40, protein: 1.1, carbs: 9.3, fiber: 1.7 },
      price: { amount: 0.3, per: 'pièce' },
    },
    {
      name: 'Pâtes',
      unit: 'g',
      aisle: 'Épicerie',
      nutrition: { kcal: 359, protein: 12.5, carbs: 71, fat: 1.5, fiber: 3, salt: 0.01 },
      price: { amount: 1.6, per: 'kg' },
    },
    { name: 'Parmesan', unit: 'g', aisle: 'Frais', nutrition: { kcal: 392, protein: 33 } },
    {
      name: 'Lait',
      unit: 'l',
      aisle: 'Frais',
      nutritionPer: '100ml',
      nutrition: { kcal: 46, protein: 3.3, carbs: 4.8, fat: 1.5 },
      price: { amount: 1.05, per: 'l' },
    },
    { name: 'Huile d’olive', unit: 'c. à s.', aisle: 'Épicerie' },
    {
      name: 'Pois chiches',
      unit: 'g',
      aisle: 'Épicerie',
      nutrition: { kcal: 139, protein: 7.2, carbs: 16, fiber: 6 },
      price: { amount: 3.4, per: 'kg' },
    },
    {
      name: 'Lait de coco',
      unit: 'ml',
      aisle: 'Épicerie',
      nutritionPer: '100ml',
      nutrition: { kcal: 180, fat: 18 },
      price: { amount: 6, per: 'l' },
    },
    { name: 'Épinards', unit: 'g', aisle: 'Surgelés', price: { amount: 2.5, per: 'kg' } },
    {
      name: 'Flocons d’avoine',
      unit: 'g',
      aisle: 'Épicerie',
      nutrition: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7, fiber: 10 },
      price: { amount: 2.2, per: 'kg' },
    },
    { name: 'Banane', unit: 'pièce', aisle: 'Fruits et légumes', pieceWeightG: 120 },
  ],
  recipes: [
    {
      name: 'Bolognaise',
      servings: 4,
      tags: ['batch', 'protéiné'],
      fridgeDays: 3,
      freezable: true,
      freezerDays: 90,
      ingredients: [
        { name: 'Viande hachée 5 %', qty: 500, unit: 'g' },
        { name: 'Coulis de tomate', qty: 0.7, unit: 'kg' },
        { name: 'Oignon', qty: 1.5, unit: 'pièce' },
        { name: 'Huile d’olive', qty: 1, unit: 'c. à s.' },
        { name: 'Pâtes', qty: 400, unit: 'g' },
        { name: 'Parmesan', qty: 40, unit: 'g' },
      ],
    },
    {
      name: 'Curry de pois chiches',
      servings: 3,
      tags: ['VG', 'batch'],
      fridgeDays: 4,
      freezable: true,
      freezerDays: 60,
      ingredients: [
        { name: 'Pois chiches', qty: 530, unit: 'g' },
        { name: 'Lait de coco', qty: 40, unit: 'cl' },
        { name: 'Épinards', qty: 250, unit: 'g' },
        { name: 'Oignon', qty: 1, unit: 'pièce' },
        { name: 'Riz basmati', qty: 225, unit: 'g' },
      ],
    },
    {
      name: 'Boîte riz-œufs',
      servings: 1,
      tags: ['protéiné'],
      fridgeDays: 3,
      freezable: false,
      ingredients: [
        { name: 'Riz basmati', qty: 80, unit: 'g' },
        { name: 'Œuf', qty: 3, unit: 'pièce' },
        { name: 'Œuf', qty: 60, unit: 'g' },
      ],
    },
    {
      name: 'Porridge',
      servings: 1,
      ingredients: [
        { name: 'Flocons d’avoine', qty: 60, unit: 'g' },
        { name: 'Lait', qty: 25, unit: 'cl' },
        { name: 'Banane', qty: 0.5, unit: 'pièce' },
      ],
    },
    {
      name: 'Omelette',
      servings: 2,
      note: 'Sans conservation renseignée.',
      ingredients: [
        { name: 'Œuf', qty: 5, unit: 'pièce' },
        { name: 'Lait', qty: 3, unit: 'c. à s.' },
        { name: 'Parmesan', qty: 30, unit: 'g' },
      ],
    },
  ],
};

let ids = new Map<string, string>();
/** Same shape whatever the day and the random ids. */
function relative(value: unknown, monday: string): unknown {
  ids = new Map();
  const days = (date: string) =>
    `D${Math.round((Date.parse(date) - Date.parse(monday)) / 86_400_000)}`;
  const text = JSON.stringify(value)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
      if (!ids.has(id)) ids.set(id, `#${ids.size + 1}`);
      return ids.get(id)!;
    })
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, 'TIME')
    .replace(/\d{4}-\d{2}-\d{2}/g, days)
    .replace(/[?&](?:sig|token|t|exp)=[^"&]+/g, '');
  return JSON.parse(text);
}

type Snapshot = Record<string, unknown> & { thaw: unknown[] };
/**
 * The answers in the v0.26 shape: only what v0.27 and v0.28 ADDED is left out
 * (the parts of a planned meal, the preparation of a cooking, « Utilisée
 * dans », what and which preparation for a meal to cook on the day or left
 * out). Everything else must be strictly the same.
 */
function asV026(value: unknown): Snapshot {
  const walk = (v: unknown, key = ''): unknown => {
    if (Array.isArray(v)) {
      if (key === 'missing')
        return v.map((m) => (typeof m === 'object' && m ? (m as { entryId: string }).entryId : m));
      return v.map((x) => walk(x, `${key}[]`));
    }
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'parts' || k === 'prepId' || k === 'usedIn') continue;
      // v0.28: what « Pourrait aussi servir » needs, the recipe of each use, meals before the period.
      if (k === 'basis' || k === 'suggestions' || k === 'facts') continue;
      // v0.29: the two times (double doses, elements of the last plan, cooking moments, bases).
      if (['doubles', 'lastElements', 'cookMoments', 'bases'].includes(k)) continue;
      // v0.29: the ingredients of a cooking in the recipe's order (v0.26: by name).
      if (
        k === 'ingredients' &&
        key !== 'exported' &&
        Array.isArray(x) &&
        x.every((i) => i && typeof i === 'object' && 'amount' in i)
      ) {
        out[k] = [...(x as { name: string }[])].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        continue;
      }
      if (key === 'entries[]' && k === 'beforePeriod') continue;
      if ((key === 'fridge[]' || key === 'frozen[]') && k === 'mealName') continue;
      if (key === 'uncovered[]' && k === 'name') continue;
      out[k] = walk(x, k);
    }
    return out;
  };
  return walk(value) as Snapshot;
}
/**
 * The thaw reminder changed format on purpose (v0.27: one line per day, what
 * to take out, no detail per meal): the v0.26 reference grouped the same way.
 */
function withThawByDay(reference: Snapshot): Snapshot {
  const days = new Map<string, Set<string>>();
  for (const t of reference.thaw as { date: string; mealName: string }[])
    days.set(t.date, (days.get(t.date) ?? new Set()).add(t.mealName));
  return {
    ...reference,
    thaw: [...days].map(([date, names]) => ({ date, names: [...names].sort() })),
  };
}

describe('non-regression of the readers of a recipe (reference: v0.26.0)', () => {
  let hub: TestHub;
  afterEach(async () => hub?.close());

  it('same meals, list, costs, summary, history, text, batch, export and assistant', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'courses-reg-'));
    let saveTo = '';
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({ selectSaveFile: () => Promise.resolve(saveTo) }),
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    const call = async <T>(method: string, url: string, body?: unknown) => {
      const r = await hub.request<T>(method, `${API}${url}`, body);
      expect(r.status, `${method} ${url}`).toBeLessThan(400);
      return r.body;
    };
    const text = JSON.stringify(REALISTIC);
    await call('POST', '/import/apply', { text, create: [] });
    const monday = mondayOf(localToday());
    const from = monday;
    const to = addDays(monday, 6);
    await call('PUT', '/list', { from, to });
    await call('PUT', '/goals', { proteinPerDay: 120, kcalPerDay: 2200, budgetPerWeek: 60 });
    let s = await call<StateDto>('GET', '/state');
    const meal = (name: string) => s.meals.find((m) => m.name === name)!.id;
    const moment = (name: string) => s.moments.find((m) => m.name === name)!.id;
    const plan: [number, string, string, number][] = [
      [0, 'Soir', 'Bolognaise', 2],
      [1, 'Midi', 'Bolognaise', 1.5],
      [1, 'Soir', 'Curry de pois chiches', 2],
      [2, 'Midi', 'Boîte riz-œufs', 1],
      [3, 'Midi', 'Boîte riz-œufs', 1],
      [3, 'Soir', 'Curry de pois chiches', 1],
      [4, 'Soir', 'Bolognaise', 4],
      [5, 'Midi', 'Omelette', 2],
      [6, 'Soir', 'Curry de pois chiches', 3],
      ...[0, 1, 2, 3, 4].map((d): [number, string, string, number] => [d, 'Matin', 'Porridge', 1]),
    ];
    for (const [d, m, name, servings] of plan)
      await call('POST', '/plan', {
        date: addDays(monday, d),
        momentId: moment(m),
        mealId: meal(name),
        servings,
      });
    s = await call<StateDto>('GET', '/state');
    // A list with ticks and extras, closed by a change of period, then reopened.
    const riz = s.list.groups.flatMap((g) => g.items).find((i) => i.name === 'Riz basmati')!;
    await call('POST', '/list/check', { key: riz.key, checked: true });
    await call('POST', '/list/extras', { name: 'Café', qty: '1 paquet', price: 4.2 });
    await call('PUT', '/list', { from: addDays(monday, 7), to: addDays(monday, 13) });
    await call('POST', '/plan', {
      date: addDays(monday, 8),
      momentId: moment('Midi'),
      mealId: meal('Bolognaise'),
      servings: 3,
    });
    await call('POST', '/list/check', {
      key: (await call<StateDto>('GET', '/state')).list.groups[0]!.items[0]!.key,
      checked: true,
    });
    await call('PUT', '/list', { from, to });

    // Batch: the cooking slots of the period, a proposal, a validated plan.
    const slots = [0, 2, 4].map((d) => ({ date: addDays(monday, d), momentId: moment('Midi') }));
    await call('PUT', '/batch/grid', { from, to, slots });
    const batch = await call<{ entries: { entryId: string; mealName: string }[] }>(
      'GET',
      `/batch?from=${from}&to=${to}`,
    );
    const entryIds = batch.entries.filter((e) => e.mealName !== 'Porridge').map((e) => e.entryId);
    const form = { from, to, slots, entryIds, daysBefore: 0 };
    const proposals = {
      fridge: await call('POST', '/batch/compute', { ...form, freezer: false }),
      freezer: await call('POST', '/batch/compute', { ...form, freezer: true }),
    };
    const curryOnly = batch.entries
      .filter((e) => e.mealName.startsWith('Curry'))
      .map((e) => e.entryId);
    await call('POST', '/batch/plans', { ...form, entryIds: curryOnly, freezer: true });

    saveTo = path.join(out, 'export.json');
    await call('POST', '/export-json');
    const exported = JSON.parse(readFileSync(saveTo, 'utf8')) as unknown;
    const state = await call<StateDto>('GET', '/state');
    const assistant = {
      listCost: await hub.hub.assistant.run('courses.cost', { what: 'list' }),
      weekCost: await hub.hub.assistant.run('courses.cost', { what: 'week' }),
      weekProtein: await hub.hub.assistant.run('courses.nutrition', {
        nutrient: 'protein',
        day: 'week',
      }),
      shopping: await hub.hub.assistant.run('courses.shopping-list', {}),
    };
    const snapshot = relative(
      {
        // Fields added by v0.27 (nothing else may differ): the raw lines, the split flag, the
        // keeping as the batch sees it, the origin of an expanded line.
        meals: state.meals.map((m) => ({
          ...m,
          lines: undefined,
          split: undefined,
          keeping: undefined,
          items: m.items.map((i) => ({ ...i, fromLine: undefined })),
        })),
        list: state.list,
        plan: state.plan,
        thaw: state.thaw,
        summary: await call('GET', '/summary'),
        history: await call('GET', '/lists/history'),
        text: await call('GET', '/list/text'),
        home: await call('GET', '/home'),
        batch: await call('GET', `/batch?from=${from}&to=${to}`),
        proposals,
        exported,
        assistant,
      },
      monday,
    );
    if (process.env.TOOLBOX_WRITE_REFERENCE === '1')
      writeFileSync(REFERENCE, `${JSON.stringify(snapshot, null, 2)}\n`);
    // The home card lists today's meals: it depends on the day the test runs (the reference
    // was written on a Sunday), so it is checked apart, against the planning of today.
    const { home, ...rest } = asV026(snapshot) as Snapshot & {
      home: { today: string; meals: { name: string }[] };
    };
    const { home: _home, ...reference } = withThawByDay(
      JSON.parse(readFileSync(REFERENCE, 'utf8')) as Snapshot,
    );
    void _home;
    expect(rest).toEqual(reference);
    const todayPlan = (state.plan as { date: string; mealId: string }[]).filter(
      (p) => p.date === localToday(),
    );
    expect(home.meals.map((m) => m.name).sort()).toEqual(
      todayPlan.map((p) => state.meals.find((m) => m.id === p.mealId)!.name).sort(),
    );
  });
});
