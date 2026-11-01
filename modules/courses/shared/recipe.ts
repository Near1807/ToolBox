// The structure of a recipe (v0.27): its lines are ingredients or
// preparations (« Sauce bolognaise × 4 portions »), and a preparation is a
// list of ingredients for ONE portion (shared by several recipes, like the
// technical sheets of a kitchen). Pure, tested in tests/recipe.test.ts.
//
// THE rule: everything the module computes from the ingredients of a recipe
// (nutrition, cost, list, summary, history, batch quantities, filters,
// assistant) reads `expandRecipe` and only it. A line « preparation × q »
// behaves exactly like an ingredient line: q is what the WHOLE recipe needs
// (for its servings); scaling to the portions planned is the usual one,
// applied to the result. Only the recipe editor and the import / export read
// the raw lines.
import type { Line } from './quantities';

export interface IngredientLine {
  kind: 'ingredient';
  id: string;
  ingredientId: string;
  qty: number;
  unit: string;
}
export interface PrepLine {
  kind: 'prep';
  id: string;
  prepId: string;
  /** Portions of the preparation for the whole recipe (decimal > 0). */
  qty: number;
}
export type RecipeLine = IngredientLine | PrepLine;

export interface PrepItem {
  id: string;
  ingredientId: string;
  /** For ONE portion of the preparation. */
  qty: number;
  unit: string;
}
export interface PrepLike {
  id: string;
  items: PrepItem[];
}

export interface ExpandedLine extends Line {
  /** Unique within the recipe (the line's id, or line:item for a preparation). */
  id: string;
  /** The preparation line it comes from (null: a direct line). */
  fromLine: string | null;
}

/**
 * A product of decimals (portion × quantity for one portion) without the
 * floating point dust: 320 / 3 × 3 gives 320, not 320.00000000000006. Nine
 * decimals kept (quantities are typed with far fewer); applied only to the
 * quantities coming from a preparation, never to a direct line, never stored.
 */
export const product = (a: number, b: number) => Math.round(a * b * 1e9) / 1e9;

/**
 * The ingredients of a recipe, line by line, in the order of the recipe: a
 * direct line as it is, a preparation line replaced by its ingredients × its
 * portions. The same ingredient direct and in a preparation stays two lines
 * (added up like any two lines by the list and the facts).
 */
export function expandRecipe(
  lines: readonly RecipeLine[],
  preps: ReadonlyMap<string, PrepLike>,
): ExpandedLine[] {
  return lines.flatMap((line): ExpandedLine[] => {
    if (line.kind === 'ingredient')
      return [
        {
          id: line.id,
          ingredientId: line.ingredientId,
          qty: line.qty,
          unit: line.unit,
          fromLine: null,
        },
      ];
    const prep = preps.get(line.prepId);
    if (!prep) return [];
    return prep.items.map((item) => ({
      id: `${line.id}:${item.id}`,
      ingredientId: item.ingredientId,
      qty: product(item.qty, line.qty),
      unit: item.unit,
      fromLine: line.id,
    }));
  });
}

/** The recipe is split in preparations (its direct lines are then « at meal time »). */
export const isSplit = (lines: readonly RecipeLine[]) => lines.some((l) => l.kind === 'prep');

/** Portions of each preparation for the whole recipe (a preparation on two lines: added up). */
export function prepPortions(lines: readonly RecipeLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) if (l.kind === 'prep') out.set(l.prepId, (out.get(l.prepId) ?? 0) + l.qty);
  return out;
}

// --- « Extraire en préparation » and « Remplacer par ses ingrédients » --------------

export interface Extraction {
  /** Composition for one portion (new preparation), or null when an existing one is used. */
  items: { ingredientId: string; qty: number; unit: string }[];
  /** The line that replaces the lines taken (portions for the whole recipe). */
  portions: number;
}

/**
 * The lines taken out of a recipe into a preparation of `portions` portions:
 * the composition for one portion, checked so that the recipe expands
 * EXACTLY as before (refused otherwise, never approximated).
 */
export function extract(
  taken: readonly IngredientLine[],
  portions: number,
): Extraction | { error: string } {
  if (!taken.length) return { error: 'Choisis au moins une ligne d’ingrédient.' };
  if (!(portions > 0)) return { error: 'Nombre de portions invalide.' };
  const items = taken.map((l) => ({
    ingredientId: l.ingredientId,
    qty: l.qty / portions,
    unit: l.unit,
  }));
  if (items.some((it, i) => product(it.qty, portions) !== taken[i]!.qty))
    return { error: 'Ces quantités ne se divisent pas exactement : choisis un autre nombre.' };
  return { items, portions };
}

const key = (l: { ingredientId: string; unit: string }) => `${l.ingredientId}|${l.unit}`;

/**
 * Portions of an existing preparation that give exactly the lines taken
 * (same ingredients and units, same proportions), or null.
 */
export function matchingPortions(taken: readonly IngredientLine[], prep: PrepLike): number | null {
  if (!taken.length || taken.length !== prep.items.length) return null;
  const left = [...prep.items];
  const pairs: [IngredientLine, PrepItem][] = [];
  for (const l of taken) {
    const at = left.findIndex((p) => key(p) === key(l));
    if (at === -1) return null;
    pairs.push([l, left.splice(at, 1)[0]!]);
  }
  const [first, firstItem] = pairs[0]!;
  const portions = first.qty / firstItem.qty;
  if (!(portions > 0) || !Number.isFinite(portions)) return null;
  return pairs.every(([l, p]) => product(p.qty, portions) === l.qty) ? portions : null;
}

/** « Remplacer par ses ingrédients »: the direct lines a preparation line stands for. */
export function inlinePrep(
  line: PrepLine,
  prep: PrepLike,
): { ingredientId: string; qty: number; unit: string }[] {
  return prep.items.map((item) => ({
    ingredientId: item.ingredientId,
    qty: product(item.qty, line.qty),
    unit: item.unit,
  }));
}
