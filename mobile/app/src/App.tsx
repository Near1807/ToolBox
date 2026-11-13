// The mobile shell (ADR 0044): one column, navigation at the bottom (Accueil,
// Courses, To-do, Sport, « Plus » for the Boîte à idées, the Timer and
// Réglages), the modules' own screens inside. At opening: the state of the
// base; a copy « avant-migration » when an update must migrate a base that
// holds something (the migration waits for it); the restore OFFER when the
// base is absent or empty and a copy exists (never automatic); otherwise
// today's copy (safety net).
import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router';
import {
  Button,
  Card,
  ErrorBoundary,
  Icon,
  ModuleProvider,
  Page,
  PresentModulesProvider,
  errorMessage,
} from '@hub/sdk/frontend';
import { describeCounts, type BackupCopy } from '../../../packages/phone/backup';
import type { WorkerClient } from '../../../packages/phone/transport';
import {
  dailyCopy,
  listCopies,
  offerAtOpening,
  restoreCopy,
  takeCopy,
  type BaseStatus,
} from './backup';
import { PAGE_MODULES, type PageModule } from './page-modules';
import { SettingsPage } from './SettingsPage';
import { AutoIndicator, ConflictsPage, SyncNowButton, SyncPage, useSyncState } from './SyncPage';
import { startAutoSync } from './auto';
import { startTimerNotifications } from './timer-notices';
import { startTimerOngoing } from './timer-ongoing';

/** The modules' Background components (the Timer's sound), mounted once for the whole app. */
function Backgrounds(props: { loaded: Set<string> }) {
  return (
    <>
      {PAGE_MODULES.filter((m) => m.frontend.Background && props.loaded.has(m.manifest.id)).map(
        ({ manifest, frontend }) => {
          const Background = frontend.Background!;
          return (
            <ModuleProvider key={manifest.id} manifest={manifest}>
              <ErrorBoundary label={manifest.name}>
                <Background />
              </ErrorBoundary>
            </ModuleProvider>
          );
        },
      )}
    </>
  );
}

let timerNotificationsStarted = false;

const MORE_PATHS = [
  '/settings',
  '/sync',
  ...PAGE_MODULES.filter((m) => m.place === 'more').map((m) => `/m/${m.manifest.id}`),
];

export const dateFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-BE', { dateStyle: 'long', timeStyle: 'short' });

export interface Shell {
  client: WorkerClient;
  base: BaseStatus;
  copies: BackupCopy[];
  refresh: () => Promise<void>;
  restore: (copy: BackupCopy) => Promise<void>;
}

