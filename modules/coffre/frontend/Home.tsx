// v0.45.0: the Coffre's dashboard. v0.48.0: two pages — « Contenu » (by
// default: the search, « Maintenant », « En cours », the recent elements,
// Arrivée, the map and the tree, the tiles; a small witness of the disk) and
// « Gestion » (the disk, the health and gauges, the Recycle Bins, the
// downloads, what was learned, the settings). The disk's banner (frame.tsx)
// stays above both.
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  Button,
  ContextTile,
  EmptyState,
  ErrorMessage,
  Icon,
  Page,
  useApi,
  useContextMenu,
  useModule,
} from '@hub/sdk/frontend';
import type { ContextDto, HomeDto } from '../shared/types';
import { draggingFiles, useCoffre } from './frame';
import { Items } from './Items';
import { SearchResults } from './SearchResults';
import { DownloadsPanel } from './Downloads';
import { NowPanel } from './Now';
import { familiesOf } from './logic';
import { Health } from './disk/Health';
import { RestoreDialog } from './disk/RestoreDialog';
import { DiskSettings } from './disk/DiskSettings';
import { LearnedSettings } from './Learned';
import { Atlas } from './Atlas';
import { ImportsPanel } from './Import';
import { PendingDiskRename, SensitiveZone } from './Reset';

/** A context's tile that takes what is dropped on it. */
export function Tile(props: { context: ContextDto; showPath?: boolean }) {
  const coffre = useCoffre();
  const navigate = useNavigate();
  const [dropping, setDropping] = useState(false);
  const c = props.context;
  return (
    <ContextTile
      name={c.name}
      color={c.css}
      count={c.count}
      fresh={c.fresh}
      path={props.showPath && c.path.length > 2 ? c.path.slice(1, -1).join(' › ') : undefined}
      onOpen={() => navigate(coffre.path(`c/${c.id}`))}
      dropping={dropping}
      onDragOver={(e: DragEvent<HTMLElement>) => {
        if (!draggingFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e: DragEvent<HTMLElement>) => {
        if (!draggingFiles(e)) return;
        // Handled here (defaultPrevented): the page's zone only closes.
        e.preventDefault();
        setDropping(false);
        coffre.drop(e.dataTransfer, c.id);
      }}
      bind={{ 'data-coffre-context': c.id }}
    />
  );
}

export function SearchBox(props: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="coffre-search">
      <Icon name="search" />
      <input
        data-coffre-search
        className="input"
        type="search"
        placeholder="Chercher dans le Coffre, contenu compris"
        aria-label="Chercher dans le Coffre"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

type Tab = 'contenu' | 'gestion';
const TAB_KEY = 'toolbox.coffre.homeTab';
const TABS: { id: Tab; label: string; key: string }[] = [
  { id: 'contenu', label: 'Contenu', key: '1' },
  { id: 'gestion', label: 'Gestion', key: '2' },
];

function savedTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'gestion' ? 'gestion' : 'contenu';
  } catch {
    return 'contenu';
  }
}

