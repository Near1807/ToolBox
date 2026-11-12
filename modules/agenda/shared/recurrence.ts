// The week type (like the Sport's): entries that come back every week on
// their day and at their time (lessons, trainings, fixed meetings), each
// with its period. One occurrence can be cancelled or moved without
// touching the others (an exception for that date).
import { addMinutes } from './time';
import { daysFrom, weekday } from './time';
import type { AgendaEventDto, WeeklyDto } from './types';

export interface OccurrenceException {
  weeklyId: string;
  /** The occurrence's usual date. */
  date: string;
  kind: 'cancel' | 'move';
  /** Moved: its new start « YYYY-MM-DDTHH:mm » and duration. */
  start: string | null;
  durationMin: number | null;
}

/** Every occurrence between two dates (inclusive), exceptions applied. */
export function occurrences(
  weekly: WeeklyDto[],
  exceptions: OccurrenceException[],
  from: string,
  to: string,
): AgendaEventDto[] {
  const byKey = new Map(exceptions.map((x) => [`${x.weeklyId}:${x.date}`, x]));
  const out: AgendaEventDto[] = [];
  // A moved occurrence can land in the period from a date outside it: one week around.
  for (const day of daysFrom(addDaysSafe(from, -7), addDaysSafe(to, 7))) {
    for (const w of weekly) {
      if (weekday(day) !== w.weekday) continue;
      if ((w.from && day < w.from) || (w.until && day > w.until)) continue;
      const exception = byKey.get(`${w.id}:${day}`);
      if (exception?.kind === 'cancel') continue;
      const moved = exception?.kind === 'move' && exception.start !== null;
      const start = moved ? exception.start! : `${day}T${w.time}`;
      const duration = moved ? (exception.durationMin ?? w.durationMin) : w.durationMin;
      const startDay = start.slice(0, 10);
      if (startDay < from || startDay > to) continue;
      out.push({
        id: `${w.id}:${day}`,
        title: w.title,
        start,
        end: addMinutes(start, duration),
        allDay: false,
        location: w.location,
        note: null,
        category: w.category,
        weekly: { id: w.id, date: day, moved },
      });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

function addDaysSafe(day: string, n: number): string {
  return addMinutes(day, n * 24 * 60).slice(0, 10);
}
