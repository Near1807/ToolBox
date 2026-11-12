// Moving and stretching in the week (v0.35.0): magnetism, the next day, the
// length kept, 15 minutes at least.
import { describe, expect, it } from 'vitest';
import { moveSpan, placeSpan, sameSpan, snap, spanLabel, stretchSpan } from '../shared/drag';

const span = { start: '2026-11-18T14:00', end: '2026-11-18T16:00' };

describe('drag and drop', () => {
  it('snaps to the quarter of an hour', () => {
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
    expect(snap(52)).toBe(45);
    expect(moveSpan(span, 0, 22)).toEqual({ start: '2026-11-18T14:15', end: '2026-11-18T16:15' });
    expect(moveSpan(span, 0, -38)).toEqual({ start: '2026-11-18T13:15', end: '2026-11-18T15:15' });
  });

  it('changes day, keeps the length, stays in the day', () => {
    expect(moveSpan(span, 1, 0)).toEqual({ start: '2026-11-19T14:00', end: '2026-11-19T16:00' });
    expect(moveSpan(span, -2, 60)).toEqual({ start: '2026-11-16T15:00', end: '2026-11-16T17:00' });
    // The start never leaves its day; the end may run past midnight.
    expect(moveSpan(span, 0, 20 * 60)).toEqual({
      start: '2026-11-18T23:45',
      end: '2026-11-19T01:45',
    });
    expect(moveSpan(span, 0, -20 * 60).start).toBe('2026-11-18T00:00');
  });

  it('stretches the end, 15 minutes at least', () => {
    expect(stretchSpan(span, 37)).toEqual({ start: '2026-11-18T14:00', end: '2026-11-18T16:30' });
    expect(stretchSpan(span, 38)).toEqual({ start: '2026-11-18T14:00', end: '2026-11-18T16:45' });
    expect(stretchSpan(span, -200)).toEqual({ start: '2026-11-18T14:00', end: '2026-11-18T14:15' });
  });

  it('a task dropped from « À caser »: where dropped, for its estimate (30 min without)', () => {
    expect(placeSpan('2026-11-18', 9 * 60 + 7, 120)).toEqual({
      start: '2026-11-18T09:00',
      end: '2026-11-18T11:00',
    });
    expect(placeSpan('2026-11-18', 9 * 60 + 8, null)).toEqual({
      start: '2026-11-18T09:15',
      end: '2026-11-18T09:45',
    });
  });

  it('a drop that changes nothing is a click; the preview', () => {
    expect(sameSpan(moveSpan(span, 0, 5), span)).toBe(true);
    expect(sameSpan(moveSpan(span, 0, 10), span)).toBe(false);
    expect(spanLabel(moveSpan(span, 0, 15))).toBe('14:15–16:15');
  });
});
