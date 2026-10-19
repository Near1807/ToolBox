import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useApi, type FrontendModule, type ModuleInfo } from '@hub/sdk/frontend';
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

export interface ModuleSection {
  name: string;
  modules: ShellModule[];
}

/** Groups modules by manifest.section; sections and modules sorted by `order`, then name. */
export function groupBySection(modules: ShellModule[]): ModuleSection[] {
  const order = (m: ShellModule) => m.manifest.order ?? 100;
  const sorted = [...modules].sort(
    (a, b) => order(a) - order(b) || a.manifest.name.localeCompare(b.manifest.name, 'fr'),
  );
  const sections = new Map<string, ShellModule[]>();
  for (const module of sorted) {
    const list = sections.get(module.manifest.section) ?? [];
    list.push(module);
    sections.set(module.manifest.section, list);
  }
  return [...sections.entries()]
    .map(([name, list]) => ({ name, modules: list }))
    .sort(
      (a, b) => order(a.modules[0]!) - order(b.modules[0]!) || a.name.localeCompare(b.name, 'fr'),
    );
}

export function hasMainPage(module: ShellModule): boolean {
  return module.status === 'loaded' && Boolean(module.frontend?.pages?.some((p) => p.path === ''));
}
