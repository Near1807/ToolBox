// The week type: occurrences on their day, in their period; one cancelled,
// one moved (even to another week), the others untouched.
import { describe, expect, it } from 'vitest';
import { occurrences } from '../shared/recurrence';
import type { WeeklyDto } from '../shared/types';

const badminton: WeeklyDto = {
  id: 'w1',
  title: 'Badminton',
  weekday: 3, // Thursday
  time: '19:00',
  durationMin: 120,
  category: 'Sport',
  location: 'Salle',
  from: '2026-11-01',
  until: '2026-12-31',
  timerPref: null,
};

describe('the week type', () => {
  it('every Thursday of its period', () => {
    const list = occurrences([badminton], [], '2026-11-09', '2026-11-22');
    expect(list.map((o) => [o.id, o.start, o.end])).toEqual([
      ['w1:2026-11-12', '2026-11-12T19:00', '2026-11-12T21:00'],
      ['w1:2026-11-19', '2026-11-19T19:00', '2026-11-19T21:00'],
    ]);
    expect(list[0]).toMatchObject({
      category: 'Sport',
      location: 'Salle',
      allDay: false,
      weekly: { id: 'w1', date: '2026-11-12', moved: false },
    });
    expect(occurrences([badminton], [], '2027-01-01', '2027-01-31')).toEqual([]);
  });

  it('one occurrence cancelled, one moved (to the next week): the others untouched', () => {
    const list = occurrences(
      [badminton],
      [
        { weeklyId: 'w1', date: '2026-11-12', kind: 'cancel', start: null, durationMin: null },
        {
          weeklyId: 'w1',
          date: '2026-11-19',
          kind: 'move',
          start: '2026-11-24T18:00',
          durationMin: 90,
        },
      ],
      '2026-11-09',
      '2026-11-29',
    );
    expect(list.map((o) => [o.id, o.start, o.end, o.weekly?.moved])).toEqual([
      ['w1:2026-11-19', '2026-11-24T18:00', '2026-11-24T19:30', true],
      ['w1:2026-11-26', '2026-11-26T19:00', '2026-11-26T21:00', false],
    ]);
    // Seen from the week it left: nothing there any more.
    expect(
      occurrences(
        [badminton],
        [
          {
            weeklyId: 'w1',
            date: '2026-11-19',
            kind: 'move',
            start: '2026-11-24T18:00',
            durationMin: null,
          },
        ],
        '2026-11-16',
        '2026-11-22',
      ),
    ).toEqual([]);
  });
});
