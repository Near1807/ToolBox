// The Sport calendar: dates, the weekly template applied and changed, moves
// inside the week, the summary and the streak.
import { describe, expect, it } from 'vitest';
import {
  completeWeekStreak,
  endTime,
  monthWeeks,
  mondayOf,
  moveCheck,
  planWeek,
  reapplyTemplate,
  summary,
  weekdayOf,
  type Session,
  type TemplateItem,
} from '../shared/plan';

const template: TemplateItem[] = [
  { id: 't1', weekday: 1, name: 'Dos + abdos', start: '18:30', durationMin: 60, exercises: [] },
  { id: 't3', weekday: 3, name: 'Push', start: '07:00', durationMin: 45, exercises: [] },
  { id: 't5', weekday: 5, name: 'Jambes', start: '18:00', durationMin: 75, exercises: [] },
];
const session = (over: Partial<Session> & { id: string; date: string }): Session => ({
  name: 'S',
  start: '18:00',
  durationMin: 60,
  status: 'planned',
  mood: null,
  comment: '',
  templateId: 't1',
  custom: false,
  exercises: [],
  ...over,
});

describe('dates', () => {
  it('weeks start on Monday', () => {
    expect(mondayOf('2026-10-29')).toBe('2026-10-26'); // a Thursday
    expect(mondayOf('2026-11-01')).toBe('2026-10-26'); // Sunday
    expect(weekdayOf('2026-11-01')).toBe(7);
    expect(monthWeeks('2026-11')).toEqual([
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ]);
    expect(endTime('23:30', 60)).toBe('00:30');
  });
});

describe('weekly template', () => {
  it('applies to a week, by day and time', () => {
    expect(planWeek(template, '2026-10-26').map((p) => [p.date, p.name, p.start])).toEqual([
      ['2026-10-26', 'Dos + abdos', '18:30'],
      ['2026-10-28', 'Push', '07:00'],
      ['2026-10-30', 'Jambes', '18:00'],
    ]);
  });
  it('a change touches the days after today only, never what was validated or changed by hand', () => {
    const today = '2026-10-28'; // Wednesday
    const existing = [
      session({ id: 'mon', date: '2026-10-26', templateId: 't1', status: 'done' }),
      session({ id: 'wed', date: '2026-10-28', templateId: 't3' }), // today: stays
      session({ id: 'fri', date: '2026-10-30', templateId: 't5' }), // future, untouched: replaced
      session({ id: 'sat', date: '2026-10-31', templateId: null }), // added by hand: stays
    ];
    const next: TemplateItem[] = [
      { id: 't3', weekday: 3, name: 'Push', start: '07:00', durationMin: 45, exercises: [] },
      {
        id: 't5',
        weekday: 5,
        name: 'Jambes + mollets',
        start: '19:00',
        durationMin: 90,
        exercises: [],
      },
      { id: 't7', weekday: 7, name: 'Mobilité', start: '10:00', durationMin: 30, exercises: [] },
    ];
    const { remove, add } = reapplyTemplate(existing, next, '2026-10-26', today);
    expect(remove).toEqual(['fri']);
    expect(add.map((a) => [a.date, a.name])).toEqual([
      ['2026-10-30', 'Jambes + mollets'],
      ['2026-11-01', 'Mobilité'],
    ]);
    // A future session changed by hand stays, and is not doubled.
    const custom = [session({ id: 'fri2', date: '2026-10-30', templateId: 't5', custom: true })];
    expect(reapplyTemplate(custom, next, '2026-10-26', today)).toMatchObject({
      remove: [],
      add: [{ date: '2026-11-01' }],
    });
  });
});

describe('moves and summary', () => {
  it('a session moves inside its week only', () => {
    expect(moveCheck({ date: '2026-10-27' }, '2026-11-01')).toBeNull();
    expect(moveCheck({ date: '2026-10-27' }, '2026-11-02')).toMatch(/dans sa semaine/);
    expect(moveCheck({ date: '2026-10-27' }, 'jeudi')).toBe('Jour invalide');
  });
  it('done / planned, to validate, mood; cancelled ones do not count', () => {
    const list = [
      session({ id: 'a', date: '2026-10-26', status: 'done', mood: 4 }),
      session({ id: 'b', date: '2026-10-27', status: 'missed', mood: 2 }),
      session({ id: 'c', date: '2026-10-27', status: 'planned' }),
      session({ id: 'd', date: '2026-10-30', status: 'planned' }),
      session({ id: 'e', date: '2026-10-31', status: 'cancelled', mood: 5 }),
    ];
    expect(summary(list, '2026-10-29')).toEqual({ done: 1, planned: 4, toValidate: 1, mood: 3 });
  });
  it('complete weeks in a row', () => {
    const weeks = new Map<string, Session[]>([
      ['2026-10-12', [session({ id: '1', date: '2026-10-12', status: 'done' })]],
      [
        '2026-10-19',
        [
          session({ id: '2', date: '2026-10-19', status: 'done' }),
          session({ id: '3', date: '2026-10-21', status: 'cancelled' }),
        ],
      ],
      ['2026-10-26', [session({ id: '4', date: '2026-10-26', status: 'planned' })]],
    ]);
    expect(completeWeekStreak(weeks, '2026-10-29')).toBe(2);
    weeks.set('2026-10-26', [session({ id: '4', date: '2026-10-26', status: 'done' })]);
    expect(completeWeekStreak(weeks, '2026-10-29')).toBe(3);
    weeks.set('2026-10-19', [session({ id: '2', date: '2026-10-19', status: 'missed' })]);
    expect(completeWeekStreak(weeks, '2026-10-29')).toBe(1);
  });
});
