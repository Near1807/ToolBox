import { Route, Routes } from 'react-router';
import { ModuleHost } from './modules/ModuleHost';
import { ModulesProvider } from './modules/ModulesContext';
import { HomePage } from './shell/HomePage';
import { JobsPage } from './shell/JobsPage';
import { Layout } from './shell/Layout';
import { LogsPage } from './shell/LogsPage';
import { NotFoundPage } from './shell/NotFoundPage';
import { SettingsPage } from './shell/settings/SettingsPage';

export function App() {
  return (
    <ModulesProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="m/:moduleId/*" element={<ModuleHost />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ModulesProvider>
  );
}
