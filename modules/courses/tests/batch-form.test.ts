// Temps 1 of the batch form (v0.29): elements by number of meals, a meal
// left out, pre-ticked from the last validated plan (never by the tag).
import { describe, expect, it } from 'vitest';
import {
  elementsOf,
  elementState,
  forCalculation,
  initialSelection,
  toggleElement,
  toggleMeal,
} from '../shared/batch-form';
import type { BatchEntryDto, BatchPartDto } from '../shared/types';

const part = (prepId: string | null, extra: Partial<BatchPartDto> = {}): BatchPartDto => ({
  prepId,
  mealId: 'm-curry',
  name: prepId ?? 'Curry',
  portions: 1,
  fridgeDays: 3,
  freezable: false,
  freezerDays: null,
  coveredBy: null,
  ...extra,
});
const entry = (id: string, date: string, parts: BatchPartDto[], extra = {}): BatchEntryDto => ({
  entryId: id,
  date,
  momentId: 'soir',
  mealId: parts[0]!.mealId,
  mealName: id,
  servings: 1,
  batchTag: true,
  fridgeDays: null,
  freezable: false,
  freezerDays: null,
  parts,
  coveredBy: null,
  ...extra,
});
const entries = [
  entry('boite1', '2026-11-02', [
    part('riz', { name: 'Riz cuit' }),
    part('oeufs', { name: 'Œufs' }),
  ]),
  entry('boite2', '2026-11-03', [
    part('riz', { name: 'Riz cuit' }),
    part('oeufs', { name: 'Œufs' }),
  ]),
  entry('chili', '2026-11-04', [part('riz', { name: 'Riz cuit' })]),
  entry('curry', '2026-11-05', [part(null)]),
  entry('dal', '2026-11-06', [part(null, { mealId: 'm-dal', name: 'Dal', fridgeDays: null })]),
];

describe('temps 1: elements', () => {
  it('listed by number of meals (then name), keeping missing said', () => {
    const els = elementsOf(entries);
    expect(els.map((e) => [e.name, e.meals.length, e.keepKnown])).toEqual([
      ['Riz cuit', 3, true],
      ['Œufs', 2, true],
      ['Curry', 1, true],
      ['Dal', 1, false],
    ]);
  });
  it('nothing pre-ticked the first time, not even the tag « batch »; then the last plan', () => {
    expect(initialSelection(entries, []).size).toBe(0);
    const s = initialSelection(entries, ['prep:riz', 'meal:m-dal']);
    expect(forCalculation(entries, s).couples).toEqual([
      { entryId: 'boite1', prepId: 'riz' },
      { entryId: 'boite2', prepId: 'riz' },
      { entryId: 'chili', prepId: 'riz' },
    ]);
  });
  it('an element ticked = all its meals; one meal left out; covered meals never ticked', () => {
    const covered = [
      ...entries.slice(0, 2),
      entry('chili', '2026-11-04', [part('riz', { name: 'Riz cuit', coveredBy: 'plan-1' })], {
        coveredBy: 'plan-1',
      }),
    ];
    const riz = elementsOf(covered)[0]!;
    let s = toggleElement(new Set(), riz);
    expect(elementState(s, riz)).toBe('all');
    expect(forCalculation(covered, s).couples.map((c) => c.entryId)).toEqual(['boite1', 'boite2']);
    s = toggleMeal(s, riz.meals[1]!);
    expect(elementState(s, riz)).toBe('partial');
    expect(forCalculation(covered, s).couples.map((c) => c.entryId)).toEqual(['boite1']);
    expect(toggleMeal(s, riz.meals[2]!)).toEqual(s); // covered: not tickable
    expect(elementState(toggleElement(s, riz), riz)).toBe('none');
  });
  it('meals before the shown days are left out', () => {
    const s = initialSelection(entries, ['prep:riz']);
    expect(forCalculation(entries, s, '2026-11-03').couples.map((c) => c.entryId)).toEqual([
      'boite2',
      'chili',
    ]);
  });
});
