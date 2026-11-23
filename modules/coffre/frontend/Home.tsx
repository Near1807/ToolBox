// v0.45.0: the Coffre's dashboard — the search (Ctrl+K), « En cours », the
// recent elements, Arrivée, the contexts' tiles by family, the health of the
// Coffre (place on the PC; the backup disk comes in v0.46).
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  Button,
  ContextTile,
  Counter,
  EmptyState,
  ErrorMessage,
  Icon,
  Page,
  useApi,
  useContextMenu,
  useModule,
} from '@hub/sdk/frontend';
import { searchItems } from '../shared/facets';
import type { ContextDto, HomeDto, ItemDto } from '../shared/types';
import { draggingFiles, useCoffre } from './frame';
import { Items } from './Items';
import { familiesOf } from './logic';
import { Health } from './disk/Health';
import { RestoreDialog } from './disk/RestoreDialog';

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
        placeholder="Chercher dans le Coffre (Ctrl+K)"
        aria-label="Chercher dans le Coffre"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

export function HomePage() {
  const module = useModule();
  const coffre = useCoffre();
  const location = useLocation();
  const linkMenu = useContextMenu();
  const home = useApi<HomeDto>(module.url('/home'));
  const [query, setQuery] = useState('');
  const [restoring, setRestoring] = useState(false);
  const searching = query.trim() !== '';
  const all = useApi<ItemDto[]>(searching ? module.url('/items') : null);
  const found = useMemo(() => (all.data ? searchItems(all.data, query) : []), [all.data, query]);

  // Ctrl+K from another page of the Coffre lands here, in the search.
  useEffect(() => {
    if ((location.state as { search?: boolean } | null)?.search)
      document.querySelector<HTMLInputElement>('[data-coffre-search]')?.focus();
  }, [location.state]);
  useEffect(() => coffre.setHere(null), [coffre]);

  const h = home.data;
  const families = useMemo(() => familiesOf(h?.contexts ?? []), [h?.contexts]);
  const empty = h && !h.health.items && !h.contexts.length;

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
        {home.error && <ErrorMessage>{home.error}</ErrorMessage>}
        {searching ? (
          <section className="coffre-section">
            <h2 className="coffre-h2">
              Résultats pour « {query.trim()} » <span className="muted">({found.length})</span>
            </h2>
            <Items
              items={found}
              showContext
              empty={all.loading ? 'Recherche…' : 'Rien trouvé (noms, fiches et attributs).'}
            />
          </section>
        ) : (
          h && (
            <>
              <div className="coffre-dash">
                <Health home={h} disk={coffre.disk} onVerify={coffre.verify} />
                <section
                  className="coffre-panel coffre-arrival"
                  data-coffre-arrival
                  aria-label="Arrivée"
                >
                  <h2 className="coffre-h2">Arrivée</h2>
                  {h.arrivalCount ? (
                    <>
                      <Counter value={h.arrivalCount} label="à ranger" tone="accent" />
                      <Link className="button button--primary" to={coffre.path('arrivee')}>
                        Ranger
                      </Link>
                    </>
                  ) : (
                    <p className="coffre-arrival__done">
                      <Icon name="circle-check" /> Tout est rangé
                    </p>
                  )}
                </section>
              </div>
              {empty && (
                <div className="coffre-welcome">
                  <EmptyState title="Le Coffre est vide">
                    Glisse un fichier ou un dossier n’importe où sur cette page : une fenêtre te
                    propose où le ranger. L’original ne bouge pas.
                    <br />
                    Un coffre sur un disque externe ?{' '}
                    <button
                      type="button"
                      className="coffre-linklike"
                      onClick={() => setRestoring(true)}
                    >
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
              {families.map((f) => (
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
          )
        )}
      </div>
      {linkMenu.node}
      {restoring && <RestoreDialog onClose={() => setRestoring(false)} onDone={coffre.refresh} />}
    </Page>
  );
}
