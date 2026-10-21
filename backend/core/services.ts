import type { ModuleManifest, ModuleServices } from '../../packages/sdk/backend';

/**
 * Registry of services exposed by modules. A module may only provide what its
 * manifest declares in provides.services, and only consume what it declares in
 * dependsOn.services (so the loader can check dependencies before loading) or,
 * when it works without them, in dependsOn.optionalServices.
 */
export class ServiceRegistry {
  private readonly services = new Map<string, { provider: string; implementation: object }>();

  has(name: string): boolean {
    return this.services.has(name);
  }

  providerOf(name: string): string | undefined {
    return this.services.get(name)?.provider;
  }

  forModule(manifest: ModuleManifest, pending: Map<string, object>): ModuleServices {
    const declaredProvides = new Set(manifest.provides?.services ?? []);
    const declaredUses = new Set(manifest.dependsOn?.services ?? []);
    const declaredOptional = new Set(manifest.dependsOn?.optionalServices ?? []);
    return {
      provide: (name, implementation) => {
        if (!declaredProvides.has(name)) {
          throw new Error(`Service « ${name} » non déclaré dans provides.services de module.json`);
        }
        if (this.services.has(name) || pending.has(name)) {
          throw new Error(`Le service « ${name} » est déjà fourni par un autre module`);
        }
        // Committed only if register() succeeds (see commit()).
        pending.set(name, implementation);
      },
      get: <T extends object>(name: string): T => {
        if (!declaredUses.has(name)) {
          throw new Error(`Service « ${name} » non déclaré dans dependsOn.services de module.json`);
        }
        const entry = this.services.get(name);
        if (!entry) throw new Error(`Service « ${name} » indisponible`);
        return entry.implementation as T;
      },
      optional: <T extends object>(name: string): T | undefined => {
        if (!declaredOptional.has(name)) {
          throw new Error(
            `Service « ${name} » non déclaré dans dependsOn.optionalServices de module.json`,
          );
        }
        return this.services.get(name)?.implementation as T | undefined;
      },
    };
  }

  commit(provider: string, pending: Map<string, object>): void {
    for (const [name, implementation] of pending) {
      this.services.set(name, { provider, implementation });
    }
  }
}
