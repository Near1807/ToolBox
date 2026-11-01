// The ticks of the batch form (step 1), pure (tested in tests/batch-form.test.ts):
// pre-ticked by the tag « batch », any meal tickable by hand, meals already
// covered by a validated plan never tickable, shortcuts.
import type { BatchEntryDto, BatchPartDto } from './types';

/** Meals that can be ticked: not covered by a validated plan. */
const free = (entries: readonly BatchEntryDto[]) => entries.filter((e) => e.coveredBy === null);

/** Pre-ticked: the recipes with the tag « batch », not already covered. */
export function initialSelection(entries: readonly BatchEntryDto[]): Set<string> {
  return new Set(
    free(entries)
      .filter((e) => e.batchTag)
      .map((e) => e.entryId),
  );
}
export function selectAll(entries: readonly BatchEntryDto[]): Set<string> {
  return new Set(free(entries).map((e) => e.entryId));
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
  return new Set(
    free(entries)
      .filter((e) => e.date >= a && e.date <= b)
      .map((e) => e.entryId),
  );
}
/** One tick switched (a covered meal stays as it is). */
export function toggle(selection: ReadonlySet<string>, entry: BatchEntryDto): Set<string> {
  const next = new Set(selection);
  if (entry.coveredBy !== null) return next;
  if (next.has(entry.entryId)) next.delete(entry.entryId);
  else next.add(entry.entryId);
  return next;
}
/**
 * What the calculation receives: the ticked meals that can be computed (at
 * least one part with fridge days), and the parts left out because their
 * keeping is missing (the recipe's, or a preparation's).
 */
export function forCalculation(
  entries: readonly BatchEntryDto[],
  selection: ReadonlySet<string>,
): {
  entryIds: string[];
  missing: { entryId: string; entry: BatchEntryDto; part: BatchPartDto }[];
} {
  const ticked = free(entries).filter((e) => selection.has(e.entryId));
  return {
    entryIds: ticked
      .filter((e) => e.parts.some((p) => p.fridgeDays !== null))
      .map((e) => e.entryId),
    missing: ticked.flatMap((e) =>
      e.parts
        .filter((p) => p.fridgeDays === null)
        .map((part) => ({ entryId: e.entryId, entry: e, part })),
    ),
  };
}
