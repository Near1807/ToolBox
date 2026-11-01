// Batch cooking: the exact optimisation (shared/batch.ts) and the cooking
// slots (shared/batch-grid.ts).
import { describe, expect, it } from 'vitest';
import { planBatch, type BatchInput, type BatchMeal } from '../shared/batch';
import { gridDates, modelFromSlots, parseModel, projectModel } from '../shared/batch-grid';

const MOMENTS = ['matin', 'midi', 'soir'];
let n = 0;
const meal = (
  date: string,
  momentId: string,
  recipe: string,
  keep: Partial<Pick<BatchMeal, 'fridgeDays' | 'freezable' | 'freezerDays' | 'servings'>> = {},
): BatchMeal => ({
  entryId: `e${String(++n).padStart(3, '0')}`,
  date,
  momentId,
  recipeId: recipe,
  recipeName: recipe,
  servings: keep.servings ?? 1,
  fridgeDays: keep.fridgeDays ?? 2,
  freezable: keep.freezable ?? false,
  freezerDays: keep.freezerDays ?? null,
});
const run = (input: Partial<BatchInput> & Pick<BatchInput, 'meals' | 'slots'>) =>
  planBatch({ momentOrder: MOMENTS, freezer: false, ...input });
const sessions = (r: ReturnType<typeof planBatch>) =>
  r.sessions.map(
    (s) =>
      `${s.date} ${s.momentId}: ${s.cooks
        .map(
          (c) =>
            `${c.recipeName} ${c.portions} [${c.fridge.map((u) => `${u.date.slice(8)}${u.momentId[0]}`).join(' ')}]${c.frozen.length ? ` congel [${c.frozen.map((u) => u.date.slice(8)).join(' ')}]` : ''}`,
        )
        .join(', ')}`,
  );
// Monday 2 November 2026 … Sunday 8.
const D = (day: number) => `2026-11-${String(day).padStart(2, '0')}`;

