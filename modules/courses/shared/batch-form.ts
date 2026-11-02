// Temps 1 of the batch form (v0.29: « Éléments de base »), pure (tested in
// tests/batch-form.test.ts). The selection holds couples `entryId|prepId`
// (`entryId|*` for a recipe cooked whole), the unit of the calculation. The
// form lists ELEMENTS: each preparation and each recipe not split used in
// the period, by number of meals; an element ticked = all its meals not yet
// covered, each meal can be left out. Pre-ticked: the elements of the last
// validated plan. The tag « batch » no longer pre-ticks anything.
import type { BatchEntryDto, BatchPartDto } from './types';

export const coupleKey = (entryId: string, prepId: string | null) => `${entryId}|${prepId ?? '*'}`;
export const elementKey = (p: Pick<BatchPartDto, 'prepId' | 'mealId'>) =>
  p.prepId ? `prep:${p.prepId}` : `meal:${p.mealId}`;

export interface ElementMeal {
  entry: BatchEntryDto;
  part: BatchPartDto;
  /** Covered by a validated plan: shown, not tickable. */
  covered: boolean;
}
export interface Element {
  key: string;
  name: string;
  prepId: string | null;
  mealId: string;
  /** Keeping known (else: said, not tickable, link to its sheet). */
  keepKnown: boolean;
  meals: ElementMeal[];
}

/** The elements of the meals shown (from `minDate`), by number of meals, then name. */
export function elementsOf(entries: readonly BatchEntryDto[], minDate = ''): Element[] {
  const byKey = new Map<string, Element>();
  for (const entry of entries) {
    if (entry.date < minDate) continue;
    for (const part of entry.parts) {
      const key = elementKey(part);
      const el = byKey.get(key) ?? {
        key,
        name: part.name,
        prepId: part.prepId,
        mealId: part.mealId,
        keepKnown: part.fridgeDays !== null,
        meals: [],
      };
      el.meals.push({ entry, part, covered: Boolean(part.coveredBy) || entry.coveredBy !== null });
      byKey.set(key, el);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.meals.length - a.meals.length || a.name.localeCompare(b.name, 'fr'),
  );
}

const free = (el: Element) => (el.keepKnown ? el.meals.filter((m) => !m.covered) : []);
const keysOf = (el: Element) => free(el).map((m) => coupleKey(m.entry.entryId, m.part.prepId));

/** Pre-ticked: the elements ticked in the last validated plan (none the first time). */
export function initialSelection(
  entries: readonly BatchEntryDto[],
  lastElements: readonly string[],
  minDate = '',
): Set<string> {
  const last = new Set(lastElements);
  return new Set(
    elementsOf(entries, minDate)
      .filter((el) => last.has(el.key))
      .flatMap(keysOf),
  );
}
export const selectAll = (entries: readonly BatchEntryDto[], minDate = '') =>
  new Set(elementsOf(entries, minDate).flatMap(keysOf));
export const selectNone = (): Set<string> => new Set();

/** The whole element (all its free meals), some of them, or nothing. */
export function elementState(
  selection: ReadonlySet<string>,
  el: Element,
): 'all' | 'partial' | 'none' {
  const keys = keysOf(el);
  const n = keys.filter((k) => selection.has(k)).length;
  return n === 0 ? 'none' : n === keys.length ? 'all' : 'partial';
}
/** An element ticked: none → all its free meals; all or some → none. */
export function toggleElement(selection: ReadonlySet<string>, el: Element): Set<string> {
  const next = new Set(selection);
  const keys = keysOf(el);
  if (elementState(selection, el) === 'none') keys.forEach((k) => next.add(k));
  else keys.forEach((k) => next.delete(k));
  return next;
}
/** One meal of an element left out (or put back). */
export function toggleMeal(selection: ReadonlySet<string>, m: ElementMeal): Set<string> {
  const next = new Set(selection);
  const k = coupleKey(m.entry.entryId, m.part.prepId);
  if (next.has(k)) next.delete(k);
  else if (!m.covered && m.part.fridgeDays !== null) next.add(k);
  return next;
}

/**
 * What the calculation receives: the couples ticked (keeping known, not
 * covered, shown from `minDate`) and the meals they belong to.
 */
export function forCalculation(
  entries: readonly BatchEntryDto[],
  selection: ReadonlySet<string>,
  minDate = '',
): { entryIds: string[]; couples: { entryId: string; prepId: string | null }[] } {
  const couples = elementsOf(entries, minDate).flatMap((el) =>
    free(el)
      .filter((m) => selection.has(coupleKey(m.entry.entryId, m.part.prepId)))
      .map((m) => ({ entryId: m.entry.entryId, prepId: m.part.prepId })),
  );
  return { entryIds: [...new Set(couples.map((c) => c.entryId))], couples };
}
