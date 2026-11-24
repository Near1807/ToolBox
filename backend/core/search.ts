import type { ModuleLogger, SearchProvider, SearchResult } from '../../packages/sdk/backend';

// v0.47.0 (Expérimental): the hub's search (Ctrl+K anywhere, MODULES.md §5.18,
// ADR 0057). A module registers a provider (title, extract, icon, route that
// opens it); the hub asks them all and gives the results by module. Read
// only. Portable: no Node import (the phone's host uses it too).

export interface SearchGroup {
  moduleId: string;
  label: string;
  results: SearchResult[];
  /** The module's page with every result (`SearchProvider.more`). */
  more?: string;
  /** Time the provider took (ms). */
  ms: number;
  /** The provider failed (its message): the other groups are still given. */
  error?: string;
}

/** A provider that takes longer is left out of this answer (the page never waits for it). */
const PROVIDER_TIMEOUT_MS = 2000;

export class SearchRegistry {
  private readonly providers = new Map<string, SearchProvider>();

  constructor(
    private readonly nameOf: (moduleId: string) => string = (id) => id,
    private readonly logger?: ModuleLogger,
  ) {}

  forModule(moduleId: string, onDispose: (dispose: () => void) => void) {
    onDispose(() => this.providers.delete(moduleId));
    return {
      provide: (provider: SearchProvider) => {
        this.providers.set(moduleId, provider);
      },
    };
  }

  list(): string[] {
    return [...this.providers.keys()];
  }

  /** Every provider for a query (at most `limit` results each), in parallel. */
  async search(query: string, limit = 8): Promise<SearchGroup[]> {
    const q = query.trim().slice(0, 200);
    if (!q) return [];
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const groups = await Promise.all(
      [...this.providers].map(async ([moduleId, provider]): Promise<SearchGroup> => {
        const t0 = now();
        const label = provider.label ?? this.nameOf(moduleId);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const results = await Promise.race([
            Promise.resolve(provider.search(q, limit)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('trop lent')), PROVIDER_TIMEOUT_MS);
            }),
          ]);
          return {
            moduleId,
            label,
            results: results.slice(0, limit).filter((r) => typeof r.open === 'string'),
            ...(provider.more ? { more: provider.more(q) } : {}),
            ms: Math.round((now() - t0) * 10) / 10,
          };
        } catch (error) {
          this.logger?.warn(`Recherche : le module « ${moduleId} » a échoué`, error);
          return { moduleId, label, results: [], ms: Math.round(now() - t0), error: String(error) };
        } finally {
          if (timer) clearTimeout(timer);
        }
      }),
    );
    return groups.filter((g) => g.results.length || g.error);
  }
}
