// Batch cooking, pure (tested in tests/batch.test.ts): which cooking slots to
// use and what to cook at each, for the meals chosen. Exact: every minimum
// set of slots is found (search branching on the slots that can cover the
// first meal still uncovered), then the best one by the criteria, in this
// order:
//   1. cover as many chosen meals as possible;
//   2. with as few sessions as possible;
//   3. then as few cookings (a recipe once rather than in two sessions);
//   4. then as few portions in the freezer;
//   5. then cookings as close as possible to the meals.
// Deterministic: the inputs are sorted first, ties go to the earliest slots.
// The app never invents a keeping time: those are Thomas's (fridgeDays…).
//
// v0.27: the unit is the couple (what is cooked, planned meal). What is
// cooked is a PREPARATION of the recipe (a bolognaise: its sauce; its pasta,
// a direct line, is cooked at meal time and never reaches this file), or the
// whole recipe when it has no preparation (the v0.26 block, unchanged). A
// cooking is (session, preparation): the rice of two recipes cooked once.

export interface BatchMeal {
  /** Planned meal (courses__plan id). Two couples of one meal share it. */
  entryId: string;
  date: string;
  momentId: string;
  /** What is cooked: a preparation id, or the recipe id (a recipe without preparation). */
  recipeId: string;
  recipeName: string;
  /** Portions of what is cooked for this meal (decimal for a preparation). */
  servings: number;
  /** Days in the fridge once cooked (known: meals without it are left out before). */
  fridgeDays: number;
  freezable: boolean;
  /** Days in the freezer (null: unknown, the freezer is then not used for it). */
  freezerDays: number | null;
}
export interface BatchSlot {
  date: string;
  momentId: string;
}
export interface BatchInput {
  meals: BatchMeal[];
  slots: BatchSlot[];
  /** Moment ids in the order of the day (Matin, Midi…). */
  momentOrder: string[];
  freezer: boolean;
}
export interface BatchUse {
  entryId: string;
  date: string;
  momentId: string;
  servings: number;
}
export interface BatchCook {
  recipeId: string;
  recipeName: string;
  /** Portions to cook (all its meals' portions). */
  portions: number;
  fridge: BatchUse[];
  /** Portions frozen: eaten from the day after the cooking at the earliest (thawed the evening before). */
  frozen: BatchUse[];
}
export interface BatchSession extends BatchSlot {
  cooks: BatchCook[];
}
export interface BatchResult {
  sessions: BatchSession[];
  /** Chosen couples no slot can cover: to cook on the day, with the reason. */
  uncovered: { meal: BatchMeal; reason: string }[];
  covered: number;
  total: number;
  /** Too many combinations for an exact answer: nothing proposed (fewer slots needed). */
  tooComplex: boolean;
}

/** Search budget: beyond it, no answer rather than an approximate one. */
export const SEARCH_LIMIT = 400_000;

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

interface Option {
  slot: number;
  frozen: boolean;
  /** Distance from the cooking to the meal, in moments (days × moments + moment gap). */
  distance: number;
}

class TooComplex extends Error {}

/**
 * All the minimum sets of slots (sorted indexes) that cover every meal of
 * `meals` (each with its options), or [] when some meal has no option.
 */
function minimumCovers(options: Option[][], budget: { left: number }): number[][] {
  if (options.some((o) => o.length === 0)) return [];
  if (options.length === 0) return [[]];
  for (let size = 1; size <= options.length; size++) {
    const found = new Map<string, number[]>();
    const chosen: number[] = [];
    const search = () => {
      if (--budget.left < 0) throw new TooComplex();
      const open = options.findIndex((o) => !o.some((x) => chosen.includes(x.slot)));
      if (open === -1) {
        const key = [...chosen].sort((a, b) => a - b);
        found.set(key.join(','), key);
        return;
      }
      if (chosen.length === size) return;
      for (const { slot } of options[open]!) {
        chosen.push(slot);
        search();
        chosen.pop();
      }
    };
    search();
    if (found.size)
      return [...found.values()].sort((a, b) => {
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
        return 0;
      });
  }
  return [];
}

