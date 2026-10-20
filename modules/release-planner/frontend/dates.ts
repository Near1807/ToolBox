// Calendar dates as "YYYY-MM-DD" strings (the backend gives each element its
// date in the time zone of the settings): pure string arithmetic, in UTC.

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Monday of the week of a date. */
export function startOfWeek(date: string): string {
  const day = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -day);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(date: string, months: number): string {
  const value = new Date(`${startOfMonth(date)}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

/** Weeks (Monday → Sunday) covering the month of `date`. */
export function monthGrid(date: string): string[][] {
  const first = startOfMonth(date);
  const month = first.slice(0, 7);
  const weeks: string[][] = [];
  let day = startOfWeek(first);
  do {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
    day = addDays(day, 7);
  } while (day.slice(0, 7) === month);
  return weeks;
}

const MONTHS = [
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
const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
export const SHORT_DAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function monthTitle(date: string): string {
  const [year, month] = date.split('-');
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/** "vendredi 6 novembre" */
export function longDate(date: string, withYear = false): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return `${DAYS[weekdayIndex(date)]} ${day} ${MONTHS[month - 1]}${withYear ? ` ${year}` : ''}`;
}

/** "06/11" */
export function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}
