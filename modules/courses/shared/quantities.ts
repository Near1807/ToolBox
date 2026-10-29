// Quantities of the shopping list, pure (tested in tests/quantities.test.ts):
// units and their conversions (g ↔ kg, ml ↔ cl ↔ l), quantities scaled to
// the portions planned, added up per ingredient, grouped by aisle; pieces
// and weight added together when the ingredient has a piece weight.

export const UNITS = [
  'g',
  'kg',
  'ml',
  'cl',
  'l',
  'pièce',
  'c. à s.',
  'c. à c.',
  'pincée',
  'boîte',
  'sachet',
  'botte',
  'tranche',
] as const;
export type Unit = (typeof UNITS)[number] | string;

/** Units that convert into each other: their base unit and factor. */
const CONVERSIONS: Record<string, { base: string; factor: number }> = {
  g: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  cl: { base: 'ml', factor: 10 },
  l: { base: 'ml', factor: 1000 },
};

export function baseOf(unit: Unit): { base: string; factor: number } {
  return CONVERSIONS[unit] ?? { base: unit, factor: 1 };
}

/** The unit a total reads best in: 1 500 g → 1,5 kg ; 250 ml → 25 cl stays ml. */
export function display(baseQty: number, base: string): { qty: number; unit: string } {
  if (base === 'g' && baseQty >= 1000) return { qty: round(baseQty / 1000), unit: 'kg' };
  if (base === 'ml' && baseQty >= 1000) return { qty: round(baseQty / 1000), unit: 'l' };
  return { qty: round(baseQty), unit: base };
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A recipe line for a number of portions (the recipe is written for `recipeServings`). */
export function scale(qty: number, recipeServings: number, servings: number): number {
  if (!(recipeServings > 0)) return qty;
  return (qty * servings) / recipeServings;
}

export interface Line {
  ingredientId: string;
  qty: number;
  unit: Unit;
}

export interface Amount {
  qty: number;
  unit: string;
  /** The same in weight, for pieces counted from a weight (« ≈ 300 g »). */
  approx?: { qty: number; unit: string };
}
export interface Total {
  ingredientId: string;
  /** One amount per family of units (« 1,2 kg » and « 2 pièce » stay apart without a piece weight). */
  amounts: Amount[];
}

/** What turns pieces into weight for an ingredient: its unit and the weight of one piece (g). */
export type PieceWeights = Map<string, { unit: string; pieceG: number | null }>;

const isWeightOrVolume = (unit: string) => ['g', 'ml'].includes(baseOf(unit).base);

/**
 * Lines added up per ingredient, converting compatible units. With a piece
 * weight, pieces (or the ingredient's own count unit: boîte, sachet…) and
 * weights add up; the total is shown in the ingredient's unit (« 2,5 pièces
 * (≈ 300 g) », or « 300 g »).
 */
export function addUp(lines: Line[], pieces?: PieceWeights): Total[] {
  const byIngredient = new Map<string, Map<string, number>>();
  for (const l of lines) {
    if (!(l.qty > 0)) continue;
    const p = pieces?.get(l.ingredientId);
    const weighed =
      p?.pieceG &&
      p.pieceG > 0 &&
      !isWeightOrVolume(l.unit) &&
      (l.unit === 'pièce' || l.unit === p.unit);
    const { base, factor } = weighed ? { base: 'g', factor: p.pieceG! } : baseOf(l.unit);
    const families = byIngredient.get(l.ingredientId) ?? new Map<string, number>();
    families.set(base, (families.get(base) ?? 0) + l.qty * factor);
    byIngredient.set(l.ingredientId, families);
  }
  return [...byIngredient].map(([ingredientId, families]) => {
    const p = pieces?.get(ingredientId);
    return {
      ingredientId,
      amounts: [...families].map(([base, qty]): Amount => {
        if (base === 'g' && p?.pieceG && p.pieceG > 0 && !isWeightOrVolume(p.unit))
          return { qty: round(qty / p.pieceG), unit: p.unit, approx: display(qty, 'g') };
        return display(qty, base);
      }),
    };
  });
}

export interface PlannedMeal {
  mealId: string;
  servings: number;
}
export interface MealRecipe {
  id: string;
  servings: number;
  items: Line[];
}

/** Every planned meal's lines, scaled to its portions. */
export function plannedLines(plan: PlannedMeal[], meals: Map<string, MealRecipe>): Line[] {
  const lines: Line[] = [];
  for (const p of plan) {
    const meal = meals.get(p.mealId);
    if (!meal) continue;
    for (const item of meal.items)
      lines.push({ ...item, qty: scale(item.qty, meal.servings, p.servings) });
  }
  return lines;
}

/** « 1,5 kg », « 2 pièces », « 3 c. à s. », « 2,5 pièces (≈ 300 g) ». */
export function formatAmount(a: Amount): string {
  const qty = String(a.qty).replace('.', ',');
  const unit = a.unit === 'pièce' && a.qty > 1 ? 'pièces' : a.unit;
  return `${qty} ${unit}${a.approx ? ` (≈ ${formatAmount(a.approx)})` : ''}`;
}

/** Lower case, accents removed (search, duplicates). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
