// « Pourrait aussi servir » (v0.28), pure: a suggestion only grows a cooking
// already in the proposal (same session, same preparation or whole recipe),
// by the rules of the calculation; « Ajouter » and « Retirer » change the
// proposal shown without recalculating; recalculating after additions never
// gives more sessions nor more cookings.
import { describe, expect, it } from 'vitest';
import { planBatch, type BatchMeal, type BatchResult } from '../shared/batch';
import { cookIngredients, suggest, withAdditions, type Candidate } from '../shared/batch-suggest';
import type { BatchProposalDto } from '../shared/types';

const MOMENTS = ['matin', 'midi', 'soir'];
const day = (n: number) => `2026-11-${String(2 + n).padStart(2, '0')}`;
const couple = (
  entryId: string,
  d: number,
  momentId: string,
  key: string,
  keep: Partial<BatchMeal> = {},
): Candidate => ({
  entryId,
  date: day(d),
  momentId,
  recipeId: key,
  recipeName: key.slice(5),
  servings: 1,
  fridgeDays: 2,
  freezable: false,
  freezerDays: null,
  mealName: `Repas ${entryId}`,
  ...keep,
});
const cook = (d: number, momentId: string, key: string) => ({ date: day(d), momentId, key });

describe('suggest', () => {
  it('a meal not ticked that shares the preparation, in the fridge window', () => {
    const s = suggest(
      [cook(0, 'soir', 'prep:riz')],
      [couple('b', 2, 'midi', 'prep:riz')],
      MOMENTS,
      false,
    );
    expect(s).toEqual([
      [
        {
          entryId: 'b',
          date: day(2),
          momentId: 'midi',
          servings: 1,
          mealName: 'Repas b',
          frozen: false,
        },
      ],
    ]);
  });
  it('beyond the fridge: only with the freezer and a freezable preparation, frozen', () => {
    const far = (keep: Partial<BatchMeal>) => [couple('c', 5, 'soir', 'prep:sauce', keep)];
    const at = [cook(0, 'midi', 'prep:sauce')];
    expect(suggest(at, far({}), MOMENTS, true)).toEqual([[]]);
    expect(suggest(at, far({ freezable: true, freezerDays: 90 }), MOMENTS, false)).toEqual([[]]);
    expect(suggest(at, far({ freezable: true, freezerDays: null }), MOMENTS, true)).toEqual([[]]);
    expect(suggest(at, far({ freezable: true, freezerDays: 90 }), MOMENTS, true)[0]).toMatchObject([
      { entryId: 'c', frozen: true },
    ]);
  });
  it('never a new cooking: a preparation absent from the session is not suggested', () => {
    expect(
      suggest(
        [cook(0, 'soir', 'prep:riz')],
        [couple('d', 1, 'midi', 'prep:oeufs')],
        MOMENTS,
        false,
      ),
    ).toEqual([[]]);
    // A recipe cooked whole: only another meal of the SAME recipe.
    expect(
      suggest(
        [cook(0, 'soir', 'meal:curry')],
        [couple('e', 1, 'midi', 'meal:curry'), couple('f', 1, 'midi', 'meal:dal')],
        MOMENTS,
        false,
      )[0]!.map((x) => x.entryId),
    ).toEqual(['e']);
  });
  it('slot rule: an earlier moment of the same day is not covered; the same moment is', () => {
    const at = [cook(1, 'soir', 'prep:riz')];
    expect(suggest(at, [couple('g', 1, 'midi', 'prep:riz')], MOMENTS, false)).toEqual([[]]);
    expect(suggest(at, [couple('h', 1, 'soir', 'prep:riz')], MOMENTS, false)[0]).toHaveLength(1);
  });
  it('a couple two cookings could take: suggested once, fridge before freezer, then the closest', () => {
    const cooks = [cook(0, 'midi', 'prep:sauce'), cook(3, 'midi', 'prep:sauce')];
    const fridgeLater = couple('i', 4, 'soir', 'prep:sauce', { freezable: true, freezerDays: 90 });
    const s = suggest(cooks, [fridgeLater], MOMENTS, true);
    expect(s.map((l) => l.map((x) => [x.entryId, x.frozen]))).toEqual([[], [['i', false]]]);
    // Both in the fridge window: the closest cooking.
    const both = couple('j', 2, 'soir', 'prep:sauce', { fridgeDays: 3 });
    expect(
      suggest(cooks.slice(0, 1).concat(cook(1, 'midi', 'prep:sauce')), [both], MOMENTS, false).map(
        (l) => l.length,
      ),
    ).toEqual([0, 1]);
  });
});

