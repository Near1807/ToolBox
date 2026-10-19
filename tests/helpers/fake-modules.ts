import type { BackendModule, ModuleManifest } from '@hub/sdk/backend';
import type { DiscoveredModule } from '../../backend/core/hub';

/** Builds an in-memory module, as if discovered in modules/<id>/. */
export function fakeModule(
  id: string,
  options: { manifest?: Partial<ModuleManifest>; backend?: Partial<BackendModule> } = {},
): DiscoveredModule {
  return {
    folder: id,
    manifest: {
      id,
      name: `Module ${id}`,
      description: 'test',
      version: '1.0.0',
      section: 'Tests',
      icon: '🧪',
      ...options.manifest,
    },
    backend: { register: () => {}, ...options.backend },
  };
}