describe('batch cooking optimisation', () => {
  it('one session is enough', () => {
    const r = run({
      meals: [meal(D(2), 'soir', 'Curry'), meal(D(3), 'midi', 'Curry'), meal(D(4), 'soir', 'Dal')],
      slots: [
        { date: D(2), momentId: 'soir' },
        { date: D(5), momentId: 'soir' },
      ],
    });
    expect(sessions(r)).toEqual(['2026-11-02 soir: Curry 2 [02s 03m], Dal 1 [04s]']);
    expect(r).toMatchObject({ covered: 3, total: 3, uncovered: [], tooComplex: false });
  });

  it('two sessions are needed; with the freezer, one is enough', () => {
    const meals = [
      meal(D(2), 'soir', 'Curry', { freezable: true, freezerDays: 60 }),
      meal(D(3), 'soir', 'Curry', { freezable: true, freezerDays: 60 }),
      meal(D(6), 'soir', 'Curry', { freezable: true, freezerDays: 60 }),
      meal(D(7), 'soir', 'Curry', { freezable: true, freezerDays: 60 }),
    ];
    const slots = [
      { date: D(2), momentId: 'soir' },
      { date: D(5), momentId: 'soir' },
    ];
    expect(sessions(run({ meals, slots }))).toEqual([
      '2026-11-02 soir: Curry 2 [02s 03s]',
      '2026-11-05 soir: Curry 2 [06s 07s]',
    ]);
    const frozen = run({ meals, slots, freezer: true });
    expect(sessions(frozen)).toEqual(['2026-11-02 soir: Curry 4 [02s 03s] congel [06 07]']);
  });

  it('a recipe not freezable stays in the fridge window, freezer or not', () => {
    const meals = [meal(D(2), 'soir', 'Salade'), meal(D(6), 'soir', 'Salade')];
    const r = run({ meals, slots: [{ date: D(2), momentId: 'soir' }], freezer: true });
    expect(sessions(r)).toEqual(['2026-11-02 soir: Salade 1 [02s]']);
    expect(r.uncovered.map((u) => u.reason)).toEqual([
      'se garde 2 jours au frigo, dernier créneau 4 jours avant ; non congelable',
    ]);
  });

  it('an evening session covers that evening, not that lunch; several slots a day', () => {
    const meals = [
      meal(D(2), 'midi', 'Pâtes', { fridgeDays: 0 }),
      meal(D(2), 'soir', 'Pâtes', { fridgeDays: 0 }),
    ];
    expect(run({ meals, slots: [{ date: D(2), momentId: 'soir' }] }).uncovered[0]!.reason).toBe(
      'aucun créneau de cuisine avant ce repas',
    );
    const both = run({
      meals,
      slots: [
        { date: D(2), momentId: 'soir' },
        { date: D(2), momentId: 'matin' },
      ],
    });
    expect(sessions(both)).toEqual(['2026-11-02 matin: Pâtes 2 [02m 02s]']);
  });

  it('the fewest cookings, then the fewest frozen portions, then the closest', () => {
    // Two sessions are needed (Dal on the 7th); the Curry is cooked once only.
    const meals = [
      meal(D(2), 'soir', 'Curry', { fridgeDays: 3 }),
      meal(D(4), 'soir', 'Curry', { fridgeDays: 3 }),
      meal(D(7), 'soir', 'Dal', { fridgeDays: 0 }),
    ];
    const r = run({
      meals,
      slots: [2, 3, 7].map((d) => ({ date: D(d), momentId: 'soir' })),
    });
    expect(sessions(r)).toEqual([
      '2026-11-02 soir: Curry 2 [02s 04s]',
      '2026-11-07 soir: Dal 1 [07s]',
    ]);
  });

  it('a frozen portion is never eaten on the cooking day', () => {
    const meals = [
      meal(D(2), 'midi', 'Soupe', { fridgeDays: 0, freezable: true, freezerDays: 30 }),
      meal(D(2), 'soir', 'Soupe', { fridgeDays: 0, freezable: true, freezerDays: 30 }),
      meal(D(3), 'soir', 'Soupe', { fridgeDays: 0, freezable: true, freezerDays: 30 }),
    ];
    const r = run({ meals, slots: [{ date: D(2), momentId: 'midi' }], freezer: true });
    for (const s of r.sessions)
      for (const c of s.cooks) for (const u of c.frozen) expect(u.date > s.date).toBe(true);
    expect(sessions(r)).toEqual(['2026-11-02 midi: Soupe 3 [02m 02s] congel [03]']);
  });

  it('meals out of reach are said, with the reason; without the freezer too', () => {
    const r = run({
      meals: [meal(D(8), 'soir', 'Curry', { fridgeDays: 2, freezable: true, freezerDays: 60 })],
      slots: [{ date: D(2), momentId: 'soir' }],
    });
    expect(r.uncovered[0]!.reason).toBe(
      'se garde 2 jours au frigo, dernier créneau 6 jours avant (congélation désactivée)',
    );
    expect(r).toMatchObject({ covered: 0, total: 1, sessions: [] });
  });

  it('deterministic: the same answer whatever the order of the inputs', () => {
    const meals = [2, 3, 4, 5, 6, 7, 8].flatMap((d) => [
      meal(D(d), 'midi', d % 2 ? 'Curry' : 'Dal', { fridgeDays: 2 }),
      meal(D(d), 'soir', 'Soupe', { fridgeDays: 1, freezable: true, freezerDays: 20 }),
    ]);
    const slots = [2, 3, 4, 5, 6, 7, 8].flatMap((d) =>
      MOMENTS.map((momentId) => ({ date: D(d), momentId })),
    );
    const a = run({ meals, slots, freezer: true });
    const b = run({ meals: [...meals].reverse(), slots: [...slots].reverse(), freezer: true });
    expect(b).toEqual(a);
    expect(a.covered).toBe(14);
  });

  it('every slot ticked over two weeks: still exact and quick', () => {
    const days = Array.from({ length: 14 }, (_, i) => `2026-11-${String(2 + i).padStart(2, '0')}`);
    const meals = days.flatMap((d, i) => [
      meal(d, 'midi', ['A', 'B', 'C'][i % 3]!, { fridgeDays: 2 }),
      meal(d, 'soir', ['D', 'E'][i % 2]!, { fridgeDays: 3, freezable: true, freezerDays: 30 }),
    ]);
    const slots = days.flatMap((date) => MOMENTS.map((momentId) => ({ date, momentId })));
    const started = Date.now();
    const r = run({ meals, slots, freezer: false });
    expect(r.tooComplex).toBe(false);
    expect(r.covered).toBe(28);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('beyond an exact answer', () => {
  it('three weeks with every slot ticked: no plan rather than an approximate one', () => {
    const days = Array.from({ length: 21 }, (_, i) =>
      new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10),
    );
    const meals = days.flatMap((d, i) => [
      meal(d, 'midi', ['A', 'B', 'C'][i % 3]!, { fridgeDays: 3 }),
      meal(d, 'soir', ['D', 'E', 'F'][i % 3]!, { fridgeDays: 3 }),
      meal(d, 'matin', 'G', { fridgeDays: 3 }),
    ]);
    const slots = days.flatMap((date) => MOMENTS.map((momentId) => ({ date, momentId })));
    const r = run({ meals, slots });
    expect(r).toMatchObject({ tooComplex: true, sessions: [], covered: 0 });
  });
});

describe('cooking slots (grid)', () => {
  const model = { '1': ['soir'], '7': ['midi', 'gone'] };
  it('the model laid on a period, N days before included; unknown moments ignored', () => {
    const dates = gridDates(D(2), D(8), 0);
    expect(projectModel(model, dates, MOMENTS)).toEqual([
      { date: D(2), momentId: 'soir' },
      { date: D(8), momentId: 'midi' },
    ]);
    // N = 2: Saturday 31/10 and Sunday 1/11 too.
    expect(gridDates(D(2), D(8), 2)[0]).toBe('2026-10-31');
    expect(projectModel(model, gridDates(D(2), D(8), 2), MOMENTS)[0]).toEqual({
      date: '2026-11-01',
      momentId: 'midi',
    });
    // Any length and first day: Thursday to the next Tuesday.
    expect(projectModel(model, gridDates(D(5), D(10), 0), MOMENTS)).toEqual([
      { date: D(8), momentId: 'midi' },
      { date: D(9), momentId: 'soir' },
    ]);
  });
  it('« Retenir comme habituels », and a setting read safely', () => {
    expect(
      modelFromSlots(
        [
          { date: D(3), momentId: 'soir' },
          { date: D(3), momentId: 'matin' },
          { date: '2026-11-01', momentId: 'midi' },
        ],
        D(2),
        D(8),
        MOMENTS,
      ),
    ).toEqual({ '2': ['matin', 'soir'] });
    expect(parseModel('pas du json')).toEqual({});
    expect(parseModel('{"1":["soir"],"9":["x"],"2":"y"}')).toEqual({ '1': ['soir'] });
  });
});
