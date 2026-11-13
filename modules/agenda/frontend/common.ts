// What the Agenda's pages share: the period read, the layers (categories
// shown or hidden, a display setting of this device only), and how a block
// of another module or of the Agenda is drawn.
import { useCallback, useState } from 'react';
import { useApi, useModule } from '@hub/sdk/frontend';
import { categoryColor, isOn } from '../shared/categories';
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

/** Can be moved and stretched in the week: the Agenda's events at a time, and the planned tasks. */
export const movable = (i: Item) => !i.event.allDay && (i.source === 'own' || i.source === 'task');

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
  return [...data.events, ...data.foreign, ...data.tasks]
    .filter((e) => !e.allDay && shown(e.category))
    .map((e) => ({ id: e.id, start: e.start, end: e.end, category: e.category }));
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

/** The block's colours: its category's token (never a colour of its own). */
export const colorStyle = (category: string) =>
  ({ '--ag-color': categoryColor(category) }) as React.CSSProperties;

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