type Cost = [number, number, number];
const less = (a: Cost, b: Cost) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function planBatch(input: BatchInput): BatchResult {
  const order = new Map(input.momentOrder.map((id, i) => [id, i]));
  const width = Math.max(1, input.momentOrder.length);
  const at = (date: string, momentId: string) => dayNumber(date) * width + order.get(momentId)!;
  // Canonical order: same answer whatever the order the inputs came in.
  const slotKeys = new Map<string, BatchSlot>();
  for (const s of input.slots)
    if (order.has(s.momentId)) slotKeys.set(`${s.date}|${s.momentId}`, s);
  const slots = [...slotKeys.values()].sort(
    (a, b) => at(a.date, a.momentId) - at(b.date, b.momentId),
  );
  const meals = input.meals
    .filter((m) => order.has(m.momentId))
    .sort(
      (a, b) =>
        at(a.date, a.momentId) - at(b.date, b.momentId) ||
        a.entryId.localeCompare(b.entryId) ||
        a.recipeId.localeCompare(b.recipeId),
    );

  // Which slots can cover each meal (same moment of the same day included, an earlier one not).
  const options: Option[][] = meals.map((m) => {
    const freezerOn = input.freezer && m.freezable && m.freezerDays !== null;
    const reach = Math.max(m.fridgeDays, freezerOn ? m.freezerDays! : 0);
    return slots.flatMap((s, slot): Option[] => {
      const days = dayNumber(m.date) - dayNumber(s.date);
      if (days < 0 || (days === 0 && order.get(s.momentId)! > order.get(m.momentId)!)) return [];
      if (days > reach) return [];
      // Beyond the fridge days: frozen (so never eaten on the cooking day).
      return [
        {
          slot,
          frozen: days > m.fridgeDays,
          distance: at(m.date, m.momentId) - at(s.date, s.momentId),
        },
      ];
    });
  });

  const uncovered = meals.flatMap((m, i) =>
    options[i]!.length ? [] : [{ meal: m, reason: whyNot(m, slots, order, input.freezer) }],
  );
  const coverable = meals.map((_, i) => i).filter((i) => options[i]!.length > 0);
  const empty: BatchResult = {
    sessions: [],
    uncovered,
    covered: 0,
    total: meals.length,
    tooComplex: false,
  };
  if (!coverable.length) return empty;

  const budget = { left: SEARCH_LIMIT };
  try {
    // 1 and 2: every coverable meal, with as few sessions as possible.
    const covers = minimumCovers(
      coverable.map((i) => options[i]!),
      budget,
    );
    // 3 to 5, recipe by recipe (independent once the sessions are chosen).
    const recipes = new Map<string, number[]>();
    for (const i of coverable) {
      const list = recipes.get(meals[i]!.recipeId) ?? [];
      list.push(i);
      recipes.set(meals[i]!.recipeId, list);
    }
    let best: { cost: Cost; assign: Map<number, Option> } | null = null;
    for (const cover of covers) {
      const cost: Cost = [0, 0, 0];
      const assign = new Map<number, Option>();
      for (const list of recipes.values()) {
        const inCover = list.map((i) => options[i]!.filter((o) => cover.includes(o.slot)));
        let bestRecipe: { cost: Cost; picks: Option[] } | null = null;
        for (const used of minimumCovers(inCover, budget)) {
          // Each meal from the best of the sessions used: fridge first, then the closest.
          const picks = inCover.map(
            (o) =>
              o
                .filter((x) => used.includes(x.slot))
                .sort(
                  (a, b) =>
                    Number(a.frozen) - Number(b.frozen) ||
                    a.distance - b.distance ||
                    a.slot - b.slot,
                )[0]!,
          );
          const c: Cost = [
            used.length,
            picks.reduce((n, p, k) => n + (p.frozen ? meals[list[k]!]!.servings : 0), 0),
            picks.reduce((n, p) => n + p.distance, 0),
          ];
          if (!bestRecipe || less(c, bestRecipe.cost) < 0) bestRecipe = { cost: c, picks };
        }
        cost[0] += bestRecipe!.cost[0];
        cost[1] += bestRecipe!.cost[1];
        cost[2] += bestRecipe!.cost[2];
        bestRecipe!.picks.forEach((p, k) => assign.set(list[k]!, p));
      }
      if (!best || less(cost, best.cost) < 0) best = { cost, assign };
    }
    return { ...empty, ...describe(best!.assign, meals, slots), covered: coverable.length };
  } catch (error) {
    if (error instanceof TooComplex) return { ...empty, tooComplex: true };
    throw error;
  }
}

/** The sessions of an assignment, in time order, recipes by name. */
function describe(assign: Map<number, Option>, meals: BatchMeal[], slots: BatchSlot[]) {
  const bySlot = new Map<number, Map<string, BatchCook>>();
  for (const [i, option] of [...assign].sort((a, b) => a[0] - b[0])) {
    const m = meals[i]!;
    const cooks = bySlot.get(option.slot) ?? new Map<string, BatchCook>();
    const cook = cooks.get(m.recipeId) ?? {
      recipeId: m.recipeId,
      recipeName: m.recipeName,
      portions: 0,
      fridge: [],
      frozen: [],
    };
    cook.portions += m.servings;
    (option.frozen ? cook.frozen : cook.fridge).push({
      entryId: m.entryId,
      date: m.date,
      momentId: m.momentId,
      servings: m.servings,
    });
    cooks.set(m.recipeId, cook);
    bySlot.set(option.slot, cooks);
  }
  return {
    sessions: [...bySlot]
      .sort((a, b) => a[0] - b[0])
      .map(([slot, cooks]) => ({
        ...slots[slot]!,
        cooks: [...cooks.values()].sort(
          (a, b) =>
            a.recipeName.localeCompare(b.recipeName, 'fr') || a.recipeId.localeCompare(b.recipeId),
        ),
      })),
  };
}

/** Why no slot can cover a meal, in words. */
function whyNot(
  m: BatchMeal,
  slots: BatchSlot[],
  order: Map<string, number>,
  freezer: boolean,
): string {
  const day = dayNumber(m.date);
  const before = slots.filter((s) => {
    const d = dayNumber(s.date);
    return d < day || (d === day && order.get(s.momentId)! <= order.get(m.momentId)!);
  });
  if (!before.length) return 'aucun créneau de cuisine avant ce repas';
  const gap = day - Math.max(...before.map((s) => dayNumber(s.date)));
  const keeps = `se garde ${plural(m.fridgeDays, 'jour')} au frigo, dernier créneau ${plural(gap, 'jour')} avant`;
  if (!freezer) return `${keeps} (congélation désactivée)`;
  if (!m.freezable) return `${keeps} ; non congelable`;
  if (m.freezerDays === null) return `${keeps} ; durée au congélateur non renseignée`;
  return `se garde ${plural(m.fridgeDays, 'jour')} au frigo et ${plural(m.freezerDays, 'jour')} au congélateur, dernier créneau ${plural(gap, 'jour')} avant`;
}
