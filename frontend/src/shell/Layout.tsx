import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Activity, FolderOpen, House, ScrollText, Settings, Wrench } from 'lucide-react';
import { groupBySection, hasMainPage, useModules } from '../modules/ModulesContext';
import { FullscreenButton, useFullscreen, WindowButtons } from './WindowControls';

export function Layout() {
  const { modules } = useModules();
  const fullscreen = useFullscreen();
  const navigate = useNavigate();
  // A desktop notification was clicked: open the page it points to.
  useEffect(() => window.toolbox?.onNavigate?.((target) => void navigate(target)), [navigate]);
  const sections = groupBySection(
    modules.filter((m) => hasMainPage(m) && !m.frontend?.nav?.hidden),
  );

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Navigation principale">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark">
            <Wrench size={15} />
          </span>
          ToolBox
        </div>
        <NavLink to="/" end className="nav-link">
          <House size={16} />
          <span className="nav-link__label">Accueil</span>
        </NavLink>
        {sections.map((section) => (
          <div key={section.name} className="sidebar__section">
            <div className="sidebar__section-title">{section.name}</div>
            {section.modules.map((module) => (
              <NavLink key={module.id} to={`/m/${module.id}`} className="nav-link">
                <span className="nav-link__icon">{module.manifest.icon}</span>
                <span className="nav-link__label">
                  {module.frontend?.nav?.label ?? module.manifest.name}
                </span>
              </NavLink>
            ))}
          </div>
        ))}
        <div className="sidebar__spacer" />
        <NavLink to="/outputs" className="nav-link">
          <FolderOpen size={16} />
          <span className="nav-link__label">Fichiers générés</span>
        </NavLink>
        <NavLink to="/jobs" className="nav-link">
          <Activity size={16} />
          <span className="nav-link__label">Tâches</span>
        </NavLink>
        <NavLink to="/logs" className="nav-link">
          <ScrollText size={16} />
          <span className="nav-link__label">Journaux</span>
        </NavLink>
        <NavLink to="/settings" className="nav-link">
          <Settings size={16} />
          <span className="nav-link__label">Réglages</span>
        </NavLink>
        <FullscreenButton fullscreen={fullscreen} />
      </nav>
      <main className="content">
        <Outlet />
      </main>
      <WindowButtons fullscreen={fullscreen} />
    </div>
  );
}
