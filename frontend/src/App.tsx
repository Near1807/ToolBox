import { Route, Routes } from 'react-router';
import { Layout } from './shell/Layout';
import { HomePage } from './shell/HomePage';
import { SettingsPage } from './shell/SettingsPage';
import { NotFoundPage } from './shell/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
