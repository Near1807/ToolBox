import { Route, Routes } from 'react-router';
import { ModuleHost } from './modules/ModuleHost';
import { OverlayPage } from './modules/ModuleExtras';
import { ModulesProvider, PresentModules } from './modules/ModulesContext';
import { HomePage } from './shell/HomePage';
import { JobsPage } from './shell/JobsPage';
import { Layout, WindowLayout } from './shell/Layout';
import { LogsPage } from './shell/LogsPage';
import { NotFoundPage } from './shell/NotFoundPage';
import { OutputsPage } from './shell/OutputsPage';
import { SettingsPage } from './shell/settings/SettingsPage';

export function App() {
  return (
    <ModulesProvider>
      <PresentModules>
        <Routes>
          <Route path="overlay" element={<OverlayPage />} />
          {/* v0.47.0: a module's page in a window of its own, without the shell (ADR 0058). */}
          <Route path="w" element={<WindowLayout />}>
            <Route path="m/:moduleId/*" element={<ModuleHost />} />
          </Route>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="m/:moduleId/*" element={<ModuleHost />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="outputs" element={<OutputsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </PresentModules>
    </ModulesProvider>
  );
}
