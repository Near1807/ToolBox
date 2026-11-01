// Batch cooking by preparation (v0.27): the unit is the couple (preparation,
// meal); the direct lines of a split recipe are cooked at meal time and never
// appear; a preparation shared by two recipes is cooked once; its own keeping
// decides fridge and freezer; plans say when a covered recipe changed.
import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TestHub } from '@hub/sdk/testing';
import { planBatch, SEARCH_LIMIT, type BatchMeal } from '../shared/batch';
import type { BatchPlanDto, BatchProposalDto, BatchStateDto, StateDto } from '../shared/types';
import { openHub } from './preps.test';

const API = '/api/modules/courses';
const FROM = '2026-11-02';
const TO = '2026-11-08';

describe('batch cooking by preparation', () => {
  let hub: TestHub;
  afterEach(async () => hub?.close());
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await hub.request<T>(method, `${API}${url}`, body);
    if (r.status >= 400)
      throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const state = () => call<StateDto>('GET', '/state');

  /** Sauce (fridge 2, freezer 90), rice (fridge 3, not freezable), eggs (fridge 5); three recipes. */
  async function setup() {
    hub = await openHub();
    const ing = async (name: string, unit = 'g') =>
      (await call<{ id: string }>('POST', '/ingredients', { name, unit })).id;
    const viande = await ing('Viande hachée');
    const coulis = await ing('Coulis');
    const pates = await ing('Pâtes');
    const riz = await ing('Riz');
    const oeuf = await ing('Œuf', 'pièce');
    const haricots = await ing('Haricots rouges');
    const prep = async (name: string, items: unknown[], keep: object) =>
      (await call<{ id: string }>('POST', '/preps', { name, items, ...keep })).id;
    const sauce = await prep(
      'Sauce bolognaise',
      [
        { ingredientId: viande, qty: 100, unit: 'g' },
        { ingredientId: coulis, qty: 150, unit: 'g' },
      ],
      { fridgeDays: 2, freezable: true, freezerDays: 90 },
    );
    const rizCuit = await prep('Riz cuit', [{ ingredientId: riz, qty: 100, unit: 'g' }], {
      fridgeDays: 3,
      freezable: false,
    });
    const oeufs = await prep(
      'Œufs durs en coquille',
      [{ ingredientId: oeuf, qty: 3, unit: 'pièce' }],
      {
        fridgeDays: 5,
        freezable: false,
      },
    );
    const meal = async (name: string, servings: number, items: unknown[]) =>
      (await call<{ id: string }>('POST', '/meals', { name, servings, items })).id;
    const bolo = await meal('Bolognaise', 4, [
      { kind: 'prep', prepId: sauce, qty: 4 },
      { ingredientId: pates, qty: 400, unit: 'g' },
    ]);
    const chili = await meal('Chili', 2, [
      { kind: 'prep', prepId: rizCuit, qty: 2 },
      { ingredientId: haricots, qty: 250, unit: 'g' },
    ]);
    const boite = await meal('Boîte riz-œufs', 1, [
      { kind: 'prep', prepId: rizCuit, qty: 0.8 },
      { kind: 'prep', prepId: oeufs, qty: 1 },
    ]);
    await call('PUT', '/list', { from: FROM, to: TO });
    const s = await state();
    const m = (name: string) => s.moments.find((x) => x.name === name)!.id;
    const plan = async (date: string, moment: string, mealId: string, servings: number) =>
      (
        await call<{ id: string }>('POST', '/plan', {
          date,
          momentId: m(moment),
          mealId,
          servings,
        })
      ).id;
    const e = {
      boloMon: await plan('2026-11-02', 'Soir', bolo, 2),
      boloFri: await plan('2026-11-06', 'Soir', bolo, 2),
      chiliTue: await plan('2026-11-03', 'Soir', chili, 2),
      boiteWed: await plan('2026-11-04', 'Midi', boite, 1),
      boiteThu: await plan('2026-11-05', 'Midi', boite, 1),
    };
    return { m, e, ids: { sauce, rizCuit, oeufs, bolo, chili, boite } };
  }
  const compute = (
    m: (name: string) => string,
    entryIds: string[],
    freezer: boolean,
    slots = [{ date: '2026-11-02', momentId: m('Midi') }],
  ) =>
    call<BatchProposalDto>('POST', '/batch/compute', {
      from: FROM,
      to: TO,
      entryIds,
      slots,
      freezer,
      daysBefore: 0,
    });

  it('bolognaise: the sauce in the batch, the pasta at meal time (absent)', async () => {
    const { m, e } = await setup();
    const p = await compute(m, [e.boloMon], false);
    expect(p.sessions).toHaveLength(1);
    expect(p.sessions[0]!.cooks.map((c) => [c.mealName, c.portions])).toEqual([
      ['Sauce bolognaise', 2],
    ]);
    const cook = p.sessions[0]!.cooks[0]!;
    expect(cook.ingredients).toEqual([
      { name: 'Coulis', amount: '300 g' },
      { name: 'Viande hachée', amount: '200 g' },
    ]);
    expect(JSON.stringify(p)).not.toContain('Pâtes');
    expect(cook.usedIn).toEqual(['Bolognaise']);
  });

  it('the same preparation partly in the fridge, partly in the freezer', async () => {
    const { m, e } = await setup();
    const p = await compute(m, [e.boloMon, e.boloFri], true);
    expect(p.sessions).toHaveLength(1);
    const cook = p.sessions[0]!.cooks[0]!;
    expect([cook.mealName, cook.portions]).toEqual(['Sauce bolognaise', 4]);
    expect(cook.fridge.map((u) => [u.date, u.servings])).toEqual([['2026-11-02', 2]]);
    expect(cook.frozen.map((u) => [u.date, u.servings])).toEqual([['2026-11-06', 2]]);
    // Without the freezer: Friday's sauce is to cook on the day, grouped by preparation.
    const fridgeOnly = await compute(m, [e.boloMon, e.boloFri], false);
    expect(fridgeOnly.uncovered).toEqual([
      {
        entryId: e.boloFri,
        prepId: expect.any(String) as string,
        name: 'Sauce bolognaise',
        reason: 'se garde 2 jours au frigo, dernier créneau 4 jours avant (congélation désactivée)',
      },
    ]);
  });

  it('rice shared by two recipes: one cooking, portions added up; eggs by the fridge alone', async () => {
    const { m, e } = await setup();
    const p = await compute(m, [e.chiliTue, e.boiteWed, e.boiteThu], true);
    expect(p.sessions).toHaveLength(1);
    const byName = new Map(p.sessions[0]!.cooks.map((c) => [c.mealName, c]));
    // Chili 2 portions × 2 / 2 + 2 boxes × 0.8: 3.6 portions of rice, cooked once.
    expect(byName.get('Riz cuit')).toMatchObject({
      portions: 3.6,
      ingredients: [{ name: 'Riz', amount: '360 g' }],
      usedIn: ['Boîte riz-œufs', 'Chili'],
    });
    expect(byName.get('Riz cuit')!.frozen).toEqual([]);
    expect(byName.get('Œufs durs en coquille')).toMatchObject({
      portions: 2,
      frozen: [],
      ingredients: [{ name: 'Œuf', amount: '6 pièces' }],
    });
    expect(p).toMatchObject({ covered: 5, total: 5, uncovered: [] });
    // Four days before: the eggs (5 days) by the fridge; the rice (3 days, not freezable) on the day.
    const late = await call<BatchProposalDto>('POST', '/batch/compute', {
      from: FROM,
      to: TO,
      entryIds: [e.boiteThu],
      slots: [{ date: '2026-11-01', momentId: m('Soir') }],
      freezer: true,
      daysBefore: 1,
    });
    expect(late.sessions[0]!.cooks.map((c) => [c.mealName, c.fridge.length])).toEqual([
      ['Œufs durs en coquille', 1],
    ]);
    expect(late.uncovered.map((u) => [u.name, u.reason])).toEqual([
      ['Riz cuit', 'se garde 3 jours au frigo, dernier créneau 4 jours avant ; non congelable'],
    ]);
  });

  it('a preparation without keeping: flagged and left out, the other parts computed', async () => {
    const { m, e, ids } = await setup();
    await call('PUT', `/preps/${ids.oeufs}`, { name: 'Œufs durs en coquille', fridgeDays: null });
    const b = await call<BatchStateDto>('GET', `/batch?from=${FROM}&to=${TO}`);
    expect(
      b.entries.find((x) => x.entryId === e.boiteWed)!.parts.map((x) => [x.name, x.fridgeDays]),
    ).toEqual([
      ['Riz cuit', 3],
      ['Œufs durs en coquille', null],
    ]);
    const p = await compute(m, [e.boiteWed], false);
    expect(p.missing).toEqual([
      { entryId: e.boiteWed, prepId: ids.oeufs, name: 'Œufs durs en coquille' },
    ]);
    expect(p.sessions[0]!.cooks.map((c) => c.mealName)).toEqual(['Riz cuit']);
  });

  it('a validated plan: thaw one line per day; a covered recipe changed → banner with the reason', async () => {
    const { m, e, ids } = await setup();
    const plan = await call<BatchPlanDto>('POST', '/batch/plans', {
      from: FROM,
      to: TO,
      entryIds: [e.boloMon, e.boloFri, e.chiliTue],
      slots: [{ date: '2026-11-02', momentId: m('Midi') }],
      freezer: true,
      daysBefore: 0,
    });
    expect(plan.changes).toEqual([]);
    expect(plan.sessions[0]!.cooks.map((c) => [c.mealName, c.portions])).toEqual([
      ['Riz cuit', 2],
      ['Sauce bolognaise', 4],
    ]);
    expect((await state()).thaw).toEqual([{ date: '2026-11-05', names: ['Sauce bolognaise'] }]);
    const plans = async () =>
      (await call<BatchStateDto>('GET', `/batch?from=${FROM}&to=${TO}`)).plans[0]!.changes;
    // The composition of a preparation used by a covered meal changes.
    await call('PUT', `/preps/${ids.rizCuit}`, {
      name: 'Riz cuit',
      items: [{ name: 'Riz', qty: 90, unit: 'g' }],
      confirmed: true,
    });
    expect(await plans()).toEqual(['la composition d’une préparation utilisée a changé']);
  });

  it('a v0.26 block covered, then split by « Extraire en préparation » → banner', async () => {
    hub = await openHub();
    await call('POST', '/meals', {
      name: 'Curry',
      servings: 2,
      fridgeDays: 3,
      items: [
        { name: 'Pois chiches', qty: 300, unit: 'g' },
        { name: 'Riz', qty: 150, unit: 'g' },
      ],
    });
    await call('PUT', '/list', { from: FROM, to: TO });
    let s = await state();
    const soir = s.moments.find((x) => x.name === 'Soir')!.id;
    const entry = (
      await call<{ id: string }>('POST', '/plan', {
        date: '2026-11-03',
        momentId: soir,
        mealId: s.meals[0]!.id,
        servings: 2,
      })
    ).id;
    const plan = await call<BatchPlanDto>('POST', '/batch/plans', {
      from: FROM,
      to: TO,
      entryIds: [entry],
      slots: [{ date: '2026-11-02', momentId: soir }],
      freezer: false,
      daysBefore: 0,
    });
    expect(plan.sessions[0]!.cooks[0]).toMatchObject({
      mealName: 'Curry',
      prepId: null,
      portions: 2,
    });
    s = await state();
    await call('POST', `/meals/${s.meals[0]!.id}/extract`, {
      lineIds: [s.meals[0]!.lines[1]!.id],
      name: 'Riz cuit',
      apply: true,
    });
    const b = await call<BatchStateDto>('GET', `/batch?from=${FROM}&to=${TO}`);
    expect(b.plans[0]!.changes).toEqual(['une recette couverte a été découpée en préparations']);
  });

  it('a plan validated by v0.26 stays valid after the migration (no prep, no basis)', async () => {
    hub = await openHub();
    await call('POST', '/meals', {
      name: 'Dal',
      servings: 2,
      fridgeDays: 3,
      items: [{ name: 'Lentilles', qty: 200, unit: 'g' }],
    });
    await call('PUT', '/list', { from: FROM, to: TO });
    const s = await state();
    const soir = s.moments.find((x) => x.name === 'Soir')!.id;
    const entry = (
      await call<{ id: string }>('POST', '/plan', {
        date: '2026-11-03',
        momentId: soir,
        mealId: s.meals[0]!.id,
        servings: 2,
      })
    ).id;
    await call('POST', '/batch/plans', {
      from: FROM,
      to: TO,
      entryIds: [entry],
      slots: [{ date: '2026-11-02', momentId: soir }],
      freezer: false,
      daysBefore: 0,
    });
    // As a v0.26 plan was written: no preparation, no basis.
    const db = new Database(path.join(hub.dataDir, 'hub.db'));
    db.prepare('UPDATE courses__batch_portions SET prep_id = NULL, basis = NULL').run();
    db.close();
    const b = await call<BatchStateDto>('GET', `/batch?from=${FROM}&to=${TO}`);
    expect(b.plans[0]!.changes).toEqual([]);
    expect(b.plans[0]!.sessions[0]!.cooks[0]).toMatchObject({ mealName: 'Dal', portions: 2 });
    expect(b.entries[0]!.coveredBy).toBe(b.plans[0]!.id);
  });
});

