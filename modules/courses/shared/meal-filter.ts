// The filters of the recipes, pure (tested in tests/meal-filter.test.ts): the
// same logic for the « Repas » tab and the meal picker of the planning, so
// that both always show the same recipes for the same choices.
import { fold } from './quantities';

export type MealSort = 'name' | 'cost' | 'protein';
/** Keeping (batch cooking): any, fridge days known, missing, freezable. */
export type KeepFilter = 'all' | 'known' | 'missing' | 'freezable';

export interface MealFilter {
  /** Searched in the name, the tags and the ingredients (accents and case ignored). */
  q: string;
  tag: string | null;
  /** Maximum cost per portion (€, comma accepted); empty: none. */
  maxCost: string;
  sort: MealSort;
  keep: KeepFilter;
}

export const NO_FILTER: MealFilter = { q: '', tag: null, maxCost: '', sort: 'name', keep: 'all' };

export interface FilterableMeal {
  name: string;
  tags: string[];
  items: { ingredientId: string }[];
  perServing: { cost: { euros: number }; nutrition: { values: { protein: number } } };
  fridgeDays?: number | null;
  freezable?: boolean;
  /** Keeping as the batch sees it (a split recipe: its preparations'); else the two fields above. */
  keeping?: { known: boolean; freezable: boolean };
}

const keepingOf = (m: FilterableMeal) =>
  m.keeping ?? { known: (m.fridgeDays ?? null) !== null, freezable: Boolean(m.freezable) };

/** The recipes shown for these choices, in the order chosen (name order kept for ties). */
export function filterMeals<M extends FilterableMeal>(
  meals: readonly M[],
  ingredientNames: ReadonlyMap<string, string>,
  filter: MealFilter,
): M[] {
  const limit = Number(filter.maxCost.replace(',', '.'));
  const q = fold(filter.q);
  return meals
    .filter(
      (m) =>
        (!filter.tag || m.tags.includes(filter.tag)) &&
        (!filter.maxCost.trim() || !(limit >= 0) || m.perServing.cost.euros <= limit) &&
        (filter.keep === 'all' ||
          (filter.keep === 'known' && keepingOf(m).known) ||
          (filter.keep === 'missing' && !keepingOf(m).known) ||
          (filter.keep === 'freezable' && keepingOf(m).freezable)) &&
        fold(
          `${m.name} ${m.tags.join(' ')} ${m.items.map((i) => ingredientNames.get(i.ingredientId)).join(' ')}`,
        ).includes(q),
    )
    .sort((a, b) =>
      filter.sort === 'cost'
        ? a.perServing.cost.euros - b.perServing.cost.euros
        : filter.sort === 'protein'
          ? b.perServing.nutrition.values.protein - a.perServing.nutrition.values.protein
          : 0,
    );
}
