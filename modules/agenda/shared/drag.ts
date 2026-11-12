// Moving and stretching blocks in the week (v0.35.0), pure and tested
// (tests/drag.test.ts): what a drop gives, never written before the drop.
// - snap to the quarter of an hour;
// - a block moved keeps its length, its start stays in its day (00:00 –
//   23:45), it can change day;
// - a block stretched keeps its start, 15 minutes at least;
// - a task dropped from « À caser » starts where it is dropped, for its
//   estimate (30 min without one).
import { DEFAULT_PLANNED_MIN } from '@hub/sdk/dates';
import { addDays, addMinutes, minutesBetween, minutesOfDay, timeOf } from './time';

/** Magnetism, in minutes. */
export const SNAP_MIN = 15;
/** A block is never shorter. */
export const MIN_BLOCK_MIN = 15;
const DAY_MIN = 24 * 60;

export interface Span {
  /** « YYYY-MM-DDTHH:mm » */
  start: string;
  end: string;
}

export const snap = (minutes: number) => Math.round(minutes / SNAP_MIN) * SNAP_MIN;

const clampStart = (minutes: number) => Math.min(DAY_MIN - SNAP_MIN, Math.max(0, minutes));

/** A block moved by `dayDelta` days and `deltaMin` minutes (the pointer's way), snapped. */
export function moveSpan(span: Span, dayDelta: number, deltaMin: number): Span {
  const length = minutesBetween(span.start, span.end);
  const day = addDays(span.start.slice(0, 10), dayDelta);
  const minutes = clampStart(snap(minutesOfDay(span.start.slice(11)) + deltaMin));
  const start = `${day}T${timeOf(minutes)}`;
  return { start, end: addMinutes(start, length) };
}

/** A block whose bottom is pulled by `deltaMin` minutes: its end snapped, 15 min at least. */
export function stretchSpan(span: Span, deltaMin: number): Span {
  const length = Math.max(MIN_BLOCK_MIN, snap(minutesBetween(span.start, span.end) + deltaMin));
  return { start: span.start, end: addMinutes(span.start, length) };
}

/** A task dropped on `day` at `minutes` (the pointer), for its estimate. */
export function placeSpan(day: string, minutes: number, estimateMin: number | null): Span {
  const start = `${day}T${timeOf(clampStart(snap(minutes)))}`;
  return { start, end: addMinutes(start, estimateMin ?? DEFAULT_PLANNED_MIN) };
}

/** True when the drop changes nothing (a click, or a move back where it was). */
export const sameSpan = (a: Span, b: Span) => a.start === b.start && a.end === b.end;

/** « 14:15–15:15 » (the preview while dragging). */
export const spanLabel = (span: Span) => `${span.start.slice(11)}–${span.end.slice(11)}`;
