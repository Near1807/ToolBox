// The load of each day and of the week (pure, tested in tests/load.test.ts):
// - the day's load: the hours of its timed events inside the day's range
//   (7 h – 23 h by default), by category, plus the estimated durations of
//   the tasks due that day (« Tâches »); a state léger / chargé / saturé;
// - the week: « X h de libre » (the range of each day minus its events,
//   overlaps counted once) and « Y h à caser » (the estimates of the tasks
//   that weigh on one of its days), the tasks without an estimate counted
//   apart; a task weighs on its due day, or on today when it is late (so a
//   late task is on today's bar, never on a past day nor on a later week);
// - overlaps: two timed blocks at the same moment, and their columns.
// All-day items (a camp, an exam) have no hours: they do not weigh.
import { addDays, minutesBetween } from './time';

export interface TimedBlock {
  id: string;
  /** « YYYY-MM-DDTHH:mm » */
  start: string;
  end: string;
  category: string;
}

export interface TaskLoad {
  id: string;
  due: string | null;
  estimateMin: number | null;
}

/** The day a task weighs on: its due day, today when it is late, none without a date. */
export function weighsOn(due: string | null, today?: string): string | null {
  if (due === null) return null;
  return today !== undefined && due < today ? today : due;
}

export interface Range {
  startHour: number;
  endHour: number;
}

export type LoadState = 'léger' | 'chargé' | 'saturé';

export interface DayLoad {
  day: string;
  /** Minutes by category (events, and « Tâches » for the estimates due that day). */
  byCategory: { category: string; minutes: number }[];
  totalMin: number;
  /** Minutes of the day's range. */
  rangeMin: number;
  /** Free minutes in the range (events only; overlaps counted once). */
  freeMin: number;
  state: LoadState;
  /** Tasks due that day without an estimate. */
  tasksWithoutEstimate: number;
}

export const TASKS_CATEGORY = 'Tâches';
/** Under half the range: léger; under 85 %: chargé; beyond: saturé. */
export const LIGHT_UNDER = 0.5;
export const BUSY_UNDER = 0.85;

/** The part of a block inside a day's range, in minutes from midnight of `day` (or null). */
export function clip(block: TimedBlock, day: string, range: Range): [number, number] | null {
  const from = minutesBetween(`${day}T00:00`, block.start);
  const to = minutesBetween(`${day}T00:00`, block.end);
  const a = Math.max(from, range.startHour * 60);
  const b = Math.min(to, range.endHour * 60);
  return b > a ? [a, b] : null;
}

/** Total length of intervals, overlaps counted once. */
function unionLength(intervals: [number, number][]): number {
  const sorted = [...intervals].sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of sorted) {
    if (a >= end) {
      total += b - a;
      end = b;
    } else if (b > end) {
      total += b - end;
      end = b;
    }
  }
  return total;
}

export function dayLoad(
  day: string,
  blocks: TimedBlock[],
  tasks: TaskLoad[],
  range: Range,
  /** Today: late tasks weigh on it (without it, on their due day). */
  today?: string,
): DayLoad {
  const rangeMin = (range.endHour - range.startHour) * 60;
  const parts: { category: string; part: [number, number] }[] = [];
  for (const b of blocks) {
    const part = clip(b, day, range);
    if (part) parts.push({ category: b.category, part });
  }
  const byCat = new Map<string, number>();
  for (const { category, part } of parts)
    byCat.set(category, (byCat.get(category) ?? 0) + part[1] - part[0]);
  const due = tasks.filter((t) => weighsOn(t.due, today) === day);
  const estimates = due.reduce((s, t) => s + (t.estimateMin ?? 0), 0);
  if (estimates) byCat.set(TASKS_CATEGORY, (byCat.get(TASKS_CATEGORY) ?? 0) + estimates);
  const totalMin = [...byCat.values()].reduce((s, m) => s + m, 0);
  const freeMin = Math.max(0, rangeMin - unionLength(parts.map((p) => p.part)));
  const ratio = rangeMin > 0 ? totalMin / rangeMin : 1;
  return {
    day,
    byCategory: [...byCat]
      .map(([category, minutes]) => ({ category, minutes }))
      .sort((a, b) => b.minutes - a.minutes || a.category.localeCompare(b.category)),
    totalMin,
    rangeMin,
    freeMin,
    state: ratio < LIGHT_UNDER ? 'léger' : ratio < BUSY_UNDER ? 'chargé' : 'saturé',
    tasksWithoutEstimate: due.filter((t) => t.estimateMin === null).length,
  };
}

