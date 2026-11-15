// « Cette semaine » (v0.36.2, audit v0.36.1 B1): the week of the LOCAL day.
// In Brussels, on a Monday between midnight and 01:00 (02:00 in summer), the
// UTC day is still Sunday: the old code opened the week before. This file
// sets Brussels for itself (the tests run in UTC elsewhere).
process.env.TZ = 'Europe/Brussels';

import { describe, expect, it } from 'vitest';
import { currentWeek } from '../shared/dates';

describe('Courses, « Cette semaine » in Brussels', () => {
  // Monday 12 January 2026 (winter, UTC+1), Monday 13 July 2026 (summer, UTC+2).
  const cases: [string, string, [string, string]][] = [
    ['winter, Monday 00:00', '2026-01-11T23:00:00Z', ['2026-01-12', '2026-01-18']],
    ['winter, Monday 01:00', '2026-01-12T00:00:00Z', ['2026-01-12', '2026-01-18']],
    ['summer, Monday 00:00', '2026-07-12T22:00:00Z', ['2026-07-13', '2026-07-19']],
    ['summer, Monday 01:00', '2026-07-12T23:00:00Z', ['2026-07-13', '2026-07-19']],
    ['winter, Sunday 23:59', '2026-01-18T22:59:00Z', ['2026-01-12', '2026-01-18']],
  ];
  for (const [label, instant, week] of cases)
    it(label, () => {
      expect(new Date(instant).getHours()).toBe(Number(label.slice(-5, -3)));
      expect(currentWeek(new Date(instant))).toEqual(week);
    });
});
