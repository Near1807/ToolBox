// What the Agenda's pages share: the period read, the layers (categories
// shown or hidden, a display setting of this device only), and how a block
// of another module or of the Agenda is drawn.
import { useCallback, useState } from 'react';
import { useApi, useModule } from '@hub/sdk/frontend';
import { categoryColor, type CategoryDto, defaultShape, isOn } from '../shared/categories';
import { blockInk, isFreeColor, parseColor, type Rgb } from '../shared/palette';
import { foldName } from '../shared/category-id';
import { TASKS_CATEGORY, type TimedBlock, type TaskLoad } from '../shared/load';
import type { AgendaEventDto, ForeignEventDto, PlannedTaskDto, RangeDto } from '../shared/types';

/** One thing drawn in a day: an event of the Agenda or of another module. */
export type Item =
  | { source: 'own'; event: AgendaEventDto }
  | { source: 'foreign'; event: ForeignEventDto }
  /** v0.35.0: a task of the To-do planned at a time (moved through the To-do's service). */
  | { source: 'task'; event: PlannedTaskDto };

export const itemId = (i: Item) =>
  i.source === 'own'
    ? `own:${i.event.id}`
    : i.source === 'task'
      ? `task:${i.event.id}`
      : i.event.id;

/** v0.42.0: an event of the Agenda whose category has the « deadline » shape (a moment). */
export const isDeadlineItem = (i: Item): boolean => i.source === 'own' && Boolean(i.event.deadline);

/** Can be moved and stretched in the week: the Agenda's events at a time, and the planned tasks. */
/** v0.40.0: an event of the Agenda marked « facultatif » (never a task, never another module's). */
export const isOptional = (i: Item) =>
  i.source === 'own' && Boolean((i.event as { optional?: true }).optional);

/**
 * v0.41.0: the place of an item, as stored (an event of the Agenda; the
 * planned tasks and the other tools give none), or null.
 */
export const placeOf = (i: Item): string | null =>
  i.source === 'own' ? (i.event.location?.trim() ?? '') || null : null;

/** The places of an import (« 2F51;2E51;2E44 », or with commas), one by one. */
export const places = (place: string): string[] =>
  place
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter(Boolean);

/** v0.41.0: the place in a block: the first two, « … » when there are more. */
export function shortPlace(place: string): string {
  const all = places(place);
  return all.length > 2 ? `${all.slice(0, 2).join(', ')}…` : all.join(', ');
}

/** The place in full (the preview, the sheet): every one, separated by commas. */
export const fullPlace = (place: string): string => places(place).join(', ');

export const movable = (i: Item) =>
  !i.event.allDay && !isDeadlineItem(i) && (i.source === 'own' || i.source === 'task');

export function useRange(from: string, to: string) {
  const module = useModule();
  return useApi<RangeDto>(module.url(`/range?from=${from}&to=${to}`));
}

const SWITCHES_KEY = 'toolbox.agenda.categorySwitches';
/** v0.34.0's layers (categories hidden): read once, as switches off. */
const OLD_HIDDEN_KEY = 'toolbox.agenda.hiddenCategories';

function readChoices(): Record<string, boolean> {
  try {
    const value = JSON.parse(localStorage.getItem(SWITCHES_KEY) ?? 'null') as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value))
      return Object.fromEntries(
        Object.entries(value).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'),
      );
    const old = JSON.parse(localStorage.getItem(OLD_HIDDEN_KEY) ?? '[]') as unknown;
    return Array.isArray(old)
      ? Object.fromEntries(old.filter((c) => typeof c === 'string').map((c) => [c, false]))
      : {};
  } catch {
    return {};
  }
}

/**
 * The category switches (v0.35.0): ON = shown and counted, OFF = neither.
 * The device's choices (local, never synchronised), else the default
 * (`offByDefault`: the setting, Sport, Repas and Timer at first).
 */
export function useSwitches(offByDefault: readonly string[]) {
  const [choices, setChoices] = useState<Record<string, boolean>>(readChoices);
  const shown = useCallback(
    (category: string) => isOn(category, choices, offByDefault),
    [choices, offByDefault],
  );
  const toggle = useCallback(
    (category: string) => {
      setChoices((current) => {
        const next = { ...current, [category]: !isOn(category, current, offByDefault) };
        try {
          localStorage.setItem(SWITCHES_KEY, JSON.stringify(next));
        } catch {
          // Not kept: the default comes back next time.
        }
        return next;
      });
    },
    [offByDefault],
  );
  return { shown, toggle };
}

/** Every event of the period (own, foreign, planned tasks), the switches applied. */
export function itemsOf(data: RangeDto, shown: (category: string) => boolean): Item[] {
  return [
    ...data.events.map((event) => ({ source: 'own' as const, event })),
    ...data.foreign.map((event) => ({ source: 'foreign' as const, event })),
    ...data.tasks.map((event) => ({ source: 'task' as const, event })),
  ]
    .filter((i) => shown(i.event.category))
    .sort((a, b) => a.event.start.localeCompare(b.event.start));
}

