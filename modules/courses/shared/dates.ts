// Local calendar days « YYYY-MM-DD » (no time zone involved).

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + n));
  return date.toISOString().slice(0, 10);
}
/** 1 = Monday … 7 = Sunday. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const w = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return w === 0 ? 7 : w;
}
export function mondayOf(day: string): string {
  return addDays(day, 1 - weekdayOf(day));
}
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}
export const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
