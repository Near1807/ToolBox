import { Link, Route, Routes, useParams } from 'react-router';
import { ErrorBoundary, ModuleProvider, Page } from '@hub/sdk/frontend';
import { useModules } from './ModulesContext';

const STATUS_LABELS: Record<string, string> = {
  failed: 'n’a pas pu démarrer',
  'missing-dependencies': 'ne peut pas démarrer : une dépendance manque',
  disabled: 'est désactivé',
};

/** Renders the pages of one module under /m/<id>/*, isolated in an error boundary. */
export function ModuleHost() {
  const { moduleId } = useParams();
  const { modules, loading } = useModules();
  const module = modules.find((m) => m.id === moduleId);

  if (loading) return null;
  if (!module) {
    return (
      <Page title="Module introuvable">
        <p>
          Aucun module « {moduleId} ». <Link to="/">Retour à l’accueil</Link>
        </p>
      </Page>
    );
  }
  if (module.status !== 'loaded') {
    return (
      <Page title={module.manifest.name}>
        <div className="card card--error">
          <strong>
            {module.manifest.name} {STATUS_LABELS[module.status]}.
          </strong>
          {module.error && <p>{module.error}</p>}
          <Link to="/settings">Voir les réglages des modules</Link>
        </div>
      </Page>
    );
  }

  const pages = module.frontend?.pages ?? [];
  return (
    <ModuleProvider manifest={module.manifest}>
      <ErrorBoundary label={module.manifest.name}>
        <Routes>
          {pages.map(({ path, component: Component }) => (
            <Route
              key={path}
              path={path === '' ? undefined : path}
              index={path === ''}
              element={<Component />}
            />
          ))}
          <Route path="*" element={<Page title="Page introuvable">{null}</Page>} />
        </Routes>
      </ErrorBoundary>
    </ModuleProvider>
  );
}