/** A proposal as the server gives it, from a result of the calculation. */
function proposalOf(
  result: BatchResult,
  candidates: Candidate[],
  freezer: boolean,
): BatchProposalDto {
  const cooks = result.sessions.flatMap((s) =>
    s.cooks.map((c) => ({ date: s.date, momentId: s.momentId, key: c.recipeId })),
  );
  const sug = suggest(cooks, candidates, MOMENTS, freezer);
  let k = 0;
  return {
    sessions: result.sessions.map((s) => ({
      date: s.date,
      momentId: s.momentId,
      beforePeriod: false,
      warnings: [],
      cooks: s.cooks.map((c) => ({
        mealId: c.recipeId.startsWith('meal:') ? c.recipeId.slice(5) : null,
        prepId: c.recipeId.startsWith('prep:') ? c.recipeId.slice(5) : null,
        mealName: c.recipeName,
        portions: c.portions,
        fridge: c.fridge,
        frozen: c.frozen,
        usedIn: [],
        basis: { kind: 'prep', items: [{ ingredientId: 'riz', qty: 100, unit: 'g' }] },
        ingredients: cookIngredients(
          { kind: 'prep', items: [{ ingredientId: 'riz', qty: 100, unit: 'g' }] },
          c.portions,
          { names: { riz: 'Riz' }, pieces: {} },
        ),
        suggestions: sug[k++]!,
      })),
    })),
    uncovered: [],
    missing: [],
    covered: result.covered,
    total: result.total,
    tooComplex: result.tooComplex,
    facts: { names: { riz: 'Riz' }, pieces: {} },
  };
}

describe('« Ajouter » and « Retirer »', () => {
  const ticked = [couple('a', 0, 'soir', 'prep:riz', { servings: 2 })];
  const others = [
    couple('b', 1, 'midi', 'prep:riz', { servings: 1.5 }),
    couple('c', 2, 'midi', 'prep:riz', { servings: 0.8 }),
  ];
  const slots = [{ date: day(0), momentId: 'midi' }];
  const base = proposalOf(
    planBatch({ meals: ticked, slots, momentOrder: MOMENTS, freezer: false }),
    others,
    false,
  );

  it('updates the quantity and « pour : … » without a calculation; removing gives back the state before', () => {
    expect(base.sessions[0]!.cooks[0]).toMatchObject({
      portions: 2,
      ingredients: [{ name: 'Riz', amount: '200 g' }],
    });
    expect(base.sessions[0]!.cooks[0]!.suggestions!.map((x) => x.entryId)).toEqual(['b', 'c']);
    const add = (entryId: string) => ({
      date: day(0),
      momentId: 'midi',
      cook: 'prep:riz',
      entryId,
    });
    const one = withAdditions(base, [add('c')], MOMENTS);
    const c1 = one.sessions[0]!.cooks[0]!;
    expect(c1.portions).toBe(2.8);
    expect(c1.ingredients).toEqual([{ name: 'Riz', amount: '280 g' }]);
    expect(c1.fridge.map((u) => [u.entryId, u.added ?? false])).toEqual([
      ['a', false],
      ['c', true],
    ]);
    expect(c1.suggestions!.map((x) => x.entryId)).toEqual(['b']);
    expect([one.covered, one.total]).toEqual([2, 2]);
    const two = withAdditions(base, [add('c'), add('b')], MOMENTS);
    expect(two.sessions[0]!.cooks[0]!.fridge.map((u) => u.entryId)).toEqual(['a', 'b', 'c']);
    expect(two.sessions[0]!.cooks[0]!.ingredients).toEqual([{ name: 'Riz', amount: '430 g' }]);
    // « Retirer »: the same base with one addition less is exactly the state before.
    expect(withAdditions(base, [add('c')], MOMENTS)).toEqual(one);
    expect(withAdditions(base, [], MOMENTS)).toEqual(base);
    expect(JSON.stringify(withAdditions(base, [], MOMENTS))).toBe(JSON.stringify(base));
    // Not a suggestion of this proposal: refused.
    expect(() => withAdditions(base, [add('zz')], MOMENTS)).toThrow('La proposition a changé');
  });
});

