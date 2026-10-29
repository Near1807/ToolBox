// Quantities of the shopping list: conversions, portions, totals.
import { describe, expect, it } from 'vitest';
import { addUp, formatAmount, plannedLines, scale, type MealRecipe } from '../shared/quantities';

describe('quantities', () => {
  it('compatible units are added and shown in the best unit', () => {
    expect(
      addUp([
        { ingredientId: 'riz', qty: 800, unit: 'g' },
        { ingredientId: 'riz', qty: 0.5, unit: 'kg' },
        { ingredientId: 'lait', qty: 50, unit: 'cl' },
        { ingredientId: 'lait', qty: 750, unit: 'ml' },
        { ingredientId: 'oeuf', qty: 2, unit: 'pièce' },
        { ingredientId: 'oeuf', qty: 3, unit: 'pièce' },
      ]),
    ).toEqual([
      { ingredientId: 'riz', amounts: [{ qty: 1.3, unit: 'kg' }] },
      { ingredientId: 'lait', amounts: [{ qty: 1.25, unit: 'l' }] },
      { ingredientId: 'oeuf', amounts: [{ qty: 5, unit: 'pièce' }] },
    ]);
  });
  it('incompatible units stay apart', () => {
    expect(
      addUp([
        { ingredientId: 'ail', qty: 2, unit: 'pièce' },
        { ingredientId: 'ail', qty: 10, unit: 'g' },
      ]),
    ).toEqual([
      {
        ingredientId: 'ail',
        amounts: [
          { qty: 2, unit: 'pièce' },
          { qty: 10, unit: 'g' },
        ],
      },
    ]);
  });
  it('quantities follow the portions planned', () => {
    expect(scale(300, 4, 2)).toBe(150);
    expect(scale(300, 0, 2)).toBe(300);
    const risotto: MealRecipe = {
      id: 'risotto',
      servings: 4,
      items: [
        { ingredientId: 'riz', qty: 320, unit: 'g' },
        { ingredientId: 'bouillon', qty: 1, unit: 'l' },
      ],
    };
    const lines = plannedLines(
      [
        { mealId: 'risotto', servings: 2 },
        { mealId: 'risotto', servings: 1 },
        { mealId: 'inconnu', servings: 3 },
      ],
      new Map([['risotto', risotto]]),
    );
    expect(addUp(lines)).toEqual([
      { ingredientId: 'riz', amounts: [{ qty: 240, unit: 'g' }] },
      { ingredientId: 'bouillon', amounts: [{ qty: 750, unit: 'ml' }] },
    ]);
  });
  it('reads in French', () => {
    expect(formatAmount({ qty: 1.5, unit: 'kg' })).toBe('1,5 kg');
    expect(formatAmount({ qty: 3, unit: 'pièce' })).toBe('3 pièces');
  });
});