export function HomePage() {
  const module = useModule();
  const coffre = useCoffre();
  const location = useLocation();
  const linkMenu = useContextMenu();
  const home = useApi<HomeDto>(module.url('/home'));
  // v0.47.0: « Tous les résultats » of the hub's search lands here (?q=).
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get('q');
  const [query, setQuery] = useState(() => urlQuery ?? '');
  const [fromUrl, setFromUrl] = useState(urlQuery);
  if (urlQuery !== fromUrl) {
    setFromUrl(urlQuery);
    if (urlQuery !== null) setQuery(urlQuery);
  }
  // v0.48.0: two pages, « Contenu » (by default) and « Gestion »; the tab is kept.
  const urlTab = params.get('onglet');
  const [tab, setTabState] = useState<Tab>(() =>
    urlTab === 'gestion' || urlTab === 'contenu' ? urlTab : savedTab(),
  );
  const setTab = useCallback(
    (t: Tab) => {
      setTabState(t);
      try {
        localStorage.setItem(TAB_KEY, t);
      } catch {
        // Not kept: « Contenu » next time.
      }
      if (params.has('onglet')) {
        const next = new URLSearchParams(params);
        next.delete('onglet');
        setParams(next, { replace: true });
      }
    },
    [params, setParams],
  );
  if ((urlTab === 'gestion' || urlTab === 'contenu') && urlTab !== tab) setTabState(urlTab);
  const [restoring, setRestoring] = useState(false);
  const searching = query.trim() !== '';

  useEffect(() => {
    if ((location.state as { search?: boolean } | null)?.search)
      document.querySelector<HTMLInputElement>('[data-coffre-search]')?.focus();
  }, [location.state]);
  useEffect(() => coffre.setHere(null), [coffre]);
  // Alt+1 / Alt+2: the tabs.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const t = TABS.find((x) => x.key === e.key);
      if (!t) return;
      e.preventDefault();
      setTab(t.id);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [setTab]);

  const h = home.data;
  const families = useMemo(() => familiesOf(h?.contexts ?? []), [h?.contexts]);
  const empty = h && !h.health.items && !h.contexts.length;

  const tabs = (
    <div className="coffre-tabs" role="tablist" aria-label="Pages du Coffre">
      {TABS.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`coffre-tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`coffre-panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          className={`coffre-tabs__tab${tab === t.id ? ' is-on' : ''}`}
          title={`${t.label} (Alt+${t.key})`}
          data-coffre-tab={t.id}
          onClick={() => setTab(t.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
            setTab(next.id);
            document.getElementById(`coffre-tab-${next.id}`)?.focus();
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <Page
      title="Coffre"
      subtitle="Garder, ranger, retrouver et ouvrir tes fichiers. Glisse un fichier n’importe où ici."
      actions={
        <>
          <SearchBox value={query} onChange={setQuery} />
          <Button onClick={() => coffre.pick()}>Ranger des fichiers…</Button>
          <Button
            variant="secondary"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              linkMenu.openAt(
                () => [
                  { title: 'Lien externe (non sauvegardé)' },
                  {
                    label: 'Un ou plusieurs fichiers…',
                    icon: 'file',
                    onSelect: () => coffre.addLink('file'),
                  },
                  {
                    label: 'Un dossier…',
                    icon: 'folder',
                    onSelect: () => coffre.addLink('folder'),
                  },
                ],
                r.left,
                r.bottom + 4,
              );
            }}
          >
            Ajouter un lien externe…
          </Button>
        </>
      }
    >
      <div data-coffre-page>
        {tabs}
        {home.error && <ErrorMessage>{home.error}</ErrorMessage>}
        {searching ? (
          <SearchResults query={query} />
        ) : (
          h && (
            <div
              role="tabpanel"
              id={`coffre-panel-${tab}`}
              aria-labelledby={`coffre-tab-${tab}`}
              data-coffre-panel={tab}
            >
              {tab === 'contenu' ? (
                <ContentTab
                  home={h}
                  families={families}
                  empty={Boolean(empty)}
                  onRestore={() => setRestoring(true)}
                  onManage={() => setTab('gestion')}
                />
              ) : (
                <ManageTab home={h} onRestore={() => setRestoring(true)} />
              )}
            </div>
          )
        )}
      </div>
      {linkMenu.node}
      {restoring && <RestoreDialog onClose={() => setRestoring(false)} onDone={coffre.refresh} />}
    </Page>
  );
}

