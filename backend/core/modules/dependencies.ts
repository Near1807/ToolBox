import type { ModuleManifest } from '../../../packages/sdk/manifest';

export interface DependencyPlan {
  /** Modules that can be loaded, in an order where providers come first. */
  order: string[];
  /** Modules that cannot be loaded, with a French explanation. */
  blocked: Map<string, string>;
}

/**
 * Decides which modules can load and in which order. A module is blocked when a
 * required module is absent/unavailable, when no available module provides a
 * required service, or when it is part of a dependency cycle. Blocking cascades.
 * `unavailable` lists modules already known not to load (invalid, disabled…).
 */
export function planModuleLoading(
  manifests: ModuleManifest[],
  unavailable: Map<string, string> = new Map(),
): DependencyPlan {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const blocked = new Map<string, string>();
  const candidates = manifests.filter((m) => !unavailable.has(m.id));

  const providerOf = (service: string): ModuleManifest | undefined =>
    candidates.find((m) => m.provides?.services?.includes(service));

  const requirements = (m: ModuleManifest): { id: string; reason: string }[] => [
    ...(m.dependsOn?.modules ?? []).map((dep) => ({
      id: dep,
      reason: `le module « ${dep} »`,
    })),
    ...(m.dependsOn?.services ?? []).map((service) => ({
      id: providerOf(service)?.id ?? `?service:${service}`,
      reason: `le service « ${service} »`,
    })),
  ];

  const explain = (dep: { id: string; reason: string }): string => {
    if (dep.id.startsWith('?service:')) return `${dep.reason} n'est fourni par aucun module`;
    if (!byId.has(dep.id)) return `${dep.reason} est absent`;
    const why = unavailable.get(dep.id) ?? blocked.get(dep.id);
    return `${dep.reason} est indisponible${why ? ` (${why})` : ''}`;
  };

  // Propagate blocking until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of candidates) {
      if (blocked.has(m.id)) continue;
      const missing = requirements(m).find(
        (dep) =>
          dep.id.startsWith('?service:') ||
          !byId.has(dep.id) ||
          unavailable.has(dep.id) ||
          blocked.has(dep.id),
      );
      if (missing) {
        blocked.set(m.id, `Dépendance manquante : ${explain(missing)}`);
        changed = true;
      }
    }
  }

  // Topological order (Kahn) among the remaining modules; leftovers are cycles.
  const remaining = candidates.filter((m) => !blocked.has(m.id));
  const order: string[] = [];
  const placed = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const m of remaining) {
      if (placed.has(m.id)) continue;
      const deps = requirements(m)
        .map((d) => d.id)
        .filter((d) => d !== m.id);
      if (deps.every((d) => placed.has(d))) {
        order.push(m.id);
        placed.add(m.id);
        progress = true;
      }
    }
  }
  for (const m of remaining) {
    if (!placed.has(m.id)) blocked.set(m.id, 'Dépendance circulaire entre modules');
  }

  return { order, blocked };
}