export interface WeekSummary {
  days: DayLoad[];
  /** « X h de libre »: the free minutes of the week. */
  freeMin: number;
  /** « Y h à caser »: the estimates of the tasks weighing on this week (late ones: this week if today is in it). */
  toPlaceMin: number;
  /** « + 3 tâches sans durée ». */
  tasksWithoutEstimate: number;
}

export function weekSummary(
  firstDay: string,
  count: number,
  blocks: TimedBlock[],
  tasks: TaskLoad[],
  range: Range,
  today?: string,
): WeekSummary {
  const lastDay = addDays(firstDay, count - 1);
  const days: DayLoad[] = [];
  for (let i = 0; i < count; i++)
    days.push(dayLoad(addDays(firstDay, i), blocks, tasks, range, today));
  const due = tasks.filter((t) => {
    const on = weighsOn(t.due, today);
    return on !== null && on >= firstDay && on <= lastDay;
  });
  return {
    days,
    freeMin: days.reduce((s, d) => s + d.freeMin, 0),
    toPlaceMin: due.reduce((s, t) => s + (t.estimateMin ?? 0), 0),
    tasksWithoutEstimate: due.filter((t) => t.estimateMin === null).length,
  };
}

export interface Placed {
  id: string;
  /** Minutes from midnight of the day (clipped to the day: 0 – 1440). */
  from: number;
  to: number;
  /** Its column among the blocks it overlaps, and how many columns there are. */
  lane: number;
  lanes: number;
  /** It shares a moment with another block. */
  overlaps: boolean;
}

/** The day's timed blocks, side by side when they overlap. */
export function placeDay(day: string, blocks: TimedBlock[]): Placed[] {
  const parts = blocks
    .map((b) => {
      const from = Math.max(0, minutesBetween(`${day}T00:00`, b.start));
      const to = Math.min(24 * 60, minutesBetween(`${day}T00:00`, b.end));
      return { id: b.id, from, to };
    })
    .filter((p) => p.to > p.from)
    .sort((a, b) => a.from - b.from || b.to - a.to || a.id.localeCompare(b.id));
  const placed: Placed[] = [];
  // Groups of blocks that overlap each other (transitively): columns inside a group.
  let group: Placed[] = [];
  let groupEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...group.map((p) => p.lane + 1));
    for (const p of group) {
      p.lanes = lanes;
      p.overlaps = group.length > 1 && group.some((q) => q !== p && q.from < p.to && p.from < q.to);
    }
    placed.push(...group);
    group = [];
  };
  for (const part of parts) {
    if (part.from >= groupEnd && group.length) close();
    const used = new Set(group.filter((p) => p.to > part.from).map((p) => p.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    group.push({ ...part, lane, lanes: 1, overlaps: false });
    groupEnd = Math.max(groupEnd, part.to);
  }
  if (group.length) close();
  return placed;
}

/**
 * v0.36.0: the free slots of a day in its range (the phone's day view: a tap
 * on one creates there), `minMin` minutes at least, blocks merged.
 */
export function freeGaps(
  day: string,
  blocks: TimedBlock[],
  range: Range,
  minMin = 30,
): { from: number; to: number }[] {
  const lo = range.startHour * 60;
  const hi = range.endHour * 60;
  const busy = blocks
    .map((b) => clip(b, day, range))
    .filter((p): p is [number, number] => p !== null)
    .sort((a, b) => a[0] - b[0]);
  const gaps: { from: number; to: number }[] = [];
  let at = lo;
  for (const [from, to] of busy) {
    if (from - at >= minMin) gaps.push({ from: at, to: from });
    at = Math.max(at, to);
  }
  if (hi - at >= minMin) gaps.push({ from: at, to: hi });
  return gaps;
}
