import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { errorMessage } from '@hub/sdk/frontend';
import { hasMainPage, useModules, type ShellModule } from '../modules/ModulesContext';
import {
  buildNavigation,
  EMPTY_LAYOUT,
  parseLayout,
  serializeLayout,
  type NavCategory,
  type NavLayout,
  type NavTool,
} from './navigation';
import { loadUiPrefs, saveUiPrefs } from './ui-prefs';

export interface NavModule extends NavTool {
  module: ShellModule;
}

interface NavigationState {
  /** Sidebar: tools with a page. */
  sidebar: NavCategory<NavModule>[];
  /** Home page: same categories, plus modules in error and widget-only modules. */
  home: NavCategory<NavModule>[];
  layout: NavLayout;
  /** Applies a change computed from the sidebar navigation, then saves it. */
  change: (compute: (layout: NavLayout, nav: NavCategory<NavModule>[]) => NavLayout) => void;
  error: string | null;
}

const NavigationReactContext = createContext<NavigationState | null>(null);

const toTool = (module: ShellModule): NavModule => ({
  id: module.id,
  name: module.frontend?.nav?.label ?? module.manifest.name,
  section: module.manifest.section,
  order: module.manifest.order,
  module,
});

/** Sidebar layout shared by the sidebar and the home page (stored by the core: ui.navigation). */
export function NavigationProvider(props: { children: ReactNode }) {
  const { modules } = useModules();
  const [layout, setLayout] = useState<NavLayout>(EMPTY_LAYOUT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadUiPrefs()
      .then((prefs) => setLayout(parseLayout(prefs.navigation)))
      .catch(() => {
        // Backend not ready: default layout.
      });
  }, []);

  const sidebarTools = useMemo(
    () => modules.filter((m) => hasMainPage(m) && !m.frontend?.nav?.hidden).map(toTool),
    [modules],
  );
  // Service-only modules (no page, no widget) are not tools: they appear on the
  // home page only when something is wrong with them (see Réglages > Modules).
  const homeTools = useMemo(
    () =>
      modules
        .filter((m) => m.status !== 'loaded' || m.frontend?.pages?.length || m.frontend?.HomeWidget)
        .map(toTool),
    [modules],
  );
  const sidebar = useMemo(() => buildNavigation(sidebarTools, layout), [sidebarTools, layout]);
  const home = useMemo(() => buildNavigation(homeTools, layout), [homeTools, layout]);

  const change = useCallback<NavigationState['change']>(
    (compute) => {
      const next = compute(layout, sidebar);
      setLayout(next);
      setError(null);
      saveUiPrefs({ navigation: serializeLayout(next) }).catch((err: unknown) =>
        setError(`Disposition non enregistrée : ${errorMessage(err)}`),
      );
    },
    [layout, sidebar],
  );

  const value = useMemo(
    () => ({ sidebar, home, layout, change, error }),
    [sidebar, home, layout, change, error],
  );
  return (
    <NavigationReactContext.Provider value={value}>
      {props.children}
    </NavigationReactContext.Provider>
  );
}

export function useNavigation(): NavigationState {
  const value = useContext(NavigationReactContext);
  if (!value) throw new Error('useNavigation() hors de NavigationProvider');
  return value;
}