/** The pages of one module under /m/<id>/*, isolated in an error boundary (like the PC). */
function ModuleRoutes(props: { module: PageModule }) {
  const { manifest, frontend, extra: Extra } = props.module;
  return (
    <ModuleProvider manifest={manifest}>
      <ErrorBoundary label={manifest.name}>
        {Extra && <Extra />}
        <Routes>
          {(frontend.pages ?? []).map(({ path, component: Component }) => (
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

/** Accueil: one card per installed module (its home widget when it has one). */
function HomePage(props: { shell: Shell }) {
  const last = props.shell.copies[0];
  const failed = new Map(
    props.shell.base.modules.filter((m) => m.status !== 'loaded').map((m) => [m.id, m]),
  );
  return (
    <Page title="ToolBox">
      {PAGE_MODULES.map(({ manifest, frontend }) => {
        const Widget = frontend.HomeWidget;
        const problem = failed.get(manifest.id);
        return (
          <Card
            key={manifest.id}
            title={
              <span className="m-home__title">
                <Icon name={manifest.icon} />
                {manifest.name}
              </span>
            }
            actions={
              <Link to={`/m/${manifest.id}`} className="button button--secondary">
                Ouvrir
              </Link>
            }
          >
            {problem ? (
              <p className="error small">{problem.error ?? 'Ce module n’a pas pu démarrer.'}</p>
            ) : Widget ? (
              <ModuleProvider manifest={manifest}>
                <ErrorBoundary label={manifest.name}>
                  <Widget />
                </ErrorBoundary>
              </ModuleProvider>
            ) : (
              <p className="small muted">{manifest.description}</p>
            )}
          </Card>
        );
      })}
      <HomeSync shell={props.shell} />
      <p className="small muted m-home__copy">
        Dernière copie de sauvegarde : {last ? dateFr(last.createdAt) : 'aucune pour l’instant'}
      </p>
    </Page>
  );
}

/** Accueil: « Synchroniser » once paired with the PC (by hand, ADR 0044). */
function HomeSync(props: { shell: Shell }) {
  const { state, reload } = useSyncState(props.shell.client);
  if (!state?.peer?.first_sync_at) return null;
  return (
    <Card title="Synchro avec le PC">
      <p className="small muted">
        Dernière synchro :{' '}
        {state.peer.last_sync_at ? dateFr(state.peer.last_sync_at) : 'pas encore'}
        {state.conflicts ? ` · ${state.conflicts} conflit(s)` : ''}
      </p>
      <AutoIndicator client={props.shell.client} />
      <SyncNowButton client={props.shell.client} onDone={() => void reload()} />
    </Card>
  );
}

/** « Plus »: the modules not in the bottom bar, and Réglages. */
function MorePage() {
  return (
    <Page title="Plus">
      <ul className="m-more">
        {PAGE_MODULES.filter((m) => m.place === 'more').map(({ manifest }) => (
          <li key={manifest.id}>
            <Link to={`/m/${manifest.id}`} className="m-more__item">
              <Icon name={manifest.icon} />
              <span>{manifest.name}</span>
            </Link>
          </li>
        ))}
        <li>
          <Link to="/settings" className="m-more__item">
            <Icon name="settings" />
            <span>Réglages</span>
          </Link>
        </li>
      </ul>
    </Page>
  );
}

/** The copy « avant-migration » failed: nothing was migrated; try again. */
function MigrationBlocked(props: { error: string; onRetry: () => void }) {
  return (
    <Page title="Mise à jour en attente">
      <div className="card card--error">
        <p>
          ToolBox doit mettre à jour la structure de tes données, mais la copie de sauvegarde faite
          avant n’a pas réussi : {props.error}
        </p>
        <p className="small">
          Rien n’a été modifié : la mise à jour attend que la copie réussisse.
        </p>
        <div className="m-actions">
          <Button onClick={props.onRetry}>Réessayer</Button>
        </div>
      </div>
    </Page>
  );
}

/** The offer at opening: the base is empty, a copy exists. Two confirmations, never automatic. */
function RestoreOffer(props: {
  copy: BackupCopy;
  onRestore: () => Promise<void>;
  onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copy } = props;
  return (
    <Page title="Données introuvables">
      <Card title="Une copie de sauvegarde existe">
        <p>
          La base de ToolBox est vide sur ce téléphone, mais une copie existe :{' '}
          <strong>{dateFr(copy.createdAt)}</strong>, avec <strong>{describeCounts(copy)}</strong>.
        </p>
        <p className="small muted">
          Rien n’est restauré sans ton accord. Si tu continues sans restaurer, les copies restent
          disponibles dans Réglages.
        </p>
        {error && <p className="error">{error}</p>}
        <div className="m-actions">
          <Button
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  `Restaurer la copie du ${dateFr(copy.createdAt)} (${describeCounts(copy)}) ?`,
                )
              )
                return;
              setBusy(true);
              props.onRestore().catch((e: unknown) => {
                setError(errorMessage(e));
                setBusy(false);
              });
            }}
          >
            Restaurer cette copie
          </Button>
          <Button variant="secondary" disabled={busy} onClick={props.onSkip}>
            Continuer sans restaurer
          </Button>
        </div>
      </Card>
    </Page>
  );
}

export function App(props: { client: WorkerClient }) {
  const { client } = props;
  const [base, setBase] = useState<BaseStatus | null>(null);
  const [copies, setCopies] = useState<BackupCopy[]>([]);
  const [offer, setOffer] = useState<BackupCopy | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const location = useLocation();

  const refresh = useCallback(async () => {
    setBase(await client.call<BaseStatus>({ kind: 'status' }));
    setCopies(await listCopies());
  }, [client]);

  useEffect(() => {
    void (async () => {
      try {
        let status = await client.call<BaseStatus>({ kind: 'status' });
        if (status.pending.length > 0) {
          // An update must migrate a base that holds something: copy it first.
          try {
            await takeCopy(client, 'avant-migration');
          } catch (e) {
            setMigrationError(errorMessage(e));
            return; // Nothing migrated.
          }
          setMigrationError(null);
          await client.call({ kind: 'migrate' });
          status = await client.call<BaseStatus>({ kind: 'status' });
        }
        setBase(status);
        if (
          !timerNotificationsStarted &&
          status.modules.some((m) => m.id === 'timer' && m.status === 'loaded')
        ) {
          timerNotificationsStarted = true;
          startTimerNotifications();
          startTimerOngoing();
        }
        // The automatic synchronisation (off by default): at opening, if Thomas turned it on.
        void startAutoSync(client).catch(() => undefined);
        const offered = await offerAtOpening(status);
        if (offered) setOffer(offered);
        else
          await dailyCopy(client, status).catch((e: unknown) =>
            setCopyError(`La copie de sauvegarde du jour a échoué : ${errorMessage(e)}`),
          );
        setCopies(await listCopies());
      } catch (e) {
        setFatal(errorMessage(e));
      }
    })();
  }, [client, attempt]);

  const restore = useCallback(
    async (copy: BackupCopy) => {
      await restoreCopy(client, copy, base!);
      // Everything is read again from the restored base.
      window.location.reload();
    },
    [client, base],
  );

  if (fatal)
    return (
      <div className="m-shell">
        <main className="m-content">
          <Page title="ToolBox ne peut pas démarrer">
            <div className="card card--error">
              <p>{fatal}</p>
              <p className="small">Aucune donnée n’a été modifiée.</p>
            </div>
          </Page>
        </main>
      </div>
    );
  if (migrationError)
    return (
      <div className="m-shell">
        <main className="m-content">
          <MigrationBlocked error={migrationError} onRetry={() => setAttempt((n) => n + 1)} />
        </main>
      </div>
    );
  if (!base) return <p className="m-loading muted">Ouverture…</p>;
  if (offer)
    return (
      <div className="m-shell">
        <main className="m-content">
          <RestoreOffer
            copy={offer}
            onRestore={() => restore(offer)}
            onSkip={() => setOffer(null)}
          />
        </main>
      </div>
    );

  const shell: Shell = { client, base, copies, refresh, restore };
  const loaded = new Set(base.modules.filter((m) => m.status === 'loaded').map((m) => m.id));
  // « Plus » stays lit on the pages it leads to (Boîte à idées, Timer, Réglages).
  const moreClass = ({ isActive }: { isActive: boolean }) =>
    `m-nav__item${isActive || MORE_PATHS.some((p) => location.pathname.startsWith(p)) ? ' active' : ''}`;
  const present = PAGE_MODULES.filter((m) => loaded.has(m.manifest.id));
  return (
    <PresentModulesProvider modules={present}>
      <div className="m-shell">
        <Backgrounds loaded={loaded} />
        <main className="m-content">
          {copyError && <p className="error m-banner">{copyError}</p>}
          <Routes>
            <Route index element={<HomePage shell={shell} />} />
            {PAGE_MODULES.map((module) => (
              <Route
                key={module.manifest.id}
                path={`m/${module.manifest.id}/*`}
                element={<ModuleRoutes module={module} />}
              />
            ))}
            <Route path="more" element={<MorePage />} />
            <Route path="settings" element={<SettingsPage shell={shell} />} />
            <Route path="sync" element={<SyncPage shell={shell} />} />
            <Route path="sync/conflicts" element={<ConflictsPage shell={shell} />} />
            <Route path="*" element={<HomePage shell={shell} />} />
          </Routes>
        </main>
        <nav className="m-nav" aria-label="Navigation">
          <NavLink to="/" end className="m-nav__item">
            <Icon name="home" />
            <span>Accueil</span>
          </NavLink>
          {PAGE_MODULES.filter((m) => m.place === 'bar').map(({ manifest }) => (
            <NavLink key={manifest.id} to={`/m/${manifest.id}`} className="m-nav__item">
              <Icon name={manifest.icon} />
              <span>{manifest.name}</span>
            </NavLink>
          ))}
          <NavLink to="/more" className={moreClass}>
            <Icon name="ellipsis" />
            <span>Plus</span>
          </NavLink>
        </nav>
      </div>
    </PresentModulesProvider>
  );
}
