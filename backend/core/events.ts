import type { ModuleEvents, ModuleLogger } from '../../packages/sdk/backend';

type Handler = (payload: unknown) => void | Promise<void>;

/**
 * Process-wide event bus. Events are named "<source>:<name>"; a module can only
 * emit in its own namespace. Handler errors are logged, never propagated.
 */
export class EventBus {
  private readonly handlers = new Map<string, Set<Handler>>();

  emit(event: string, payload?: unknown, logger?: ModuleLogger): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          result.catch((error: unknown) =>
            logger?.error(`Erreur dans un écouteur de ${event}`, error),
          );
        }
      } catch (error) {
        logger?.error(`Erreur dans un écouteur de ${event}`, error);
      }
    }
  }

  on(event: string, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  /** Scoped API given to a module (or to the core with source "core"). */
  forSource(
    source: string,
    logger: ModuleLogger,
    track: (dispose: () => void) => void,
  ): ModuleEvents {
    return {
      emit: (name, payload) => {
        if (name.includes(':')) {
          throw new Error(
            `Nom d'événement invalide « ${name} » : le préfixe « ${source}: » est ajouté automatiquement`,
          );
        }
        this.emit(`${source}:${name}`, payload, logger);
      },
      on: (event, handler) => {
        if (!event.includes(':')) {
          throw new Error(
            `Événement « ${event} » : préciser la source, ex. « music-library:track.created »`,
          );
        }
        const wrapped: Handler = async (payload) => {
          try {
            await handler(payload);
          } catch (error) {
            logger.error(`Erreur dans l'écouteur de ${event}`, error);
          }
        };
        const off = this.on(event, wrapped);
        track(off);
        return off;
      },
    };
  }
}
