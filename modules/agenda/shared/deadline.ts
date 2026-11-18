// v0.42.0 (Expérimental): the « deadline » shape. A deadline is a moment, not
// a block of time: a date and an optional time, no duration. Never counted
// in the load nor in the free time, never in a conflict. Pure (PC, phone, tests).
import { addDays, daysBetween } from './time';

/** The days the « Deadlines » row looks ahead past the week shown. */
export const AHEAD_DAYS = 7;
/** How far back an overdue, not done deadline is still listed. */
export const OVERDUE_DAYS = 60;

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Its moment: the time given, else the end of its day (« 23:59 »). */
export const dueMoment = (start: string) => (start.length === 10 ? `${start}T23:59` : start);

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * The time left, in plain words: « dans 2 jours », « demain 14:00 »,
 * « aujourd'hui 23:59 », « dans 40 min », « en retard de 1 jour »,
 * « en retard de 3 h ». `now`: the local date-time « YYYY-MM-DDTHH:mm ».
 */
export function untilText(start: string, now: string): string {
  const due = dueMoment(start);
  const day = start.slice(0, 10);
  const today = now.slice(0, 10);
  const time = start.length > 10 ? start.slice(11) : null;
  const minutes = Math.round(
    (Date.parse(`${due}:00Z`) - Date.parse(`${now.slice(0, 16)}:00Z`)) / 60_000,
  );
  if (minutes < 0) {
    const late = -minutes;
    if (day < today) return `en retard de ${plural(daysBetween(day, today), 'jour')}`;
    if (late < 60) return `en retard de ${late} min`;
    return `en retard de ${Math.floor(late / 60)} h`;
  }
  if (day === today) {
    if (time && minutes < 60) return `dans ${minutes} min`;
    return `aujourd’hui ${time ?? '23:59'}`;
  }
  if (day === addDays(today, 1)) return `demain${time ? ` ${time}` : ''}`;
  return `dans ${plural(daysBetween(today, day), 'jour')}`;
}

/** Is it past (and so red while not done)? */
export const isLate = (start: string, now: string) => dueMoment(start) < now.slice(0, 16);

/** Now as « YYYY-MM-DDTHH:mm » (local). */
export const localNow = (d = new Date()) => `${localDay(d)}T${localTime(d)}`;
