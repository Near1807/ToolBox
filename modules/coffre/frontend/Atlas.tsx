// v0.48.0 (Expérimental): the map and the compact tree side by side — folded
// or open on the « Contenu » page, in full on its own page (« Carte »). The
// same actions everywhere (tree-actions.tsx).
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon, Page, useApi, useContextMenu, useModule } from '@hub/sdk/frontend';
import type { ContextDto, HomeDto } from '../shared/types';
import { ContextMap } from './ContextMap';
import { ContextTree } from './ContextTree';
import { useCoffre } from './frame';
import { useTreeActions } from './tree-actions';

const FOLD_KEY = 'toolbox.coffre.atlasOpen';

export function Atlas(props: {
  contexts: readonly ContextDto[];
  pending: Readonly<Record<string, number>>;
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
  const byId = new Map(props.contexts.map((c) => [c.id, c]));
  const menuOf = (c: ContextDto) => actions.menuOf(c, () => go(c.id));

  return (
    <section
      className={`coffre-atlas${props.full ? ' coffre-atlas--full' : ''}`}
      aria-label="Carte et arbre des contextes"
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
            <h2 className="coffre-h2">Carte des contextes</h2>
          </button>
          <span className="badge badge--warning">Expérimental</span>
          <Link className="coffre-atlas__big" to={coffre.path('carte')}>
            En grand
          </Link>
        </div>
      )}
      {shown && (
        <div className="coffre-atlas__body">
          <ContextMap
            contexts={props.contexts}
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
          <ContextTree
            contexts={props.contexts}
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
      title="Carte des contextes"
      subtitle={
        <span className="coffre-crumbs">
          <Link to={coffre.path('')}>Coffre</Link> › Carte
        </span>
      }
    >
      <div data-coffre-page>
        <Atlas full contexts={coffre.contexts} pending={home.data?.pendingByContext ?? {}} />
      </div>
    </Page>
  );
}
