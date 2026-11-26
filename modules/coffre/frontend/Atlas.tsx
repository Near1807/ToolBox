// v0.48.0, v0.50.0 (Expérimental): the map and the compact tree side by side —
// folded or open on the « Contenu » page, in full on its own page (« Carte »).
// Folders only, stopped on the Fins de route and the Projets (their inside is
// in their view); À ranger on top with its count. The same actions everywhere
// (folder-actions.tsx).
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon, Page, useApi, useContextMenu, useModule } from '@hub/sdk/frontend';
import type { FolderDto, HomeDto } from '../shared/types';
import { FolderMap } from './FolderMap';
import { FolderTree } from './FolderTree';
import { useCoffre } from './frame';
import { useTreeActions } from './folder-actions';

const FOLD_KEY = 'toolbox.coffre.atlasOpen';

export function Atlas(props: {
  folders: readonly FolderDto[];
  pending: Readonly<Record<string, number>>;
  /** À ranger: its count (on top). */
  waiting: number;
  /** On its own page: always open, taller. */
  full?: boolean;
  current?: string | null;
}) {
  const coffre = useCoffre();
  const navigate = useNavigate();
  const actions = useTreeActions();
  const menu = useContextMenu();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(FOLD_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const shown = props.full || open;
  const go = (id: string) => navigate(coffre.path(`c/${id}`));
  const byId = new Map(props.folders.map((c) => [c.id, c]));
  // Never the inside of a Fin de route or a Projet.
  const visible = props.folders.filter((c) => !c.inside);
  const menuOf = (c: FolderDto) => actions.menuOf(c, () => go(c.id));

  return (
    <section
      className={`coffre-atlas${props.full ? ' coffre-atlas--full' : ''}`}
      aria-label="Carte et arbre des dossiers"
    >
      {!props.full && (
        <div className="coffre-atlas__head">
          <button
            type="button"
            className="coffre-atlas__fold"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
              try {
                localStorage.setItem(FOLD_KEY, open ? '0' : '1');
              } catch {
                // Not kept.
              }
            }}
          >
            <Icon name={open ? 'chevron-down' : 'chevron-right'} />
            <h2 className="coffre-h2">Carte des dossiers</h2>
          </button>
          <span className="badge badge--warning">Expérimental</span>
          <Link className="coffre-atlas__big" to={coffre.path('carte')}>
            En grand
          </Link>
        </div>
      )}
      {shown && (
        <Link
          className={`coffre-chip coffre-atlas__pending${props.waiting ? ' coffre-chip--accent' : ''}`}
          to={coffre.path('a-ranger')}
          data-coffre-atlas-pending
        >
          <Icon name="folder-input" /> À ranger : {props.waiting || 'rien'}
        </Link>
      )}
      {shown && (
        <div className="coffre-atlas__body">
          <FolderMap
            folders={visible}
            pending={props.pending}
            height={props.full ? 640 : 380}
            onOpen={go}
            onMove={actions.requestMove}
            menuOf={menuOf}
            bindMenu={menu.bind}
            onRename={actions.rename}
            onRemove={(c) => void actions.remove(c)}
            current={props.current}
          />
          <FolderTree
            folders={visible}
            current={props.current}
            onOpen={go}
            onMove={actions.requestMove}
            menuOf={menuOf}
            bindMenu={menu.bind}
            onRename={actions.rename}
            onRemove={(c) => void actions.remove(c)}
            onReorder={(c, d) => void actions.reorder(c, d)}
            onCreate={(p) => actions.create(p ? (byId.get(p.id) ?? p) : null)}
          />
        </div>
      )}
      {menu.node}
      {actions.node}
    </section>
  );
}

/** v0.48.0: the map and the tree, in full (« En grand »). */
export function MapPage() {
  const coffre = useCoffre();
  const module = useModule();
  const home = useApi<HomeDto>(module.url('/home'));
  return (
    <Page
      title="Carte des dossiers"
      subtitle={
        <span className="coffre-crumbs">
          <Link to={coffre.path('')}>Coffre</Link> › Carte
        </span>
      }
    >
      <div data-coffre-page>
        <Atlas
          full
          folders={coffre.folders}
          pending={home.data?.pendingByFolder ?? {}}
          waiting={home.data?.pendingCount ?? 0}
        />
      </div>
    </Page>
  );
}