describe('batch by preparation: time of the exact calculation', () => {
  /**
   * The realistic case asked for: one week, four moments, every slot ticked,
   * every recipe split (two to three preparations each, the rice shared),
   * midday and evening every day.
   */
  function week(days: number, mealsPerDay: string[]): BatchMeal[] {
    const recipes = [
      ['sauce', 'riz'],
      ['riz', 'oeufs'],
      ['curry', 'riz'],
      ['legumes', 'poulet', 'riz'],
      ['dal', 'oeufs'],
    ];
    const keep: Record<string, [number, boolean, number | null]> = {
      sauce: [2, true, 90],
      riz: [3, false, null],
      oeufs: [5, false, null],
      curry: [3, true, 60],
      legumes: [3, true, 30],
      poulet: [2, true, 60],
      dal: [4, true, 60],
    };
    const out: BatchMeal[] = [];
    let n = 0;
    for (let d = 0; d < days; d++)
      for (const moment of mealsPerDay) {
        const recipe = recipes[n % recipes.length]!;
        n++;
        for (const prep of recipe) {
          const [fridgeDays, freezable, freezerDays] = keep[prep]!;
          out.push({
            entryId: `e${n}`,
            date: `2026-11-${String(2 + d).padStart(2, '0')}`,
            momentId: moment,
            recipeId: `prep:${prep}`,
            recipeName: prep,
            servings: 1.5,
            fridgeDays,
            freezable,
            freezerDays,
          });
        }
      }
    return out;
  }
  const moments = ['matin', 'midi', 'collation', 'soir'];
  const allSlots = (days: number) =>
    Array.from({ length: days }, (_, d) =>
      moments.map((momentId) => ({ date: `2026-11-${String(2 + d).padStart(2, '0')}`, momentId })),
    ).flat();

  it('one week, four moments, all slots, all recipes split: exact within the budget', () => {
    for (const freezer of [false, true]) {
      const meals = week(7, ['midi', 'soir']);
      const t = performance.now();
      const r = planBatch({ meals, slots: allSlots(7), momentOrder: moments, freezer });
      const ms = performance.now() - t;
      console.log(
        `semaine, 14 repas, ${meals.length} couples, 28 créneaux, congélation ${freezer ? 'oui' : 'non'} : ${ms.toFixed(0)} ms, ${r.sessions.length} sessions`,
      );
      expect(r.tooComplex).toBe(false);
      expect(r.covered).toBe(meals.length);
      expect(ms).toBeLessThan(5000);
    }
    expect(SEARCH_LIMIT).toBe(400_000);
  });
  it('three meals a day: measured (said in the report)', () => {
    const meals = week(7, ['matin', 'midi', 'soir']);
    const t = performance.now();
    const r = planBatch({ meals, slots: allSlots(7), momentOrder: moments, freezer: true });
    console.log(
      `semaine, 21 repas, ${meals.length} couples, 28 créneaux : ${(performance.now() - t).toFixed(0)} ms, ${r.tooComplex ? 'trop complexe' : `${r.sessions.length} sessions`}`,
    );
    expect(r.tooComplex || r.covered === meals.length).toBe(true);
  });
});