describe('recalculating after additions: never more sessions nor more cookings', () => {
  // A small deterministic generator (same cases every run).
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)]!;
  const preps: Record<string, Partial<BatchMeal>> = {
    'prep:riz': { fridgeDays: 3, freezable: false },
    'prep:sauce': { fridgeDays: 2, freezable: true, freezerDays: 90 },
    'prep:oeufs': { fridgeDays: 5, freezable: false },
    'meal:curry': { fridgeDays: 1, freezable: true, freezerDays: 30 },
  };
  it('on 300 generated weeks (fridge only and with the freezer)', () => {
    let checked = 0;
    for (let run = 0; run < 300; run++) {
      const freezer = rnd() < 0.5;
      const all: Candidate[] = [];
      let n = 0;
      for (let d = 0; d < 7; d++)
        for (const m of ['midi', 'soir'])
          if (rnd() < 0.7) {
            n++;
            const keys = Object.keys(preps).filter(() => rnd() < 0.45);
            for (const key of keys.length ? keys : [pick(Object.keys(preps))])
              all.push(
                couple(`e${n}`, d, m, key, { ...preps[key], servings: 1 + Math.floor(rnd() * 3) }),
              );
          }
      const slots = [0, 1, 2, 3, 4, 5, 6].flatMap((d) =>
        MOMENTS.filter(() => rnd() < 0.25).map((momentId) => ({ date: day(d), momentId })),
      );
      if (!slots.length) continue;
      const ticked = all.filter(() => rnd() < 0.5);
      const others = all.filter((x) => !ticked.includes(x));
      const first = planBatch({ meals: ticked, slots, momentOrder: MOMENTS, freezer });
      if (first.tooComplex || !first.sessions.length) continue;
      const base = proposalOf(first, others, freezer);
      const additions = base.sessions.flatMap((s) =>
        s.cooks.flatMap((c) =>
          (c.suggestions ?? [])
            .filter(() => rnd() < 0.6)
            .map((x) => ({
              date: s.date,
              momentId: s.momentId,
              cook: c.prepId ? `prep:${c.prepId}` : `meal:${c.mealId}`,
              entryId: x.entryId,
            })),
        ),
      );
      if (!additions.length) continue;
      const added = new Set(additions.map((a) => `${a.entryId}|${a.cook}`));
      const again = planBatch({
        meals: [...ticked, ...others.filter((x) => added.has(`${x.entryId}|${x.recipeId}`))],
        slots,
        momentOrder: MOMENTS,
        freezer,
      });
      if (again.tooComplex) continue;
      const cookings = (r: { sessions: { cooks: unknown[] }[] }) =>
        r.sessions.reduce((k, s) => k + s.cooks.length, 0);
      expect(again.sessions.length).toBeLessThanOrEqual(first.sessions.length);
      expect(cookings(again)).toBeLessThanOrEqual(cookings(first));
      expect(again.covered).toBe(first.covered + additions.length);
      checked++;
    }
    console.log(`garantie vérifiée sur ${checked} semaines avec des ajouts`);
    expect(checked).toBeGreaterThan(100);
  });
});
