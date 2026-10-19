import { NavLink, Outlet } from 'react-router';

export function Layout() {
  return (
    <div className="app">
      <nav className="sidebar" aria-label="Navigation principale">
        <div className="sidebar__brand">ToolBox</div>
        <NavLink to="/" end className="nav-link">
          Accueil
        </NavLink>
        <div className="sidebar__spacer" />
        <NavLink to="/settings" className="nav-link">
          Réglages
        </NavLink>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
