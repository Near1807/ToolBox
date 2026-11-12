// What the Agenda's pages share: the period read, the layers (categories
// shown or hidden, a display setting of this device only), and how a block
// of another module or of the Agenda is drawn.
import { useCallback, useState } from 'react';
import { useApi, useModule } from '@hub/sdk/frontend';
import { categoryColor } from '../shared/categories';
import type { TimedBlock, TaskLoad } from '../shared/load';
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

const HIDDEN_KEY = 'toolbox.agenda.hiddenCategories';

function readHidden(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** The layers: the categories hidden on this device (not synchronised). */
export function useLayers() {
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const toggle = useCallback((category: string) => {
    setHidden((list) => {
      const next = list.includes(category)
        ? list.filter((c) => c !== category)
        : [...list, category];
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
      } catch {
        // Not kept: shown again next time.
      }
      return next;
    });
  }, []);
  return { hidden, toggle, shown: (category: string) => !hidden.includes(category) };
}

/** Every event of the period (own and foreign), the layers applied. */
export function itemsOf(data: RangeDto, shown: (category: string) => boolean): Item[] {
  return [
    ...data.events.map((event) => ({ source: 'own' as const, event })),
    ...data.foreign.map((event) => ({ source: 'foreign' as const, event })),
    ...data.tasks.map((event) => ({ source: 'task' as const, event })),
  ]
    .filter((i) => shown(i.event.category))
    .sort((a, b) => a.event.start.localeCompare(b.event.start));
}

/** For the load: every timed block (all of them, whatever the layers: the real load). */
export function timedBlocks(data: RangeDto): TimedBlock[] {
  return [...data.events, ...data.foreign, ...data.tasks]
    .filter((e) => !e.allDay)
    .map((e) => ({ id: e.id, start: e.start, end: e.end, category: e.category }));
}

export const taskLoads = (data: RangeDto): TaskLoad[] =>
  data.toPlace.map((t) => ({ id: t.id, due: t.due, estimateMin: t.estimateMin }));

/** The block's colours: its category's token (never a colour of its own). */
export const colorStyle = (category: string) =>
  ({ '--ag-color': categoryColor(category) }) as React.CSSProperties;
