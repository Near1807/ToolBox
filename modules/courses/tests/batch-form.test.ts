// The ticks of the batch form (step 1).
import { describe, expect, it } from 'vitest';
import {
  forCalculation,
  initialSelection,
  selectAll,
  selectRange,
  toggle,
} from '../shared/batch-form';
import type { BatchEntryDto } from '../shared/types';

const entry = (id: string, date: string, extra: Partial<BatchEntryDto> = {}): BatchEntryDto => ({
  entryId: id,
  date,
  momentId: 'soir',
  mealId: `m-${id}`,
  mealName: id,
  servings: 1,
  batchTag: false,
  fridgeDays: 2,
  freezable: false,
  freezerDays: null,
  coveredBy: null,
  ...extra,
  // A recipe without preparation: one part, the recipe itself (as in v0.26).
  parts: [
    {
      prepId: null,
      mealId: `m-${id}`,
      name: id,
      portions: 1,
      fridgeDays: extra.fridgeDays === undefined ? 2 : extra.fridgeDays,
      freezable: false,
      freezerDays: null,
    },
  ],
});
const entries = [
  entry('curry', '2026-11-02', { batchTag: true }),
  entry('dal', '2026-11-03', { batchTag: true, fridgeDays: null }),
  entry('pates', '2026-11-04'),
  entry('soupe', '2026-11-05', { batchTag: true, coveredBy: 'plan-1' }),
  entry('salade', '2026-11-06'),
];
const ids = (s: Set<string>) => [...s].sort();

describe('batch form, step 1', () => {
  it('pre-ticked by the tag, except meals already covered', () => {
    expect(ids(initialSelection(entries))).toEqual(['curry', 'dal']);
  });
  it('a meal without the tag ticked by hand is included; a tagged one unticked is left out', () => {
    let s = initialSelection(entries);
    s = toggle(s, entries[2]!); // pâtes, no tag
    s = toggle(s, entries[0]!); // curry unticked
    expect(forCalculation(entries, s).entryIds).toEqual(['pates']);
  });
  it('« du jour X au jour Y », everything, never a covered meal', () => {
    expect(ids(selectRange(entries, '2026-11-03', '2026-11-05'))).toEqual(['dal', 'pates']);
    expect(ids(selectRange(entries, '2026-11-05', '2026-11-03'))).toEqual(['dal', 'pates']);
    expect(ids(selectAll(entries))).not.toContain('soupe');
    expect(ids(toggle(new Set(), entries[3]!))).toEqual([]);
  });
  it('a ticked meal without fridge days is left out and said', () => {
    const r = forCalculation(entries, initialSelection(entries));
    expect(r.entryIds).toEqual(['curry']);
    expect(r.missing.map((e) => e.entryId)).toEqual(['dal']);
  });
});
