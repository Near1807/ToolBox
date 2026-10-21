import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { NavigationProvider } from './NavigationContext';
import { Sidebar } from './Sidebar';
import { useFullscreen, WindowButtons } from './WindowControls';

export function Layout() {
  const fullscreen = useFullscreen();
  const navigate = useNavigate();
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
      </div>
    </NavigationProvider>
  );
}
