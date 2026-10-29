import type { CalendarEvent, CalendarSource, ModuleLogger } from '../../packages/sdk/backend';

// « Prêt pour le calendrier » (MODULES.md §5.17): every module with dated
// items registers a source; the future general calendar asks them all for a
// period. Read only: a source never changes anything when asked.

export class CalendarRegistry {
  private readonly sources = new Map<string, CalendarSource>();

  forModule(moduleId: string, onDispose: (dispose: () => void) => void) {
    onDispose(() => this.sources.delete(moduleId));
    return {
      provide: (source: CalendarSource) => {
        this.sources.set(moduleId, source);
      },
    };
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
