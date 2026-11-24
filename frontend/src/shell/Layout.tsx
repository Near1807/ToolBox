import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { ModuleBackgrounds } from '../modules/ModuleExtras';
import { NavigationProvider } from './NavigationContext';
import { QuickAdd } from './QuickAdd';
import { SearchPalette } from './SearchPalette';
import { Sidebar } from './Sidebar';
import { useThemeAutomation } from './theme-automation';
import { useFullscreen, WindowButtons } from './WindowControls';

/**
 * v0.47.0: a reading window (ADR 0058) — a module's page alone: no sidebar,
 * no « Ajouter », no search; the theme of the app.
 */
export function WindowLayout() {
  useThemeAutomation();
  return (
    <div className="app app--window">
      <main className="content content--window">
        <Outlet />
      </main>
    </div>
  );
}

export function Layout() {
  const fullscreen = useFullscreen();
  const navigate = useNavigate();
  useThemeAutomation();
  // A desktop notification was clicked: open the page it points to.
  useEffect(() => window.toolbox?.onNavigate?.((target) => void navigate(target)), [navigate]);

  return (
    <NavigationProvider>
      <div className="app">
        <Sidebar fullscreen={fullscreen} />
        <main className="content">
          <Outlet />
        </main>
        <WindowButtons fullscreen={fullscreen} />
        <QuickAdd />
        <SearchPalette />
        <ModuleBackgrounds />
      </div>
    </NavigationProvider>
  );
}
