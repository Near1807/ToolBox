// The load of the days and the week, free time, overlaps (pure).
import { describe, expect, it } from 'vitest';
import { dayLoad, placeDay, weekSummary, type TimedBlock } from '../shared/load';

const RANGE = { startHour: 7, endHour: 23 }; // 16 h = 960 min a day.
const b = (id: string, start: string, end: string, category = 'Cours'): TimedBlock => ({
  id,
  start,
  end,
  category,
});

describe('load and free time', () => {
  it('a day: hours by category inside the range, tasks due that day, state', () => {
    const blocks = [
      b('a', '2026-11-16T08:00', '2026-11-16T12:00'),
      b('b', '2026-11-16T14:00', '2026-11-16T15:30', 'Rendez-vous'),
      b('early', '2026-11-16T05:00', '2026-11-16T08:00', 'Sport'), // 1 h inside the range.
      b('other', '2026-11-17T08:00', '2026-11-17T09:00'),
    ];
    const tasks = [
      { id: 't1', due: '2026-11-16', estimateMin: 120 },
      { id: 't2', due: '2026-11-16', estimateMin: null },
      { id: 't3', due: null, estimateMin: 60 },
    ];
    const load = dayLoad('2026-11-16', blocks, tasks, RANGE);
    expect(load.byCategory).toEqual([
      { category: 'Cours', minutes: 240 },
      { category: 'Tâches', minutes: 120 },
      { category: 'Rendez-vous', minutes: 90 },
      { category: 'Sport', minutes: 60 },
    ]);
    expect(load.totalMin).toBe(510);
    expect(load.freeMin).toBe(960 - 240 - 90 - 60);
    expect(load.state).toBe('chargé'); // 510 / 960 = 53 %.
    expect(load.tasksWithoutEstimate).toBe(1);
    expect(dayLoad('2026-11-18', blocks, tasks, RANGE).state).toBe('léger');
    expect(
      dayLoad('2026-11-18', [b('x', '2026-11-18T07:00', '2026-11-18T22:00')], [], RANGE).state,
    ).toBe('saturé');
  });

  it('overlaps count once in free time; a night is split between its days', () => {
    const blocks = [
      b('a', '2026-11-16T09:00', '2026-11-16T11:00'),
      b('b', '2026-11-16T10:00', '2026-11-16T12:00', 'Réunions'),
      b('night', '2026-11-16T22:00', '2026-11-17T08:00', 'Loisirs'),
    ];
    const mon = dayLoad('2026-11-16', blocks, [], RANGE);
    expect(mon.freeMin).toBe(960 - 180 - 60);
    expect(mon.totalMin).toBe(120 + 120 + 60); // Each counts its own hours in the load.
    expect(dayLoad('2026-11-17', blocks, [], RANGE).freeMin).toBe(960 - 60);
  });

  it('the week: free hours, hours to fit in (late tasks too), tasks without estimate', () => {
    const blocks = [b('a', '2026-11-16T08:00', '2026-11-16T12:00')];
    const tasks = [
      { id: 'late', due: '2026-11-10', estimateMin: 30 },
      { id: 'wed', due: '2026-11-18', estimateMin: 90 },
      { id: 'sun', due: '2026-11-22', estimateMin: null },
      { id: 'next', due: '2026-11-25', estimateMin: 600 },
      { id: 'undated', due: null, estimateMin: 45 },
    ];
    const week = weekSummary('2026-11-16', 7, blocks, tasks, RANGE);
    expect(week.freeMin).toBe(7 * 960 - 240);
    expect(week.toPlaceMin).toBe(30 + 90);
    expect(week.tasksWithoutEstimate).toBe(1);
    // The late task weighs on the first day of the week.
    expect(week.days[0]!.byCategory).toContainEqual({ category: 'Tâches', minutes: 30 });
    expect(week.days[2]!.byCategory).toContainEqual({ category: 'Tâches', minutes: 90 });
  });

  it('overlapping blocks side by side, flagged', () => {
    const placed = placeDay('2026-11-16', [
      b('a', '2026-11-16T09:00', '2026-11-16T11:00'),
      b('b', '2026-11-16T10:00', '2026-11-16T12:00'),
      b('c', '2026-11-16T11:00', '2026-11-16T12:00'),
      b('d', '2026-11-16T14:00', '2026-11-16T15:00'),
      b('night', '2026-11-15T23:00', '2026-11-16T01:00'),
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.id, p]));
    expect(by.night).toMatchObject({ from: 0, to: 60, overlaps: false, lanes: 1 });
    expect(by.a).toMatchObject({ from: 540, to: 660, lane: 0, lanes: 2, overlaps: true });
    expect(by.b).toMatchObject({ lane: 1, lanes: 2, overlaps: true });
    // « c » starts when « a » ends: it takes « a »'s column, and overlaps « b ».
    expect(by.c).toMatchObject({ lane: 0, overlaps: true });
    expect(by.d).toMatchObject({ lane: 0, lanes: 1, overlaps: false });
  });
});
