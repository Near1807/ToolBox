import { Link } from 'react-router';
import { EmptyState, ErrorBoundary, ErrorMessage, ModuleProvider, Page } from '@hub/sdk/frontend';
import {
  groupBySection,
  hasMainPage,
  useModules,
  type ShellModule,
} from '../modules/ModulesContext';

const STATUS_BADGES: Record<string, string> = {
  failed: 'En erreur',
  'missing-dependencies': 'Dépendance manquante',
  disabled: 'Désactivé',
};

function ModuleCard({ module }: { module: ShellModule }) {
  const Widget = module.frontend?.HomeWidget;
  const body = (
    <>
      <div className="module-card__header">
        <span className="module-card__icon">{module.manifest.icon}</span>
        <span className="module-card__name">{module.manifest.name}</span>
        {module.status !== 'loaded' && (
          <span className="badge badge--warning">{STATUS_BADGES[module.status]}</span>
        )}
      </div>
      <p className="muted module-card__description">{module.manifest.description}</p>
      {module.status === 'loaded' && Widget && (
        <ModuleProvider manifest={module.manifest}>
          <ErrorBoundary label={module.manifest.name}>
            <Widget />
          </ErrorBoundary>
        </ModuleProvider>
      )}
    </>
  );

  if (hasMainPage(module)) {
    return (
      <Link to={`/m/${module.id}`} className="module-card module-card--link">
        {body}
      </Link>
    );
  }
  const target = module.status === 'loaded' ? null : '/settings';
  return target ? (
    <Link to={target} className="module-card module-card--disabled" title={module.error}>
      {body}
    </Link>
  ) : (
    <div className="module-card">{body}</div>
  );
}

export function HomePage() {
  const { modules, loading, error } = useModules();
  const sections = groupBySection(modules);

  return (
    <Page title="Accueil" subtitle="Tous tes outils, regroupés par section.">
      {error && <ErrorMessage>Impossible de charger les modules : {error}</ErrorMessage>}
      {!loading && !error && modules.length === 0 && (
        <EmptyState title="Aucun outil installé pour l’instant.">
          Les modules ajoutés au dossier « modules » apparaîtront ici.
        </EmptyState>
      )}
      {sections.map((section) => (
        <section key={section.name} className="home-section">
          <h2>{section.name}</h2>
          <div className="module-grid">
            {section.modules.map((module) => (
              <ModuleCard key={module.id} module={module} />
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}