/** « Contenu »: the files first — nothing of the disk's management but a small witness. */
function ContentTab(props: {
  home: HomeDto;
  families: ReturnType<typeof familiesOf>;
  empty: boolean;
  onRestore: () => void;
  onManage: () => void;
}) {
  const coffre = useCoffre();
  const h = props.home;
  const pending = h.health.pending;
  return (
    <>
      <div className="coffre-strip" data-coffre-strip>
        <Link
          to={coffre.path('arrivee')}
          className={`coffre-chip${h.arrivalCount ? ' coffre-chip--accent' : ''}`}
          data-coffre-arrival
        >
          <Icon name="folder-input" />
          {h.arrivalCount ? `Arrivée : ${h.arrivalCount} à ranger` : 'Arrivée : tout est rangé'}
        </Link>
        <button
          type="button"
          className={`coffre-chip${pending || h.health.missingOnPc ? ' coffre-chip--warn' : ''}`}
          onClick={props.onManage}
          title="Disque, santé, corbeilles : l’onglet Gestion"
          data-coffre-witness
        >
          <Icon name={pending || h.health.missingOnPc ? 'circle-alert' : 'circle-check'} />
          {h.health.missingOnPc
            ? `${h.health.missingOnPc} absent${h.health.missingOnPc > 1 ? 's' : ''} du PC`
            : pending
              ? `${pending} pas encore sur le disque`
              : 'Tout est sauvegardé'}
          <span className="coffre-chip__more">Gestion</span>
        </button>
        {h.toCompleteCount > 0 && (
          <Link
            to={coffre.path('etat/tocomplete')}
            className="coffre-chip coffre-chip--accent"
            data-coffre-tocomplete
          >
            <Icon name="pencil" />À compléter : {h.toCompleteCount}
          </Link>
        )}
        {h.foundCount > 0 && (
          <button
            type="button"
            className="coffre-chip coffre-chip--warn"
            onClick={props.onManage}
            title="Un dossier ajouté à la main dans le Coffre : l’adopter depuis Gestion"
            data-coffre-found-witness
          >
            <Icon name="folder-plus" />
            {h.foundCount} dossier{h.foundCount > 1 ? 's' : ''} à adopter
          </button>
        )}
      </div>
      <NowPanel />
      {props.empty && (
        <div className="coffre-welcome">
          <EmptyState title="Le Coffre est vide">
            Glisse un fichier ou un dossier n’importe où sur cette page : une fenêtre te propose où
            le ranger. L’original ne bouge pas.
            <br />
            Un coffre sur un disque externe ?{' '}
            <button type="button" className="coffre-linklike" onClick={props.onRestore}>
              Restaurer depuis un disque…
            </button>
          </EmptyState>
        </div>
      )}
      {h.pinned.length > 0 && (
        <section className="coffre-section">
          <h2 className="coffre-h2">En cours</h2>
          <Items items={h.pinned} large showContext />
        </section>
      )}
      {h.recent.length > 0 && (
        <section className="coffre-section">
          <h2 className="coffre-h2">Récents</h2>
          <Items items={h.recent} showContext />
        </section>
      )}
      {h.contexts.length > 0 && <Atlas contexts={coffre.contexts} pending={h.pendingByContext} />}
      {props.families.map((f) => (
        <section key={f.family} className="coffre-section">
          <h2 className="coffre-h2">{f.family}</h2>
          <div className="coffre-tiles">
            {f.tiles.map((c) => (
              <Tile key={c.id} context={c} showPath />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/** « Gestion »: the disk, the health, the Recycle Bins, the downloads, what was learned. */
function ManageTab(props: { home: HomeDto; onRestore: () => void }) {
  const coffre = useCoffre();
  const h = props.home;
  const s = coffre.disk;
  return (
    <>
      <PendingDiskRename />
      {h.health.missingOnPc > 0 && s?.disk && (
        <div className="coffre-banner" role="status" data-coffre-missing>
          <span>
            {h.health.missingOnPc} élément{h.health.missingOnPc > 1 ? 's' : ''} de ta base
            {h.health.missingOnPc > 1 ? ' ne sont' : ' n’est'} pas sur ce PC (une base restaurée ?).
            Le disque « {s.disk.name} » les a peut-être.
          </span>
          <Button onClick={props.onRestore}>Restaurer le Coffre depuis le disque…</Button>
        </div>
      )}
      <div className="coffre-dash">
        <Health home={h} disk={s} onVerify={coffre.verify} />
        <div className="coffre-dash__side">
          <section className="coffre-panel" aria-label="Disque du coffre">
            <h2 className="coffre-h2">Disque du coffre</h2>
            <div className="coffre-manage__buttons">
              <Button
                disabled={!s?.connected || Boolean(s.refuses) || Boolean(s.waitsFor)}
                title={
                  !s?.connected
                    ? 'Branche le disque du coffre'
                    : (s.refuses ??
                      (s.waitsFor
                        ? 'Import en cours : la mise à jour sera possible à la fin'
                        : undefined))
                }
                onClick={coffre.update}
              >
                Mettre à jour le disque…
              </Button>
              <Button variant="secondary" disabled={!s?.connected} onClick={coffre.verify}>
                Vérifier
              </Button>
            </div>
            <p className="muted small">
              Le plan de la mise à jour s’affiche avant toute copie ; éjecter le disque se fait
              depuis la même fenêtre.
            </p>
          </section>
          <section className="coffre-panel" aria-label="Corbeilles">
            <h2 className="coffre-h2">Corbeilles</h2>
            <Link className="coffre-chip" to={coffre.path('corbeille')}>
              <Icon name="trash" /> Corbeille du Coffre ({h.health.trashCount}) et du disque
            </Link>
          </section>
          <DownloadsPanel />
        </div>
      </div>
      <ImportsPanel />
      <section className="coffre-section coffre-manage" aria-label="Réglages du Coffre">
        <DiskSettings />
        <LearnedSettings />
      </section>
      <SensitiveZone />
    </>
  );
}
