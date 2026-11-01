// The expansion of a recipe (v0.27, preparations), pure: the one function
// every calculation reads; « Extraire en préparation » and « Remplacer par
// ses ingrédients » never change it.
import { describe, expect, it } from 'vitest';
import {
  expandRecipe,
  extract,
  inlinePrep,
  isSplit,
  matchingPortions,
  prepPortions,
  type IngredientLine,
  type PrepLike,
  type RecipeLine,
} from '../shared/recipe';
import { addUp, fold, plannedLines } from '../shared/quantities';
import { filterMeals, NO_FILTER } from '../shared/meal-filter';

const ing = (id: string, ingredientId: string, qty: number, unit = 'g'): IngredientLine => ({
  kind: 'ingredient',
  id,
  ingredientId,
  qty,
  unit,
});
const sauce: PrepLike = {
  id: 'sauce',
  items: [
    { id: 's1', ingredientId: 'viande', qty: 125, unit: 'g' },
    { id: 's2', ingredientId: 'tomate', qty: 0.175, unit: 'kg' },
    { id: 's3', ingredientId: 'oignon', qty: 0.375, unit: 'pièce' },
  ],
};
const preps = new Map([[sauce.id, sauce]]);
const sorted = (lines: { ingredientId: string; qty: number; unit: string }[]) =>
  lines.map((l) => `${l.ingredientId}|${l.qty}|${l.unit}`).sort();

describe('expandRecipe', () => {
  it('a recipe without preparation: its lines, exactly', () => {
    const lines: RecipeLine[] = [ing('a', 'riz', 80), ing('b', 'oeuf', 3, 'pièce')];
    expect(expandRecipe(lines, preps)).toEqual([
      { id: 'a', ingredientId: 'riz', qty: 80, unit: 'g', fromLine: null },
      { id: 'b', ingredientId: 'oeuf', qty: 3, unit: 'pièce', fromLine: null },
    ]);
    expect(isSplit(lines)).toBe(false);
  });
  it('mixed (direct lines and a preparation), decimals, in the order of the recipe', () => {
    const lines: RecipeLine[] = [
      { kind: 'prep', id: 'p', prepId: 'sauce', qty: 4 },
      ing('d', 'pates', 400),
      ing('e', 'oignon', 0.5, 'pièce'),
    ];
    expect(expandRecipe(lines, preps).map((l) => [l.ingredientId, l.qty, l.unit])).toEqual([
      ['viande', 500, 'g'],
      ['tomate', 0.7, 'kg'],
      ['oignon', 1.5, 'pièce'],
      ['pates', 400, 'g'],
      ['oignon', 0.5, 'pièce'],
    ]);
    expect(isSplit(lines)).toBe(true);
    // The same ingredient direct and in the preparation: added up like any two lines.
    const totals = addUp(expandRecipe(lines, preps), new Map());
    expect(totals.find((t) => t.ingredientId === 'oignon')!.amounts).toEqual([
      { qty: 2, unit: 'pièce' },
    ]);
  });
  it('servings 4, « sauce × 4 », 2 portions planned → 2 portions of sauce', () => {
    const recipe = {
      id: 'bolo',
      servings: 4,
      items: expandRecipe([{ kind: 'prep', id: 'p', prepId: 'sauce', qty: 4 }], preps),
    };
    const lines = plannedLines([{ mealId: 'bolo', servings: 2 }], new Map([['bolo', recipe]]));
    expect(lines.map((l) => [l.ingredientId, l.qty])).toEqual([
      ['viande', 250],
      ['tomate', 0.35],
      ['oignon', 0.75],
    ]);
  });
  it('portions of each preparation (on two lines: added up)', () => {
    expect([
      ...prepPortions([
        { kind: 'prep', id: '1', prepId: 'riz', qty: 1.5 },
        ing('x', 'oeuf', 2),
        { kind: 'prep', id: '2', prepId: 'riz', qty: 0.5 },
      ]),
    ]).toEqual([['riz', 2]]);
  });
});

describe('« Extraire en préparation » and « Remplacer par ses ingrédients »', () => {
  const recipe: IngredientLine[] = [
    ing('a', 'viande', 500),
    ing('b', 'tomate', 0.7, 'kg'),
    ing('c', 'oignon', 1.5, 'pièce'),
    ing('d', 'pates', 400),
  ];
  it('extract: composition for one portion; the expansion is strictly the same', () => {
    for (const portions of [4, 3, 7, 1, 2.5]) {
      const r = extract(recipe.slice(0, 3), portions);
      if ('error' in r) throw new Error(r.error);
      const prep: PrepLike = {
        id: 'new',
        items: r.items.map((x, i) => ({ ...x, id: String(i) })),
      };
      const after: RecipeLine[] = [
        { kind: 'prep', id: 'p', prepId: 'new', qty: r.portions },
        recipe[3]!,
      ];
      expect(sorted(expandRecipe(after, new Map([['new', prep]])))).toEqual(
        sorted(expandRecipe(recipe, preps)),
      );
    }
    expect(extract([], 4)).toEqual({ error: 'Choisis au moins une ligne d’ingrédient.' });
  });
  it('an existing preparation with the same proportions: its portions; else none', () => {
    expect(matchingPortions(recipe.slice(0, 3), sauce)).toBe(4);
    expect(matchingPortions([recipe[2]!, recipe[0]!, recipe[1]!], sauce)).toBe(4);
    expect(matchingPortions(recipe.slice(0, 2), sauce)).toBeNull();
    expect(matchingPortions([ing('a', 'viande', 600), recipe[1]!, recipe[2]!], sauce)).toBeNull();
  });
  it('inline: the lines the preparation stands for (same expansion)', () => {
    const line = { kind: 'prep' as const, id: 'p', prepId: 'sauce', qty: 4 };
    const direct = inlinePrep(line, sauce).map((l, i) =>
      ing(`i${i}`, l.ingredientId, l.qty, l.unit),
    );
    expect(sorted(expandRecipe(direct, preps))).toEqual(sorted(expandRecipe([line], preps)));
  });
});

describe('names: ligatures and accents', () => {
  it('« oeuf » finds « Œuf », « ae » finds « æ »', () => {
    expect(fold('Œuf')).toBe('oeuf');
    expect(fold('Cæsar')).toBe('caesar');
    expect(fold('Crème brûlée')).toBe('creme brulee');
    const meals = [
      {
        name: 'Boîte riz-œufs',
        tags: [],
        items: [{ ingredientId: 'o' }],
        perServing: { cost: { euros: 1 }, nutrition: { values: { protein: 1 } } },
      },
    ];
    const names = new Map([['o', 'Œuf']]);
    expect(filterMeals(meals, names, { ...NO_FILTER, q: 'oeuf' })).toHaveLength(1);
    expect(filterMeals(meals, names, { ...NO_FILTER, q: 'œuf' })).toHaveLength(1);
    expect(filterMeals(meals, names, { ...NO_FILTER, q: 'riz-oeufs' })).toHaveLength(1);
  });
});
