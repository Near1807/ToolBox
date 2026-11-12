import type {
  CalendarEvent,
  CalendarSource,
  CalendarView,
  ModuleLogger,
} from '../../packages/sdk/backend';

// « Prêt pour le calendrier » (MODULES.md §5.17): every module with dated
// items registers a source; the future general calendar asks them all for a
// period. Read only: a source never changes anything when asked.
// v0.34.0: `query` (for the Agenda) adds the category of each event and the
// items to fit in; GET /api/core/calendar answers exactly as before.
// Portable: no Node import (the phone's host uses it too).

export class CalendarRegistry {
  private readonly sources = new Map<string, CalendarSource>();

  constructor(
    /** The name of a module (its manifest), the category by default. */
    private readonly nameOf: (moduleId: string) => string = (id) => id,
    private readonly logger?: ModuleLogger,
  ) {}

  forModule(moduleId: string, onDispose: (dispose: () => void) => void) {
    onDispose(() => this.sources.delete(moduleId));
    return {
      provide: (source: CalendarSource) => {
        this.sources.set(moduleId, source);
      },
      query: (from: string, to: string) => this.query(from, to),
    };
  }

  /** Every source for a period: events and items to fit in, with module and category. */
  async query(from: string, to: string): Promise<CalendarView> {
    const view: CalendarView = { events: [], items: [], itemSources: [] };
    for (const [moduleId, source] of this.sources) {
      const fallback = source.category ?? this.nameOf(moduleId);
      if (source.unscheduled) view.itemSources.push(moduleId);
      try {
        for (const event of await source.events(from, to))
          view.events.push({ ...event, moduleId, category: event.category ?? fallback });
        for (const item of (await source.unscheduled?.(from, to)) ?? [])
          view.items.push({ ...item, moduleId, category: item.category ?? fallback });
      } catch (error) {
        this.logger?.warn(`Calendrier : la source « ${moduleId} » a échoué`, error);
      }
    }
    view.events.sort((a, b) => a.start.localeCompare(b.start));
    view.items.sort(
      (a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title),
    );
    return view;
  }

  /** Modules that provide events. */
  list(): string[] {
    return [...this.sources.keys()];
  }

  /** Events of every source between `from` and `to` (ISO dates or date-times), by start. */
  async events(from: string, to: string, logger: ModuleLogger): Promise<CalendarEvent[]> {
    const all: CalendarEvent[] = [];
    for (const [moduleId, source] of this.sources) {
      try {
        for (const event of await source.events(from, to)) all.push({ ...event, moduleId });
      } catch (error) {
        logger.warn(`Calendrier : la source « ${moduleId} » a échoué`, error);
      }
    }
    return all.sort((a, b) => a.start.localeCompare(b.start));
  }
}
