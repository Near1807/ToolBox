// The mobile shell (ADR 0044): one column, navigation at the bottom (Accueil,
// To-do, Réglages), the module's own screens inside. At opening: the state of
// the base, the restore OFFER when it is absent or empty and a copy exists
// (never automatic), otherwise today's copy (safety net).
import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import {
  Button,
  Card,
  ErrorBoundary,
  Icon,
  ModuleProvider,
  Page,
  errorMessage,
  type ModuleManifest,
} from '@hub/sdk/frontend';
import todoFrontend from '../../../modules/todo/frontend/index';
import todoManifest from '../../../modules/todo/module.json';
import '../../../modules/todo/frontend/todo.mobile.css';
import type { BackupCopy } from '../../../packages/phone/backup';
import type { WorkerClient } from '../../../packages/phone/transport';
import { dailyCopy, listCopies, offerAtOpening, restoreCopy, type BaseStatus } from './backup';
import { SettingsPage } from './SettingsPage';

const TODO = todoManifest as ModuleManifest;
const TodoPage = todoFrontend.pages![0]!.component;
const TodoWidget = todoFrontend.HomeWidget!;

export const dateFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-BE', { dateStyle: 'long', timeStyle: 'short' });

export interface Shell {
  client: WorkerClient;
  base: BaseStatus;
  copies: BackupCopy[];
  refresh: () => Promise<void>;
  restore: (copy: BackupCopy) => Promise<void>;
}

function HomePage(props: { shell: Shell }) {
  const last = props.shell.copies[0];
  return (
    <Page title="ToolBox">
      <Card
        title="To-do"
        actions={
          <NavLink to="/m/todo" className="button button--secondary">
            Ouvrir
          </NavLink>
        }
      >
        <ModuleProvider manifest={TODO}>
          <ErrorBoundary label="To-do">
            <TodoWidget />
          </ErrorBoundary>
        </ModuleProvider>
      </Card>
      <p className="small muted m-home__copy">
        Dernière copie de sauvegarde : {last ? dateFr(last.createdAt) : 'aucune pour l’instant'}
      </p>
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
          <strong>{dateFr(copy.createdAt)}</strong>, avec <strong>{copy.tasks}</strong> tâche(s).
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
                  `Restaurer la copie du ${dateFr(copy.createdAt)} (${copy.tasks} tâche(s)) ?`,
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

  const refresh = useCallback(async () => {
    setBase(await client.call<BaseStatus>({ kind: 'status' }));
    setCopies(await listCopies());
  }, [client]);

  useEffect(() => {
    void (async () => {
      try {
        const status = await client.call<BaseStatus>({ kind: 'status' });
        setBase(status);
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
  }, [client]);

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
  return (
    <div className="m-shell">
      <main className="m-content">
        {copyError && <p className="error m-banner">{copyError}</p>}
        <Routes>
          <Route index element={<HomePage shell={shell} />} />
          <Route
            path="m/todo/*"
            element={
              <ModuleProvider manifest={TODO}>
                <ErrorBoundary label="To-do">
                  <TodoPage />
                </ErrorBoundary>
              </ModuleProvider>
            }
          />
          <Route path="settings" element={<SettingsPage shell={shell} />} />
          <Route path="*" element={<HomePage shell={shell} />} />
        </Routes>
      </main>
      <nav className="m-nav" aria-label="Navigation">
        <NavLink to="/" end className="m-nav__item">
          <Icon name="home" />
          <span>Accueil</span>
        </NavLink>
        <NavLink to="/m/todo" className="m-nav__item">
          <Icon name="list-todo" />
          <span>To-do</span>
        </NavLink>
        <NavLink to="/settings" className="m-nav__item">
          <Icon name="settings" />
          <span>Réglages</span>
        </NavLink>
      </nav>
    </div>
  );
}
