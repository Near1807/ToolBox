// The cooking slots of batch cooking, pure (tested in tests/batch.test.ts):
// the usual model (weekday × moment id, a setting of the module) projected on
// the dates of a period, and back. Indexed by moment id, never by name: a
// renamed moment keeps its slots, a deleted one is ignored.
import type { BatchSlot } from './batch';

/** Weekday (« 1 » = Monday … « 7 » = Sunday) → moment ids where cooking is possible. */
export type GridModel = Record<string, string[]>;

const DAY_MS = 86_400_000;
export const addDaysTo = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** 1 = Monday … 7 = Sunday. */
export const isoWeekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

/** The dates of the grid: from N days before the period to its last day. */
export function gridDates(from: string, to: string, daysBefore: number): string[] {
  const dates: string[] = [];
  for (let d = addDaysTo(from, -daysBefore); d <= to; d = addDaysTo(d, 1)) dates.push(d);
  return dates;
}

/** The model laid on the dates of a period (whatever its length and first day). */
export function projectModel(
  model: GridModel,
  dates: readonly string[],
  momentIds: readonly string[],
): BatchSlot[] {
  const known = new Set(momentIds);
  return dates.flatMap((date) =>
    (model[String(isoWeekday(date))] ?? [])
      .filter((id) => known.has(id))
      .sort((a, b) => momentIds.indexOf(a) - momentIds.indexOf(b))
      .map((momentId) => ({ date, momentId })),
  );
}

/**
 * « Retenir comme habituels »: a weekday × moment is kept when it is ticked on
 * at least one date of the period (days before the period not counted).
 */
export function modelFromSlots(
  slots: readonly BatchSlot[],
  from: string,
  to: string,
  momentIds: readonly string[],
): GridModel {
  const model: GridModel = {};
  for (const s of slots) {
    if (s.date < from || s.date > to || !momentIds.includes(s.momentId)) continue;
    const day = String(isoWeekday(s.date));
    model[day] = [...new Set([...(model[day] ?? []), s.momentId])];
  }
  for (const day of Object.keys(model))
    model[day]!.sort((a, b) => momentIds.indexOf(a) - momentIds.indexOf(b));
  return model;
}

/** A model read from the setting (JSON), safe whatever was stored. */
export function parseModel(raw: unknown): GridModel {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw || '{}');
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object') return {};
  const model: GridModel = {};
  for (const [day, ids] of Object.entries(value as Record<string, unknown>))
    if (/^[1-7]$/.test(day) && Array.isArray(ids))
      model[day] = ids.filter((id): id is string => typeof id === 'string');
  return model;
}