/** For the load, the free time and the overlaps: the timed blocks of the categories switched ON. */
export function timedBlocks(
  data: RangeDto,
  shown: (category: string) => boolean = () => true,
): TimedBlock[] {
  return (
    [...data.events, ...data.foreign, ...data.tasks]
      .filter((e) => !e.allDay && shown(e.category))
      // v0.40.0: a « facultatif » event weighs nothing (like a category switched off).
      .filter((e) => !('optional' in e && e.optional))
      // v0.42.0: a category not counted (Réglages), and (v0.43.0) a deadline — its own
      // type, whatever its category — weigh nothing.
      // An occurrence of the week type has no type of its own: as in v0.42, one in a category
      // whose default type is Deadline weighs nothing either.
      .filter(
        (e) =>
          isCounted(e.category) &&
          !('deadline' in e && e.deadline) &&
          !('weekly' in e && e.weekly && isDeadline(e.category)),
      )
      .map((e) => ({ id: e.id, start: e.start, end: e.end, category: e.category }))
  );
}

/** The estimates of the tasks to fit in (none when « Tâches » is switched off). */
export const taskLoads = (
  data: RangeDto,
  shown: (category: string) => boolean = () => true,
): TaskLoad[] =>
  shown(TASKS_CATEGORY)
    ? data.toPlace.map((t) => ({ id: t.id, due: t.due, estimateMin: t.estimateMin }))
    : [];

/** The switches to show: the categories of the period, and « Tâches » with the To-do. */
export const switchCategories = (data: RangeDto) =>
  [...new Set([...data.categories, ...(data.todo ? [TASKS_CATEGORY] : [])])].sort((a, b) =>
    a.localeCompare(b),
  );

// --- v0.42.0: the colours chosen by Thomas ---------------------------------------
// The list read with each period (RangeDto.categoryInfo) or from Réglages:
// what colorStyle draws. Without it (or for a category it does not know):
// the token of before.

const registry = new Map<string, CategoryDto>();

/** Keep the list of the categories (their colour, shape…), for every block drawn after. */
export function rememberCategories(list: readonly CategoryDto[] | undefined): void {
  if (!list) return;
  registry.clear();
  for (const c of list) registry.set(foldName(c.name), c);
}

/** One more (just created): offered at once, before the next reading. */
export function rememberCategory(c: CategoryDto): void {
  registry.set(foldName(c.name), c);
}

/** Every category known, in Thomas's order (the choices of the sheet, the bar, a slot). */
export const knownCategories = (): CategoryDto[] => [...registry.values()];

/** What the Agenda knows of a category (null: a name it never saw). */
export const categoryInfo = (category: string): CategoryDto | null =>
  registry.get(foldName(category)) ?? null;

/** v0.43.0: its elements are flagged when they overlap (a category can say no). */
export const conflictsOn = (category: string) => categoryInfo(category)?.conflicts ?? true;

/** The CSS value of a category's colour: Thomas's choice, else its token. */
export const categoryCss = (category: string) =>
  categoryInfo(category)?.css ?? categoryColor(category);

/** Is « Deadline » the default type of this category (v0.42: its shape)? */
export const isDeadline = (category: string) =>
  (categoryInfo(category)?.shape ?? defaultShape(category)) === 'deadline';

/** Counted in the load (Réglages › Agenda › Catégories)? */
export const isCounted = (category: string) => categoryInfo(category)?.counted ?? true;

let inks: { theme: string; surface: Rgb; text: Rgb; other: Rgb } | null = null;
/** The theme's surface and inks (read once per theme), for a free colour's text. */
function themeInks() {
  if (typeof document === 'undefined') return null;
  const root = document.documentElement;
  const theme = `${root.dataset.theme ?? ''}:${root.dataset.scheme ?? ''}`;
  if (inks?.theme === theme) return inks;
  const style = getComputedStyle(root);
  const read = (name: string) => parseColor(style.getPropertyValue(name));
  const surface = read('--surface');
  const text = read('--text');
  const other = read('--bg');
  if (!surface || !text || !other) return null;
  inks = { theme, surface, text, other };
  return inks;
}

/**
 * A free colour (« #rrggbb ») on the current theme: the ink that reads best
 * on its block, and whether it stays low (< 4.5:1). Null for a token.
 */
export function freeColorInk(
  css: string,
): { ink: 'text' | 'other'; ratio: number; low: boolean } | null {
  const rgb = isFreeColor(css) ? parseColor(css) : null;
  const t = rgb ? themeInks() : null;
  return rgb && t ? blockInk(rgb, t.surface, { text: t.text, other: t.other }) : null;
}

/** The block's colours: its category's (a token, or Thomas's free colour with a readable ink). */
export function colorStyle(category: string): React.CSSProperties {
  const css = categoryCss(category);
  const ink = freeColorInk(css);
  return {
    '--ag-color': css,
    ...(ink?.ink === 'other' ? { '--ag-ink': 'var(--bg)' } : {}),
  } as React.CSSProperties;
}

/** v0.36.0: what a timer started from the Agenda is for (an event, or one occurrence of the week type). */
export const timerSubject = (event: AgendaEventDto) =>
  event.weekly
    ? `agenda:weekly:${event.weekly.id}:${event.weekly.date}`
    : `agenda:event:${event.id}`;

/** v0.36.0: is this item's timer the one running now? */
export function timerRuns(data: RangeDto, item: Item): boolean {
  if (!data.timer) return false;
  if (item.source === 'task') return data.timer.taskId === item.event.id;
  if (item.source === 'own') return data.timer.subject === timerSubject(item.event);
  return false;
}
