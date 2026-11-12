// Local date-times as plain text (« YYYY-MM-DDTHH:mm »), computed as UTC so
// no daylight-saving change ever shifts them: the Agenda shows wall-clock
// times, as written.
import { addDays, daysBetween } from '@hub/sdk/dates';

export { addDays, daysBetween };

const toMs = (dt: string) => Date.parse(`${dt.length === 10 ? `${dt}T00:00` : dt}:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/** « 2026-11-12T14:00 » + 90 → « 2026-11-12T15:30 ». */
export function addMinutes(dateTime: string, minutes: number): string {
  return fromMs(toMs(dateTime) + minutes * 60_000);
}

/** Minutes from `a` to `b` (both date-times or dates). */
export function minutesBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / 60_000);
}

/** « 14:30 » → 870. */
export const minutesOfDay = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** 870 → « 14:30 ». */
export const timeOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** 0 = Monday … 6 = Sunday. */
export function weekday(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The Monday of the week of `day`. */
export const mondayOf = (day: string) => addDays(day, -weekday(day));

/** The days from `from` to `to`, both included. */
export function daysFrom(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const WEEKDAYS_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
export const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MONTHS_SHORT = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];
export const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** « jeu. 13 nov. » (+ the year when it is not `today`'s). */
export function dayLabel(day: string, today: string): string {
  const year = day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${day.slice(0, 4)}`;
  return `${WEEKDAYS_SHORT[weekday(day)]} ${Number(day.slice(8, 10))} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}${year}`;
}

/** « 1 h 30 », « 45 min », « 3 h ». */
export function hoursText(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const rest = m % 60;
  return `${Math.floor(m / 60)} h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}`;
}

/**
 * How an event reads: « jeu. 13 nov. 14:00–15:00 », « sam. 14 nov. (toute la
 * journée) », « ven. 13 nov. → dim. 15 févr. », « ven. 13 nov. 18:00 → dim. 15 nov. 16:00 ».
 */
export function eventWhen(
  e: { start: string; end: string; allDay: boolean },
  today: string,
): string {
  if (e.allDay) {
    const first = e.start.slice(0, 10);
    const last = e.end.slice(0, 10);
    return first === last
      ? `${dayLabel(first, today)} (toute la journée)`
      : `${dayLabel(first, today)} → ${dayLabel(last, today)}`;
  }
  const d1 = e.start.slice(0, 10);
  const d2 = e.end.slice(0, 10);
  if (d1 === d2 || (daysBetween(d1, d2) === 1 && e.end.slice(11) === '00:00'))
    return `${dayLabel(d1, today)} ${e.start.slice(11)}–${d1 === d2 ? e.end.slice(11) : '24:00'}`;
  return `${dayLabel(d1, today)} ${e.start.slice(11)} → ${dayLabel(d2, today)} ${e.end.slice(11)}`;
}
