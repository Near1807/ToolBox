// « Pourrait aussi servir » (v0.28), pure (tested in tests/batch-suggest.test.ts):
// a cooking already in a proposal (session S, preparation P or whole recipe
// R) can cover more planned meals by cooking a little more. A PURE GAIN: a
// suggestion only grows a cooking that is there; never a new session, never
// a new cooking in a session, never another slot. Same rules as the
// calculation (optionOf): slot rule, fridge window, freezer window only with
// the freezer on and P (or R) freezable, never eaten on the cooking day.
// Matched by preparation (or identical whole recipe) only, never by raw
// ingredient. A couple that several cookings could take is suggested once,
// under the one the criteria prefer: no freezer first, then the closest to the
// meal, then the earliest session.
import { optionOf, type BatchMeal } from './batch';
import { addUp, formatAmount, plannedLines, type Line, type PieceWeights } from './quantities';
import { expandRecipe } from './recipe';
import type {
  BatchAdditionDto,
  BatchCookDto,
  BatchProposalDto,
  BatchSuggestionDto,
  BatchUseDto,
  CookBasis,
} from './types';

/** `prep:<id>` or `meal:<id>`: what a cooking is about (the key of the calculation). */
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
 * The quantities of a cooking for these portions: a preparation × portions
 * (expandRecipe of one line), or the whole recipe scaled to them (the list's
 * own calculation). Used by the server and by the page: the same figures.
 */
export function cookIngredients(
  basis: CookBasis,
  portions: number,
  facts: IngredientFacts,
): { name: string; amount: string }[] {
  const items = basis.items.map((i, k) => ({ ...i, id: String(k) }));
  const lines: Line[] =
    basis.kind === 'prep'
      ? expandRecipe(
          [{ kind: 'prep', id: 'cook', prepId: 'p', qty: portions }],
          new Map([['p', { id: 'p', items }]]),
        )
      : plannedLines(
          [{ mealId: 'm', servings: portions }],
          new Map([['m', { id: 'm', servings: basis.servings, items }]]),
        );
  const pieces: PieceWeights = new Map(Object.entries(facts.pieces));
  return addUp(lines, pieces)
    .map((t) => ({
      name: facts.names[t.ingredientId] ?? 'Ingrédient supprimé',
      amount: t.amounts.map(formatAmount).join(' + '),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export interface CookPlace {
  date: string;
  momentId: string;
  /** cookKey of the cooking. */
  key: string;
}
export type Candidate = BatchMeal & { mealName: string };

/**
 * For each cooking (same order as `cooks`), the couples it could also
 * cover. `candidates`: couples planned in the period (or the days before it
 * allowed), not ticked for that preparation, not covered by a validated plan,
 * with their keeping (recipeId = the cooking key).
 */
export function suggest(
  cooks: readonly CookPlace[],
  candidates: readonly Candidate[],
  momentOrder: readonly string[],
  freezer: boolean,
): BatchSuggestionDto[][] {
  const out: BatchSuggestionDto[][] = cooks.map(() => []);
  const rank = (c: CookPlace) =>
    `${c.date}|${String(momentOrder.indexOf(c.momentId)).padStart(3, '0')}`;
  for (const m of candidates) {
    let best: { index: number; frozen: boolean; distance: number } | null = null;
    cooks.forEach((c, index) => {
      if (c.key !== m.recipeId) return;
      const o = optionOf(m, c, momentOrder, freezer);
      if (!o) return;
      const b = best as { index: number; frozen: boolean; distance: number } | null;
      const better =
        !b ||
        (o.frozen !== b.frozen
          ? !o.frozen
          : o.distance !== b.distance
            ? o.distance < b.distance
            : rank(c) < rank(cooks[b.index]!));
      if (better) best = { index, ...o };
    });
    if (!best) continue;
    const chosen = best as { index: number; frozen: boolean };
    out[chosen.index]!.push({
      entryId: m.entryId,
      date: m.date,
      momentId: m.momentId,
      servings: m.servings,
      mealName: m.mealName,
      frozen: chosen.frozen,
    });
  }
  const time = (u: BatchUseDto) =>
    `${u.date}|${String(momentOrder.indexOf(u.momentId)).padStart(3, '0')}|${u.entryId}`;
  for (const list of out) list.sort((a, b) => time(a).localeCompare(time(b)));
  return out;
}

/**
 * The proposal shown after « Ajouter »: the base proposal (as computed)
 * with these additions, each moved from the suggestions of its cooking into
 * its fridge or freezer uses, the portions and the quantities recomputed,
 * nothing else touched. « Retirer » = the same base with one addition less:
 * exactly the state before. Throws when an addition is not a suggestion of
 * the base (the proposal changed).
 */
export function withAdditions(
  base: BatchProposalDto,
  additions: readonly BatchAdditionDto[],
  momentOrder: readonly string[],
): BatchProposalDto {
  if (!additions.length) return base;
  const time = (u: BatchUseDto) =>
    `${u.date}|${String(momentOrder.indexOf(u.momentId)).padStart(3, '0')}`;
  const facts = base.facts ?? { names: {}, pieces: {} };
  const sessions = base.sessions.map((s) => ({
    ...s,
    cooks: s.cooks.map((c) => ({
      ...c,
      fridge: [...c.fridge],
      frozen: [...c.frozen],
      suggestions: [...(c.suggestions ?? [])],
      usedIn: [...c.usedIn],
    })),
  }));
  const touched = new Set<BatchCookDto>();
  for (const a of additions) {
    const session = sessions.find((s) => s.date === a.date && s.momentId === a.momentId);
    const cook = session?.cooks.find((c) => cookKey(c) === a.cook);
    const at = cook?.suggestions.findIndex((x) => x.entryId === a.entryId) ?? -1;
    if (!cook || at < 0) throw new Error('La proposition a changé : recalcule.');
    const [sug] = cook.suggestions.splice(at, 1);
    const use: BatchUseDto = {
      entryId: sug!.entryId,
      date: sug!.date,
      momentId: sug!.momentId,
      servings: sug!.servings,
      mealName: sug!.mealName,
      added: true,
    };
    (sug!.frozen ? cook.frozen : cook.fridge).push(use);
    if (!cook.usedIn.includes(sug!.mealName)) cook.usedIn.push(sug!.mealName);
    touched.add(cook);
  }
  for (const cook of touched) {
    // Stable: the uses of the calculation keep their order, an addition goes at its time.
    cook.fridge.sort((a, b) => time(a).localeCompare(time(b)));
    cook.frozen.sort((a, b) => time(a).localeCompare(time(b)));
    cook.usedIn.sort((a, b) => a.localeCompare(b, 'fr'));
    cook.portions = totalPortions([...cook.fridge, ...cook.frozen]);
    if (cook.basis) cook.ingredients = cookIngredients(cook.basis, cook.portions, facts);
  }
  return {
    ...base,
    sessions,
    covered: base.covered + additions.length,
    total: base.total + additions.length,
  };
}
