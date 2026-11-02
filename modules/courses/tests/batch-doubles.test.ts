// Temps 2 (v0.29), « Doubles doses », pure: a cooking opens at the first
// meal not covered at a moment when Thomas cooks and covers the next meals of
// the same element in its window; a cooking for one meal is not listed; the
// fewest cookings (against an exhaustive search). Plus « pour » grouped by
// recipe and the totals of a session (ingredients in the recipe's order).
import { describe, expect, it } from 'vitest';
import type { BatchMeal } from '../shared/batch';
import { optionOf } from '../shared/batch';
import { amountsOf, cookLines, doubleDoses, forLine } from '../shared/batch-cook';

const MOMENTS = ['matin', 'midi', 'soir'];
const day = (n: number) => `2026-11-${String(3 + n).padStart(2, '0')}`; // 0 = mardi 3 nov.
const meal = (
  id: string,
  d: number,
  momentId: string,
  key: string,
  keep: Partial<BatchMeal> = {},
) =>
  ({
    entryId: id,
    date: day(d),
    momentId,
    recipeId: key,
    recipeName: key.slice(5),
    servings: 2,
    fridgeDays: 3,
    freezable: false,
    freezerDays: null,
    ...keep,
  }) satisfies BatchMeal;
const ALL = new Set(MOMENTS);
const shape = (list: ReturnType<typeof doubleDoses>) =>
  list.map((d) => [
    d.key,
    d.opener.entryId,
    d.also.map((a) => `${a.meal.entryId}${a.frozen ? '*' : ''}`),
  ]);

describe('doubles doses', () => {
  it('gratin Tuesday and Wednesday evening, cooking in the evening: one cooking × 2 on Tuesday', () => {
    const r = doubleDoses(
      [meal('mar', 0, 'soir', 'meal:gratin'), meal('mer', 1, 'soir', 'meal:gratin')],
      new Set(['soir']),
      MOMENTS,
      false,
    );
    expect(shape(r)).toEqual([['meal:gratin', 'mar', ['mer']]]);
  });
  it('curry Tuesday and Thursday (fridge 3 days): one cooking; beyond the fridge: two, or one frozen', () => {
    const curry = (keep: Partial<BatchMeal> = {}) => [
      meal('mar', 0, 'soir', 'prep:curry', keep),
      meal('jeu', 2, 'soir', 'prep:curry', keep),
    ];
    expect(shape(doubleDoses(curry(), ALL, MOMENTS, false))).toEqual([
      ['prep:curry', 'mar', ['jeu']],
    ]);
    const short = { fridgeDays: 1 };
    // Two cookings of one meal each: normal cooking, nothing listed.
    expect(doubleDoses(curry(short), ALL, MOMENTS, false)).toEqual([]);
    const frozen = { fridgeDays: 1, freezable: true, freezerDays: 60 };
    expect(shape(doubleDoses(curry(frozen), ALL, MOMENTS, false))).toEqual([]);
    expect(shape(doubleDoses(curry(frozen), ALL, MOMENTS, true))).toEqual([
      ['prep:curry', 'mar', ['jeu*']],
    ]);
  });
  it('first meal at a moment when Thomas does not cook: the cooking opens at the next possible meal', () => {
    const r = doubleDoses(
      [
        meal('mar-midi', 0, 'midi', 'meal:gratin'),
        meal('mar-soir', 0, 'soir', 'meal:gratin'),
        meal('mer-midi', 1, 'midi', 'meal:gratin'),
      ],
      new Set(['soir']),
      MOMENTS,
      false,
    );
    // Tuesday midday: left out (no cooking possible before it); cooked Tuesday evening for Wednesday midday.
    expect(shape(r)).toEqual([['meal:gratin', 'mar-soir', ['mer-midi']]]);
  });
  it('fewest cookings: the same as an exhaustive search on generated cases', () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let cases = 0;
    for (let run = 0; run < 400; run++) {
      const freezer = rnd() < 0.5;
      const keep = {
        fridgeDays: 1 + Math.floor(rnd() * 3),
        freezable: rnd() < 0.5,
        freezerDays: rnd() < 0.5 ? 30 : null,
      };
      const meals = Array.from({ length: 7 }, (_, d) =>
        MOMENTS.filter(() => rnd() < 0.35).map((m) => [d, m] as const),
      )
        .flat()
        .map(([d, m], k) => meal(`e${k}`, d, m, 'prep:x', keep));
      const cookAt = new Set(MOMENTS.filter(() => rnd() < 0.6));
      if (!meals.length || !cookAt.size) continue;
      const result = doubleDoses(meals, cookAt, MOMENTS, freezer);
      // Every cooking of the algorithm, including the ones for one meal (not listed): rebuild them.
      const covered = new Set(
        result.flatMap((d) => [d.opener.entryId, ...d.also.map((a) => a.meal.entryId)]),
      );
      if (!covered.size) continue;
      // Exhaustive: the fewest openers (meals at a cooking moment) covering every meal of `covered`.
      const target = meals.filter((m) => covered.has(m.entryId));
      const openers = meals.filter((m) => cookAt.has(m.momentId));
      let best = Infinity;
      for (let mask = 1; mask < 1 << openers.length; mask++) {
        const chosen = openers.filter((_, i) => mask & (1 << i));
        if (chosen.length >= best) continue;
        const ok = target.every((t) =>
          chosen.some((o) => o === t || optionOf(t, o, MOMENTS, freezer)),
        );
        if (ok) best = chosen.length;
      }
      expect(result.length).toBe(best);
      cases++;
    }
    expect(cases).toBeGreaterThan(100);
  });
});

describe('readable results', () => {
  it('« pour » grouped by recipe, days abbreviated, the moment said once', () => {
    const names = new Map([
      ['matin', 'Matin'],
      ['midi', 'Midi'],
      ['soir', 'Soir'],
    ]);
    const u = (d: number, m: string, mealName: string) => ({
      entryId: `${d}${m}`,
      date: day(d),
      momentId: m,
      servings: 1,
      mealName,
    });
    expect(
      forLine(
        [
          u(0, 'midi', 'Boîte riz-œufs'),
          u(2, 'midi', 'Boîte riz-œufs'),
          u(1, 'midi', 'Boîte riz-œufs'),
          u(0, 'matin', 'Déjeuner'),
          u(1, 'soir', 'Déjeuner'),
        ],
        names,
      ),
    ).toBe('Boîte riz-œufs — mar., mer., jeu. midi · Déjeuner — mar. matin, mer. soir');
  });
  it('ingredients in the order of the lines; the totals of a session added up exactly', () => {
    const facts = { names: { riz: 'Riz', oeuf: 'Œuf', sel: 'Sel' }, pieces: {} };
    const riz = { kind: 'prep' as const, items: [{ ingredientId: 'riz', qty: 100, unit: 'g' }] };
    const boite = {
      kind: 'meal' as const,
      servings: 1,
      items: [
        { ingredientId: 'sel', qty: 1, unit: 'g' },
        { ingredientId: 'riz', qty: 80, unit: 'g' },
        { ingredientId: 'oeuf', qty: 3, unit: 'pièce' },
      ],
    };
    expect(amountsOf(cookLines(boite, 2), facts).map((a) => a.name)).toEqual(['Sel', 'Riz', 'Œuf']);
    expect(amountsOf([...cookLines(riz, 4.8), ...cookLines(boite, 2)], facts)).toEqual([
      { name: 'Riz', amount: '640 g' },
      { name: 'Sel', amount: '2 g' },
      { name: 'Œuf', amount: '6 pièces' },
    ]);
  });
});
