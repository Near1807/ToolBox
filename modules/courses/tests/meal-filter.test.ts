// The filters of the recipes: one function for the « Repas » tab and the meal
// picker of the planning (both import shared/meal-filter.ts), so the same
// choices always show the same recipes in both places.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { filterMeals, NO_FILTER, type FilterableMeal } from '../shared/meal-filter';

const meal = (
  name: string,
  tags: string[],
  euros: number,
  protein: number,
  ingredients: string[] = [],
  keep: { fridgeDays?: number | null; freezable?: boolean } = {},
): FilterableMeal & { name: string } => ({
  name,
  tags,
  items: ingredients.map((ingredientId) => ({ ingredientId })),
  perServing: { cost: { euros }, nutrition: { values: { protein } } },
  ...keep,
});
const names = new Map([
  ['riz', 'Riz arborio'],
  ['oeuf', 'Œuf'],
]);
const meals = [
  meal('Risotto', ['vg'], 0.9, 6, ['riz'], { fridgeDays: 2 }),
  meal('Omelette', ['rapide', 'protéiné'], 1.2, 23, ['oeuf']),
  meal('Curry de pois chiches', ['vg', 'batch'], 0.7, 16, [], { fridgeDays: 3, freezable: true }),
  meal('Crêpes', ['dessert'], 0.4, 5),
];
const shown = (f: Partial<typeof NO_FILTER>) =>
  filterMeals(meals, names, { ...NO_FILTER, ...f }).map((m) => m.name);

describe('meal filters (tab « Repas » and planning picker)', () => {
  it('search in the name, the tags and the ingredients, accents and case ignored', () => {
    expect(shown({})).toEqual(['Risotto', 'Omelette', 'Curry de pois chiches', 'Crêpes']);
    expect(shown({ q: 'CREPE' })).toEqual(['Crêpes']);
    expect(shown({ q: 'œuf' })).toEqual(['Omelette']);
    expect(shown({ q: 'arborio' })).toEqual(['Risotto']);
    expect(shown({ q: 'proteine' })).toEqual(['Omelette']);
  });
  it('tag, maximum cost (comma accepted), sort', () => {
    expect(shown({ tag: 'vg' })).toEqual(['Risotto', 'Curry de pois chiches']);
    expect(shown({ maxCost: '0,8' })).toEqual(['Curry de pois chiches', 'Crêpes']);
    expect(shown({ sort: 'cost' })).toEqual([
      'Crêpes',
      'Curry de pois chiches',
      'Risotto',
      'Omelette',
    ]);
    expect(shown({ sort: 'protein' })[0]).toBe('Omelette');
  });
  it('keeping: known, missing, freezable', () => {
    expect(shown({ keep: 'known' })).toEqual(['Risotto', 'Curry de pois chiches']);
    expect(shown({ keep: 'missing' })).toEqual(['Omelette', 'Crêpes']);
    expect(shown({ keep: 'freezable' })).toEqual(['Curry de pois chiches']);
  });
  it('the tab and the picker use this very function and the same filter component', () => {
    for (const file of ['index.tsx', 'MealPicker.tsx']) {
      const code = readFileSync(path.join(__dirname, '../frontend', file), 'utf8');
      expect(code).toContain('filterMeals(');
      expect(code).toContain('<MealFilters');
    }
  });
});
