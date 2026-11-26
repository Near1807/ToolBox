// v0.48.0 (Expérimental): the compact tree of the contexts, beside the map —
// the same actions (right click, F2, Suppr, Alt+↑ ↓), drag and drop (a
// context dropped on another one moves into it, asked first), a complete
// keyboard: ↑ ↓ from line to line, → opens a branch / goes to its first
// child, ← closes it / goes to the parent, Entrée opens the context.
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Icon, type MenuItem, type useContextMenu } from '@hub/sdk/frontend';
import type { ContextDto } from '../shared/types';
import { treeOrder } from './tree-actions';

const DRAG_TYPE = 'application/x-toolbox-coffre-context';
const OPEN_KEY = 'toolbox.coffre.treeClosed';

function closedAtStart(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

interface Row {
  c: ContextDto;
  depth: number;
  hasKids: boolean;
}

export function ContextTree(props: {
  contexts: readonly ContextDto[];
  current?: string | null;
  onOpen: (id: string) => void;
  onMove: (srcId: string, dstId: string | null) => void;
  menuOf: (c: ContextDto) => MenuItem[];
  bindMenu: ReturnType<typeof useContextMenu>['bind'];
  onRename: (c: ContextDto) => void;
  onRemove: (c: ContextDto) => void;
  onReorder: (c: ContextDto, delta: -1 | 1) => void;
  onCreate: (parent: ContextDto | null) => void;
}) {
  const { contexts } = props;
  const [closed, setClosed] = useState<Set<string>>(closedAtStart);
  const [focus, setFocus] = useState<string | null>(props.current ?? null);
  const [over, setOver] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => {
    const kids = new Map<string | null, ContextDto[]>();
    for (const c of contexts) {
      const l = kids.get(c.parentId) ?? [];
      l.push(c);
      kids.set(c.parentId, l);
    }
    const out: Row[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const c of [...(kids.get(parent) ?? [])].sort(treeOrder)) {
        const hasKids = (kids.get(c.id)?.length ?? 0) > 0;
        out.push({ c, depth, hasKids });
        if (hasKids && !closed.has(c.id)) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [contexts, closed]);

  const toggle = (id: string, open?: boolean) =>
    setClosed((s) => {
      const next = new Set(s);
      const isOpen = !next.has(id);
      if (open ?? !isOpen) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        // Not kept: the tree opens again next time.
      }
      return next;
    });

  const focusRow = (id: string | null) => {
    if (!id) return;
    setFocus(id);
    list.current?.querySelector<HTMLElement>(`[data-tree-id="${id}"]`)?.focus();
  };

  const onKey = (e: React.KeyboardEvent, r: Row, i: number) => {
    const at = (j: number) => rows[Math.max(0, Math.min(rows.length - 1, j))]?.c.id ?? null;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      props.onReorder(r.c, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRow(at(i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRow(at(i - 1));
        break;
      case 'Home':
        e.preventDefault();
        focusRow(at(0));
        break;
      case 'End':
        e.preventDefault();
        focusRow(at(rows.length - 1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (r.hasKids && closed.has(r.c.id)) toggle(r.c.id, true);
        else if (r.hasKids) focusRow(at(i + 1));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (r.hasKids && !closed.has(r.c.id)) toggle(r.c.id, false);
        else focusRow(r.c.parentId);
        break;
      case 'Enter':
        e.preventDefault();
        props.onOpen(r.c.id);
        break;
      case 'F2':
        e.preventDefault();
        props.onRename(r.c);
        break;
      case 'Delete':
        e.preventDefault();
        props.onRemove(r.c);
        break;
      default:
    }
  };

  const dragOver = (e: DragEvent, id: string | null) => {
    if (!Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setOver(id ?? '');
  };
  const dropOn = (e: DragEvent, id: string | null) => {
    const src = e.dataTransfer.getData(DRAG_TYPE);
    setOver(null);
    if (!src) return;
    e.preventDefault();
    e.stopPropagation();
    if (src !== id) props.onMove(src, id);
  };

  const tabStop = focus && rows.some((r) => r.c.id === focus) ? focus : rows[0]?.c.id;

  return (
    <div className="coffre-tree" data-coffre-tree>
      <div className="coffre-tree__head">
        <h2 className="coffre-h2">Arbre</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Nouveau contexte à la racine"
          title="Nouveau contexte"
          onClick={() => props.onCreate(null)}
        >
          <Icon name="folder-plus" />
        </button>
      </div>
      <ul
        ref={list}
        className={`coffre-tree__list${over === '' ? ' is-target' : ''}`}
        role="tree"
        aria-label="Arbre des contextes (glisser un contexte sur un autre pour l’y déplacer)"
        onDragOver={(e) => dragOver(e, null)}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => dropOn(e, null)}
      >
        {rows.map((r, i) => {
          const menu = props.bindMenu(() => props.menuOf(r.c), r.c.name);
          return (
            <li
              key={r.c.id}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={r.hasKids ? !closed.has(r.c.id) : undefined}
              aria-selected={props.current === r.c.id}
              aria-label={`${r.c.name}, ${r.c.count} élément${r.c.count > 1 ? 's' : ''}`}
              data-tree-id={r.c.id}
              data-coffre-context={r.c.id}
              tabIndex={r.c.id === tabStop ? 0 : -1}
              draggable
              className={`coffre-tree__row${props.current === r.c.id ? ' is-current' : ''}${over === r.c.id ? ' is-target' : ''}`}
              style={{ paddingLeft: `${4 + r.depth * 16}px` }}
              onFocus={() => setFocus(r.c.id)}
              onClick={() => props.onOpen(r.c.id)}
              onKeyDown={(e) => {
                menu.onKeyDown?.(e);
                if (!e.defaultPrevented) onKey(e, r, i);
              }}
              onContextMenu={menu.onContextMenu}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, r.c.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => dragOver(e, r.c.id)}
              onDrop={(e) => dropOn(e, r.c.id)}
            >
              {r.hasKids ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className="coffre-tree__twisty"
                  aria-hidden="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(r.c.id);
                  }}
                >
                  <Icon name={closed.has(r.c.id) ? 'chevron-right' : 'chevron-down'} />
                </button>
              ) : (
                <span className="coffre-tree__twisty" aria-hidden="true" />
              )}
              <i className="coffre-tree__dot" style={{ background: r.c.css }} aria-hidden="true" />
              <span className="coffre-tree__name">{r.c.name}</span>
              {r.c.fresh > 0 && (
                <span className="coffre-tree__fresh" title="Nouveau cette semaine" />
              )}
              <span className="coffre-tree__count">{r.c.count || ''}</span>
            </li>
          );
        })}
        {!rows.length && <li className="coffre-picker__empty">Aucun contexte</li>}
      </ul>
    </div>
  );
}
