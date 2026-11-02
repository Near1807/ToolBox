// Cookings of batch cooking, pure (tested in tests/batch-doubles.test.ts):
// the quantities of a cooking (the same functions on the server and the
// page, ingredients in the order of the lines of the preparation or recipe),
// and v0.29 « Doubles doses » (temps 2): when a meal is cooked at meal time,
// cook more for the next meals of the same element (preparation or whole
// recipe). Same window rules as the calculation (optionOf).
import { optionOf, type BatchMeal } from './batch';
import { addUp, formatAmount, plannedLines, type Line, type PieceWeights } from './quantities';
import { expandRecipe } from './recipe';
import type { BatchCookDto, BatchUseDto, CookBasis } from './types';

/** `prep:<id>` or `meal:<id>`: an element (what is cooked), the key of the calculation. */
export const cookKey = (c: Pick<BatchCookDto, 'prepId' | 'mealId'>) =>
  c.prepId ? `prep:${c.prepId}` : `meal:${c.mealId}`;

/** Portions added up without the floating point dust (shown rounded anyway). */
export const totalPortions = (uses: readonly { servings: number }[]) =>
  Math.round(uses.reduce((n, u) => n + u.servings, 0) * 1e9) / 1e9;

export interface IngredientFacts {
  names: Record<string, string>;
  pieces: Record<string, { unit: string; pieceG: number | null }>;
}

/**
 * The ingredient lines of a cooking for these portions: a preparation ×
 * portions (expandRecipe of one line), or the whole recipe scaled to them
 * (the list's own calculation).
 */
export function cookLines(basis: CookBasis, portions: number): Line[] {
  const items = basis.items.map((i, k) => ({ ...i, id: String(k) }));
  return basis.kind === 'prep'
    ? expandRecipe(
        [{ kind: 'prep', id: 'cook', prepId: 'p', qty: portions }],
        new Map([['p', { id: 'p', items }]]),
      )
    : plannedLines(
        [{ mealId: 'm', servings: portions }],
        new Map([['m', { id: 'm', servings: basis.servings, items }]]),
      );
}

/** Lines added up and written out, in the order the ingredients first appear (the recipe's order). */
export function amountsOf(
  lines: Line[],
  facts: IngredientFacts,
): { name: string; amount: string }[] {
  const pieces: PieceWeights = new Map(Object.entries(facts.pieces));
  const order = [...new Set(lines.map((l) => l.ingredientId))];
  return addUp(lines, pieces)
    .sort((a, b) => order.indexOf(a.ingredientId) - order.indexOf(b.ingredientId))
    .map((t) => ({
      name: facts.names[t.ingredientId] ?? 'Ingrédient supprimé',
      amount: t.amounts.map(formatAmount).join(' + '),
    }));
}

export const cookIngredients = (basis: CookBasis, portions: number, facts: IngredientFacts) =>
  amountsOf(cookLines(basis, portions), facts);

// --- Temps 2: « Doubles doses » ------------------------------------------------------

export interface DoubleCooking {
  /** The element (`prep:<id>` / `meal:<id>`) and the meal during which it is cooked. */
  key: string;
  opener: BatchMeal;
  /** The next meals it also covers (frozen: beyond the fridge days, taken out the evening before). */
  also: { meal: BatchMeal; frozen: boolean }[];
}

/**
 * For each element, its meals in time order: the first one not covered at
 * a moment when Thomas cooks opens a cooking (cooked during that meal); it
 * covers the next meals of the element while they are in its window (fridge;
 * freezer only with the option and a freezable element); then again from
 * the next meal not covered. Meals before any possible cooking are left out.
 * A cooking for one meal only is normal cooking: not returned.
 *
 * Fewest cookings: for the meals it covers, each cooking opens at the first
 * meal still uncovered, and a cooking opened later reaches at least as far
 * (its window starts later); so no plan covers them with fewer cookings
 * (tested against an exhaustive search).
 */
export function doubleDoses(
  couples: readonly BatchMeal[],
  cookMoments: ReadonlySet<string>,
  momentOrder: readonly string[],
  freezer: boolean,
): DoubleCooking[] {
  const at = (m: BatchMeal) =>
    `${m.date}|${String(momentOrder.indexOf(m.momentId)).padStart(3, '0')}`;
  const byKey = new Map<string, BatchMeal[]>();
  for (const c of couples)
    if (momentOrder.includes(c.momentId))
      byKey.set(c.recipeId, [...(byKey.get(c.recipeId) ?? []), c]);
  const out: DoubleCooking[] = [];
  for (const [key, list] of [...byKey].sort((a, b) => a[0].localeCompare(b[0]))) {
    const meals = [...list].sort(
      (a, b) => at(a).localeCompare(at(b)) || a.entryId.localeCompare(b.entryId),
    );
    let i = 0;
    while (i < meals.length) {
      const opener = meals[i]!;
      if (!cookMoments.has(opener.momentId)) {
        i++;
        continue;
      }
      const also: DoubleCooking['also'] = [];
      let j = i + 1;
      for (; j < meals.length; j++) {
        const o = optionOf(meals[j]!, opener, momentOrder, freezer);
        if (!o) break;
        also.push({ meal: meals[j]!, frozen: o.frozen });
      }
      if (also.length) out.push({ key, opener, also });
      i = j;
    }
  }
  return out.sort((a, b) => at(a.opener).localeCompare(at(b.opener)) || a.key.localeCompare(b.key));
}

/** The key of a double dose (validation checks the proposal did not change). */
export const doubleKey = (d: Pick<DoubleCooking, 'key'> & { opener: { entryId: string } }) =>
  `${d.key}|${d.opener.entryId}`;

// --- « pour : … », grouped by recipe ---------------------------------------------------

const shortDay = (date: string) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

/**
 * « Boîte riz-œufs — lun., mar., mer. midi · Chili — mer. soir »: the meals
 * of a cooking grouped by recipe, days abbreviated (one moment: said once).
 */
export function forLine(
  uses: readonly BatchUseDto[],
  momentNames: ReadonlyMap<string, string>,
): string {
  const moment = (id: string) => (momentNames.get(id) ?? '').toLowerCase();
  const groups = new Map<string, BatchUseDto[]>();
  for (const u of uses) groups.set(u.mealName ?? '', [...(groups.get(u.mealName ?? '') ?? []), u]);
  return [...groups]
    .map(([name, list]) => {
      const sorted = [...list].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          [...momentNames.keys()].indexOf(a.momentId) - [...momentNames.keys()].indexOf(b.momentId),
      );
      const one = new Set(sorted.map((u) => u.momentId)).size === 1;
      const days = one
        ? `${sorted.map((u) => shortDay(u.date)).join(', ')} ${moment(sorted[0]!.momentId)}`
        : sorted.map((u) => `${shortDay(u.date)} ${moment(u.momentId)}`).join(', ');
      return name ? `${name} — ${days}` : days;
    })
    .join(' · ');
}
