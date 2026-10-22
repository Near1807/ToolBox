// Dates and time zones, without a library: Node ships the IANA time zone
// database (full ICU), read through Intl. Calendar dates are "YYYY-MM-DD"
// strings, wall-clock times "HH:MM"; instants are UTC Dates.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const QUOTA_TIME_ZONE = 'America/Los_Angeles';

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isTime(value: unknown): value is string {
  return typeof value === 'string' && TIME.test(value);
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** Wall clock of an instant in a time zone. */
export function zonedParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    seconds: Number(parts.second),
  };
}

/** Offset of the time zone at an instant, in ms (Brussels in summer: +2 h). */
function offsetAt(ms: number, timeZone: string): number {
  const { date, time, seconds } = zonedParts(new Date(ms), timeZone);
  const asUtc = Date.parse(`${date}T${time}:00Z`) + seconds * 1000;
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * UTC instant of a wall-clock date and time in a time zone, across daylight
 * saving changes: a time that happens twice (autumn, 02:30 in Brussels) takes
 * the first one (summer time); a time that does not exist (spring, 02:30) is
 * moved forward by the gap (03:30).
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(wall)) throw new Error(`Date ou heure invalide : ${date} ${time}`);
  const day = 24 * 3_600_000;
  const offsets = [...new Set([offsetAt(wall - day, timeZone), offsetAt(wall + day, timeZone)])];
  const matching = offsets
    .map((offset) => wall - offset)
    .filter((candidate) => {
      const parts = zonedParts(new Date(candidate), timeZone);
      return parts.date === date && parts.time === time;
    });
  if (matching.length > 0) return new Date(Math.min(...matching));
  // In the gap: the offset in force before the change pushes the time forward.
  return new Date(wall - offsetAt(wall - day, timeZone));
}

export function utcToZoned(
  instant: Date | string,
  timeZone: string,
): { date: string; time: string } {
  const { date, time } = zonedParts(new Date(instant), timeZone);
  return { date, time };
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The YouTube quota day (it resets at midnight, Pacific time). */
export function quotaDay(now: Date): string {
  return utcToZoned(now, QUOTA_TIME_ZONE).date;
}

/** Next reset of the YouTube quota (midnight in California: 9:00 in Brussels, most of the year). */
export function nextQuotaReset(now: Date): Date {
  return zonedToUtc(addDays(quotaDay(now), 1), '00:00', QUOTA_TIME_ZONE);
}
