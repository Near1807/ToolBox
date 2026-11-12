// The layers: a hidden category leaves the drawing, never the load.
import { describe, expect, it } from 'vitest';
import { itemsOf, timedBlocks } from '../frontend/common';
import { dayLoad } from '../shared/load';
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
      start: '2026-11-16T07:00',
      end: '2026-11-16T08:00',
      allDay: false,
      category: 'Sport',
      open: '/m/sport',
      status: null,
    },
  ],
  toPlace: [],
  todo: false,
  weekly: [],
  dayStartHour: 7,
  dayEndHour: 23,
  categories: ['Cours', 'Examens', 'Sport'],
};

describe('layers', () => {
  it('a hidden category is not drawn; the others are, in order', () => {
    const all = itemsOf(data, () => true);
    expect(all.map((i) => i.event.id)).toEqual(['examen', 'sport:s1', 'cours']);
    const noSport = itemsOf(data, (c) => c !== 'Sport');
    expect(noSport.map((i) => i.event.id)).toEqual(['examen', 'cours']);
    expect(noSport.every((i) => i.source === 'own')).toBe(true);
  });

  it('the load counts every timed block, hidden or not (all-day ones never)', () => {
    const blocks = timedBlocks(data);
    expect(blocks.map((b) => b.id).sort()).toEqual(['cours', 'sport:s1']);
    const load = dayLoad('2026-11-16', blocks, [], { startHour: 7, endHour: 23 });
    expect(load.totalMin).toBe(180);
  });
});
