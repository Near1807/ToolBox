// The ticks of the batch form (step 1), pure (tested in tests/batch-form.test.ts).
// v0.28: a meal is included preparation by preparation (the unit of the
// calculation): the selection holds couples `entryId|prepId` (`entryId|*`
// for a recipe cooked whole). The whole meal ticked = all its parts not yet
// covered; unticked = none; some = partial (« Riz cuit seulement »), e.g.
// after « Ajouter » a suggestion. Pre-ticked by the tag « batch »; meals
// already covered never tickable; meals before the period never pre-ticked.
import type { BatchEntryDto, BatchPartDto } from './types';

export const partKey = (p: Pick<BatchPartDto, 'prepId'>) => p.prepId ?? '*';
export const coupleKey = (entryId: string, prepId: string | null) => `${entryId}|${prepId ?? '*'}`;

/** Parts of a meal that can be ticked: not covered by a validated plan. */
const freeParts = (e: BatchEntryDto) => e.parts.filter((p) => !p.coveredBy);
const free = (entries: readonly BatchEntryDto[]) =>
  entries.filter((e) => e.coveredBy === null && freeParts(e).length > 0);
const inPeriod = (entries: readonly BatchEntryDto[]) => entries.filter((e) => !e.beforePeriod);
const all = (entries: readonly BatchEntryDto[]) =>
  new Set(entries.flatMap((e) => freeParts(e).map((p) => coupleKey(e.entryId, p.prepId))));

/** Pre-ticked: the recipes with the tag « batch », in the period, not already covered. */
export function initialSelection(entries: readonly BatchEntryDto[]): Set<string> {
  return all(free(inPeriod(entries)).filter((e) => e.batchTag));
}
/** « Tout »: every meal of the period (those before it are ticked by hand). */
export function selectAll(entries: readonly BatchEntryDto[]): Set<string> {
  return all(free(inPeriod(entries)));
}
export const selectNone = (): Set<string> => new Set();
export const selectTagged = initialSelection;
/** « du jour X au jour Y » (both included). */
export function selectRange(
  entries: readonly BatchEntryDto[],
  from: string,
  to: string,
): Set<string> {
  const [a, b] = from <= to ? [from, to] : [to, from];
  return all(free(entries).filter((e) => e.date >= a && e.date <= b));
}

/** The whole meal, part of it, or nothing. */
export function entryState(
  selection: ReadonlySet<string>,
  entry: BatchEntryDto,
): 'all' | 'partial' | 'none' {
  const parts = freeParts(entry);
  const n = parts.filter((p) => selection.has(coupleKey(entry.entryId, p.prepId))).length;
  return n === 0 ? 'none' : n === parts.length ? 'all' : 'partial';
}
/** The parts ticked of a meal included in part (« Riz cuit seulement »). */
export const tickedParts = (selection: ReadonlySet<string>, entry: BatchEntryDto) =>
  freeParts(entry).filter((p) => selection.has(coupleKey(entry.entryId, p.prepId)));

/**
 * The tick of a meal: none → all its free parts; all or partial → none (a
 * partial inclusion is taken back like any other). A covered meal stays as it is.
 */
export function toggle(selection: ReadonlySet<string>, entry: BatchEntryDto): Set<string> {
  const next = new Set(selection);
  if (entry.coveredBy !== null) return next;
  const keys = freeParts(entry).map((p) => coupleKey(entry.entryId, p.prepId));
  if (entryState(selection, entry) === 'none') keys.forEach((k) => next.add(k));
  else entry.parts.forEach((p) => next.delete(coupleKey(entry.entryId, p.prepId)));
  return next;
}

/**
 * What the calculation receives: the couples ticked that can be computed
 * (keeping known), the meals they belong to, and the parts left out because
 * their keeping is missing (the recipe's, or a preparation's). `minDate`:
 * the first day shown (meals before the period only within N days).
 */
export function forCalculation(
  entries: readonly BatchEntryDto[],
  selection: ReadonlySet<string>,
  minDate = '',
): {
  entryIds: string[];
  couples: { entryId: string; prepId: string | null }[];
  missing: { entryId: string; entry: BatchEntryDto; part: BatchPartDto }[];
} {
  const shown = free(entries).filter((e) => e.date >= minDate);
  const ticked = shown.flatMap((e) => tickedParts(selection, e).map((part) => ({ e, part })));
  const couples = ticked.filter((t) => t.part.fridgeDays !== null);
  return {
    entryIds: [...new Set(couples.map((t) => t.e.entryId))],
    couples: couples.map((t) => ({ entryId: t.e.entryId, prepId: t.part.prepId })),
    missing: ticked
      .filter((t) => t.part.fridgeDays === null)
      .map((t) => ({ entryId: t.e.entryId, entry: t.e, part: t.part })),
  };
}
