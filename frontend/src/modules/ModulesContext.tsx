import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  PresentModulesProvider,
  useApi,
  type FrontendModule,
  type ModuleInfo,
  type PresentModule,
} from '@hub/sdk/frontend';
import { moduleFrontends } from './registry';

export interface ShellModule extends ModuleInfo {
  frontend?: FrontendModule;
}

interface ModulesState {
  modules: ShellModule[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const ModulesContext = createContext<ModulesState>({
  modules: [],
  loading: true,
  error: null,
  reload: () => {},
});

/** The backend is the source of truth for which modules are loaded. */
export function ModulesProvider(props: { children: ReactNode }) {
  const { data, loading, error, reload } = useApi<ModuleInfo[]>('/api/core/modules');
  const value = useMemo(
    () => ({
      modules: (data ?? []).map((info) => ({ ...info, frontend: moduleFrontends.get(info.id) })),
      loading,
      error,
      reload,
    }),
    [data, loading, error, reload],
  );
  return <ModulesContext.Provider value={value}>{props.children}</ModulesContext.Provider>;
}

export function useModules(): ModulesState {
  return useContext(ModulesContext);
}

export function hasMainPage(module: ShellModule): boolean {
  return module.status === 'loaded' && Boolean(module.frontend?.pages?.some((p) => p.path === ''));
}

/**
 * v0.36.0 (ADR 0046): the modules loaded right now, for the components they
 * lend each other and the « Ajouter » bar (a module absent lends nothing).
 */
export function PresentModules(props: { children: ReactNode }) {
  const { modules } = useModules();
  const present = useMemo(
    () =>
      modules
        .filter((m) => m.status === 'loaded' && m.frontend)
        .map((m): PresentModule => ({ manifest: m.manifest, frontend: m.frontend! })),
    [modules],
  );
  return <PresentModulesProvider modules={present}>{props.children}</PresentModulesProvider>;
}
