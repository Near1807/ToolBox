// The category switches (v0.35.0): ON = shown AND counted (load, free time,
// overlaps); OFF = neither. Sport, Repas and Timer are off by default.
import { describe, expect, it } from 'vitest';
import { itemsOf, switchCategories, taskLoads, timedBlocks } from '../frontend/common';
import { categoryList, DEFAULT_OFF, isOn } from '../shared/categories';
import { dayLoad, placeDay, weekSummary } from '../shared/load';
import type { RangeDto } from '../shared/types';

const own = (id: string, category: string, start: string, end: string, allDay = false) => ({
  id,
  title: id,
  start,
  end,
  allDay,
  location: null,
  note: null,
  category,
  weekly: null,
  timerPref: null,
});

const data: RangeDto = {
  today: '2026-11-16',
  from: '2026-11-16',
  to: '2026-11-22',
  events: [
    own('cours', 'Cours', '2026-11-16T18:00', '2026-11-16T20:00'),
    own('examen', 'Examens', '2026-11-16', '2026-11-16', true),
  ],
  foreign: [
    {
      id: 'sport:s1',
      moduleId: 'sport',
      title: 'Course',
      start: '2026-11-16T18:30',
      end: '2026-11-16T19:30',
      allDay: false,
      category: 'Sport',
      open: '/m/sport',
      status: null,
    },
    {
      id: 'courses:m1',
      moduleId: 'courses',
      title: 'Dîner',
      start: '2026-11-16T19:00',
      end: '2026-11-16T20:00',
      allDay: false,
      category: 'Repas',
      open: '/m/courses',
      status: null,
    },
  ],
  toPlace: [
    {
      id: 't1',
      title: 'Rapport',
      due: '2026-11-16',
      estimateMin: 60,
      open: '/m/todo',
      late: false,
    },
  ],
  timer: null,
  tasks: [
    {
      id: 't2',
      title: 'Réviser',
      start: '2026-11-16T09:00',
      end: '2026-11-16T11:00',
      allDay: false,
      category: 'Tâches',
      done: false,
      due: null,
      afterDue: false,
      open: '/m/todo',
    },
  ],
  todo: true,
  weekly: [],
  dayStartHour: 7,
  dayEndHour: 23,
  categories: ['Cours', 'Examens', 'Repas', 'Sport', 'Tâches'],
  categoriesOff: ['Sport', 'Repas', 'Timer'],
};
const RANGE = { startHour: 7, endHour: 23 };
const byDefault = (c: string) => isOn(c, {}, data.categoriesOff);

describe('category switches', () => {
  it('by default: Sport, Repas and Timer off; the others on; a device choice wins', () => {
    expect(DEFAULT_OFF).toEqual(['Sport', 'Repas', 'Timer']);
    expect(['Sport', 'Repas', 'Timer'].map(byDefault)).toEqual([false, false, false]);
    expect(['Cours', 'Rendez-vous', 'Tâches', 'Musique', 'Examens'].every(byDefault)).toBe(true);
    expect(isOn('sport', { Sport: true }, DEFAULT_OFF)).toBe(true);
    expect(isOn('Cours', { cours: false }, DEFAULT_OFF)).toBe(false);
    expect(categoryList('Sport, Repas ; Timer,, Sport')).toEqual(['Sport', 'Repas', 'Timer']);
    expect(switchCategories({ ...data, categories: ['Sport'] })).toEqual(['Sport', 'Tâches']);
  });

  it('off: not drawn', () => {
    expect(itemsOf(data, byDefault).map((i) => i.event.id)).toEqual(['examen', 't2', 'cours']);
    expect(itemsOf(data, () => true)).toHaveLength(5);
  });

  it('off: not counted in the load, the free time, the overlaps', () => {
    const on = dayLoad(
      '2026-11-16',
      timedBlocks(data, byDefault),
      taskLoads(data, byDefault),
      RANGE,
    );
    // Cours 2 h + planned task 2 h + the task due that day 1 h; no Sport, no Repas.
    expect(on.totalMin).toBe(120 + 120 + 60);
    expect(on.byCategory.map((c) => c.category).sort()).toEqual(['Cours', 'Tâches']);
    expect(on.freeMin).toBe(16 * 60 - 240);
    const all = dayLoad('2026-11-16', timedBlocks(data), taskLoads(data), RANGE);
    expect(all.totalMin).toBe(120 + 120 + 60 + 60 + 60);
    // Overlaps: the course overlaps the run and the dinner only when they are on.
    const placed = (shown: (c: string) => boolean) =>
      placeDay(
        '2026-11-16',
        itemsOf(data, shown)
          .filter((i) => !i.event.allDay)
          .map((i) => ({
            id: i.event.id,
            start: i.event.start,
            end: i.event.end,
            category: i.event.category,
          })),
      );
    expect(placed(byDefault).find((p) => p.id === 'cours')?.overlaps).toBe(false);
    expect(placed(() => true).find((p) => p.id === 'cours')?.overlaps).toBe(true);
  });

  it('« Tâches » off: no estimate, no planned task counted', () => {
    const noTasks = (c: string) => c !== 'Tâches' && byDefault(c);
    expect(taskLoads(data, noTasks)).toEqual([]);
    const week = weekSummary(
      '2026-11-16',
      7,
      timedBlocks(data, noTasks),
      taskLoads(data, noTasks),
      RANGE,
      '2026-11-16',
    );
    expect(week.toPlaceMin).toBe(0);
    expect(week.days[0]!.totalMin).toBe(120);
  });
});
