// The Sport calendar, pure (tested in tests/plan.test.ts): dates of a week,
// the weekly template applied to a week, what a change of the template does
// to the weeks to come, moving a session inside its week, the summary.
import type { ExerciseLineDto } from './exercises';

/** 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type SessionStatus = 'planned' | 'done' | 'missed' | 'cancelled';

export const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const MOODS = ['😫', '🙁', '😐', '🙂', '😄'];

export interface TemplateItem {
  id: string;
  weekday: Weekday;
  name: string;
  /** « HH:MM ». */
  start: string;
  durationMin: number;
  /** Ordered exercises of this template session. */
  exercises: ExerciseLineDto[];
}

export interface Session {
  id: string;
  /** « YYYY-MM-DD ». */
  date: string;
  name: string;
  start: string;
  durationMin: number;
  status: SessionStatus;
  /** 1–5, or null. */
  mood: number | null;
  comment: string;
  /** The template line it comes from (null: added by hand). */
  templateId: string | null;
  /** Changed by hand (time, duration, day, name, exercises): a template change leaves it alone. */
  custom: boolean;
  /** Its own list: copied from the template when planned, then changed for it alone. */
  exercises: ExerciseLineDto[];
}

// --- Dates (local calendar days, « YYYY-MM-DD », no time zone involved) -------

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDay(d);
}
/** 1 = Monday … 7 = Sunday. */
export function weekdayOf(day: string): Weekday {
  const w = parseDay(day).getUTCDay();
  return (w === 0 ? 7 : w) as Weekday;
}
export function mondayOf(day: string): string {
  return addDays(day, 1 - weekdayOf(day));
}
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
export function sameWeek(a: string, b: string): boolean {
  return mondayOf(a) === mondayOf(b);
}
/** Last day of a month (« YYYY-MM »). */
export function monthEnd(month: string): string {
  return addDays(
    formatDay(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))),
    -1,
  );
}
/** The Mondays of the weeks that touch a month (« YYYY-MM »). */
export function monthWeeks(month: string): string[] {
  const first = `${month}-01`;
  const last = monthEnd(month);
  const weeks: string[] = [];
  for (let m = mondayOf(first); m <= last; m = addDays(m, 7)) weeks.push(m);
  return weeks;
}
export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// --- The weekly template -------------------------------------------------------

export interface PlannedSession {
  templateId: string;
  date: string;
  name: string;
  start: string;
  durationMin: number;
  exercises: ExerciseLineDto[];
}

/** The sessions of a week from the template, by day then time. */
export function planWeek(template: TemplateItem[], monday: string): PlannedSession[] {
  return template
    .map((t) => ({
      templateId: t.id,
      date: addDays(monday, t.weekday - 1),
      name: t.name,
      start: t.start,
      durationMin: t.durationMin,
      exercises: t.exercises,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

/**
 * A new template for a week already on the calendar: the sessions after
 * today that still follow the old template (planned, not changed by hand)
 * are replaced; today, the past, the sessions validated, cancelled, changed
 * by hand or added by hand stay as they are.
 */
export function reapplyTemplate(
  existing: Session[],
  template: TemplateItem[],
  monday: string,
  today: string,
): { remove: string[]; add: PlannedSession[] } {
  const replaceable = (s: Session) =>
    s.date > today && s.status === 'planned' && !s.custom && s.templateId !== null;
  const remove = existing.filter(replaceable).map((s) => s.id);
  // Days after today: one session per template line, unless a session of that
  // line is kept on that day (validated, cancelled or changed by hand).
  const kept = existing.filter((s) => !replaceable(s));
  const add = planWeek(template, monday).filter(
    (p) => p.date > today && !kept.some((k) => k.templateId === p.templateId && k.date === p.date),
  );
  return { remove, add };
}

/** Moving a session: only to another day of the same week. */
export function moveCheck(session: Pick<Session, 'date'>, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Jour invalide';
  if (!sameWeek(session.date, to)) return 'Une séance se déplace seulement dans sa semaine.';
  return null;
}

// --- Summary --------------------------------------------------------------------

export interface Summary {
  done: number;
  /** Planned sessions of the period (cancelled ones excluded). */
  planned: number;
  /** Past sessions neither done nor « pas fait ». */
  toValidate: number;
  /** Mean mood of the sessions with one (null when none). */
  mood: number | null;
}

export function summary(sessions: Session[], today: string): Summary {
  const counted = sessions.filter((s) => s.status !== 'cancelled');
  const moods = counted.map((s) => s.mood).filter((m): m is number => m !== null);
  return {
    done: counted.filter((s) => s.status === 'done').length,
    planned: counted.length,
    toValidate: counted.filter((s) => s.status === 'planned' && s.date < today).length,
    mood: moods.length
      ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10
      : null,
  };
}

/**
 * Complete weeks in a row: every session (cancelled ones excluded) done,
 * at least one. Counted back from the last finished week; the current week
 * counts when it is already complete.
 */
export function completeWeekStreak(sessionsByWeek: Map<string, Session[]>, today: string): number {
  const current = mondayOf(today);
  const complete = (monday: string) => {
    const list = (sessionsByWeek.get(monday) ?? []).filter((s) => s.status !== 'cancelled');
    return list.length > 0 && list.every((s) => s.status === 'done');
  };
  let streak = complete(current) ? 1 : 0;
  for (let m = addDays(current, -7); complete(m); m = addDays(m, -7)) streak++;
  return streak;
}

/** « 18:30 » + 75 min → « 19:45 ». */
export function endTime(start: string, durationMin: number): string {
  const [h, m] = start.split(':').map(Number);
  const total = (h! * 60 + m! + durationMin) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
