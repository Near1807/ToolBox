// Nutrition and estimated cost, pure (tested in tests/nutrition.test.ts).
// An ingredient may give its values for 100 g (or 100 ml), the average
// weight of one piece, and a reference price per kg, per litre or per piece.
// A recipe line is converted when it can be (g ↔ kg, ml ↔ cl ↔ l, piece ↔
// weight with the piece weight); what cannot be counted is reported, never
// guessed. Facts only: no advice.
import { baseOf } from './quantities';

export const NUTRIENTS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protéines', unit: 'g' },
  { key: 'carbs', label: 'Glucides', unit: 'g' },
  { key: 'sugars', label: 'dont sucres', unit: 'g' },
  { key: 'fat', label: 'Lipides', unit: 'g' },
  { key: 'saturated', label: 'dont saturés', unit: 'g' },
  { key: 'fiber', label: 'Fibres', unit: 'g' },
  { key: 'salt', label: 'Sel', unit: 'g' },
] as const;
export type NutrientKey = (typeof NUTRIENTS)[number]['key'];
export type Nutrition = Partial<Record<NutrientKey, number>>;
export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key) as NutrientKey[];

export type PricePer = 'kg' | 'l' | 'pièce';
export const PRICE_PER: PricePer[] = ['kg', 'l', 'pièce'];

/** What is known of an ingredient for the calculations. */
export interface IngredientFacts {
  id: string;
  name: string;
  /** Its usual unit (g, ml, pièce, boîte…). */
  unit: string;
  /** Average weight of one piece (or one box, one bag…), in grams. */
  pieceG: number | null;
  /** Values for 100 g, or for 100 ml (`nutritionPer`). */
  nutrition: Nutrition;
  nutritionPer: '100g' | '100ml';
  price: number | null;
  pricePer: PricePer | null;
}

/** The nutrition basis of an ingredient from its unit: 100 ml for a liquid, else 100 g. */
export function defaultNutritionPer(unit: string): '100g' | '100ml' {
  return baseOf(unit).base === 'ml' ? '100ml' : '100g';
}

/** A count unit: not a weight nor a volume (pièce, boîte, sachet, tranche…). */
const isCount = (unit: string) => !['g', 'ml'].includes(baseOf(unit).base);
/** Units that cannot be turned into a weight even with a piece weight. */
const SPOONS = new Set(['c. à s.', 'c. à c.', 'pincée']);

/**
 * A quantity in grams, millilitres and pieces, as far as it converts: a
 * count unit (pièce, or the ingredient's own count unit) becomes grams with
 * the piece weight, grams become pieces the same way.
 */
export function measure(
  qty: number,
  unit: string,
  facts: Pick<IngredientFacts, 'unit' | 'pieceG'>,
): { g?: number; ml?: number; pieces?: number } {
  const { base, factor } = baseOf(unit);
  const w = facts.pieceG && facts.pieceG > 0 ? facts.pieceG : null;
  if (base === 'g') return { g: qty * factor, ...(w ? { pieces: (qty * factor) / w } : {}) };
  if (base === 'ml') return { ml: qty * factor };
  if (SPOONS.has(unit)) return {};
  if (unit === 'pièce' || unit === facts.unit) return { pieces: qty, ...(w ? { g: qty * w } : {}) };
  return {};
}

export interface Facts {
  values: Record<NutrientKey, number>;
  /** Ingredients (names) not fully counted: no values, a value left blank, or a unit that does not convert. */
  missing: string[];
}

const zero = (): Record<NutrientKey, number> =>
  Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as Record<NutrientKey, number>;

/** Nutrition of lines (already scaled to the portions wanted). */
export function nutritionOf(
  lines: { ingredientId: string; qty: number; unit: string }[],
  facts: Map<string, IngredientFacts>,
): Facts {
  const values = zero();
  const missing = new Set<string>();
  for (const l of lines) {
    const f = facts.get(l.ingredientId);
    if (!f) continue;
    const m = measure(l.qty, l.unit, f);
    const amount = f.nutritionPer === '100ml' ? m.ml : m.g;
    const known = NUTRIENT_KEYS.filter((k) => typeof f.nutrition[k] === 'number');
    if (amount === undefined || known.length === 0) {
      missing.add(f.name);
      continue;
    }
    if (known.length < NUTRIENT_KEYS.length) missing.add(f.name);
    for (const k of known) values[k] += (f.nutrition[k]! * amount) / 100;
  }
  return {
    values: roundAll(values),
    missing: [...missing].sort((a, b) => a.localeCompare(b, 'fr')),
  };
}

export interface Cost {
  euros: number;
  /** Ingredients (names) without a price, or whose quantity does not convert to the price's unit. */
  missing: string[];
}

/** Estimated cost of lines: the quantities used, not the packets bought. */
export function costOf(
  lines: { ingredientId: string; qty: number; unit: string }[],
  facts: Map<string, IngredientFacts>,
): Cost {
  let euros = 0;
  const missing = new Set<string>();
  for (const l of lines) {
    const f = facts.get(l.ingredientId);
    if (!f) continue;
    if (f.price === null || !f.pricePer) {
      missing.add(f.name);
      continue;
    }
    const m = measure(l.qty, l.unit, f);
    const amount =
      f.pricePer === 'kg'
        ? m.g !== undefined
          ? m.g / 1000
          : undefined
        : f.pricePer === 'l'
          ? m.ml !== undefined
            ? m.ml / 1000
            : undefined
          : m.pieces;
    if (amount === undefined) {
      missing.add(f.name);
      continue;
    }
    euros += f.price * amount;
  }
  return {
    euros: Math.round(euros * 100) / 100,
    missing: [...missing].sort((a, b) => a.localeCompare(b, 'fr')),
  };
}

function roundAll(values: Record<NutrientKey, number>): Record<NutrientKey, number> {
  const out = { ...values };
  for (const k of NUTRIENT_KEYS) out[k] = Math.round(out[k] * 10) / 10;
  return out;
}

/** Adds facts together (a day from its meals, a week from its days). */
export function sumFacts(list: Facts[]): Facts {
  const values = zero();
  const missing = new Set<string>();
  for (const f of list) {
    for (const k of NUTRIENT_KEYS) values[k] += f.values[k];
    for (const m of f.missing) missing.add(m);
  }
  return {
    values: roundAll(values),
    missing: [...missing].sort((a, b) => a.localeCompare(b, 'fr')),
  };
}

/** « 12,50 € ». */
export function formatEuros(euros: number): string {
  return `${euros.toFixed(2).replace('.', ',')} €`;
}

/** Counted as a count unit (to show « 2,5 pièces (≈ 300 g) » in the list). */
export { isCount };
