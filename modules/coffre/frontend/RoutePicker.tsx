// v0.48.0 (Expérimental): the route picker — the ONE component used wherever
// a context is chosen (rangement, « Pour tous », changer de contexte, déplacer
// un contexte, aussi utilisé dans, Arrivée, Téléchargements, import). Type a
// route (« Cours/Thermo/Labos », « › » and « \ » too), completed segment by
// segment (Tab accepts), the new segments shown « nouveau » and created only
// when the choice is validated, or pick it in the small tree. At the top: the
// proposed route (with its reason) and the recent ones. Keyboard: ↑ ↓,
// Entrée, Tab, Échap (which never closes the window under it).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@hub/sdk/frontend';
import {
  completeRoute,
  resolveRoute,
  routeLabel,
  splitRoute,
  suggestRoutes,
  type RouteContext,
  type RoutePick,
} from '../shared/route';

export type { RoutePick };

interface Line {
  key: string;
  label: string;
  hint?: string;
  pick: RoutePick | null;
  /** The segments of a route to create (« nouveau » on the new ones). */
  segments?: { name: string; isNew: boolean }[];
  error?: string | null;
}

const RECENT_KEY = 'toolbox.coffre.recentRoutes';
const RECENT_MAX = 5;

/** The routes chosen lately on this PC (a convenience: lost without harm). */
export function recentRoutes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberRoute(path: readonly string[]): void {
  if (!path.length) return;
  const key = path.join('/');
  try {
    const list = [key, ...recentRoutes().filter((r) => r.toLowerCase() !== key.toLowerCase())];
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // Storage refused: no recent routes, nothing else changes.
  }
}

const depthPad = (depth: number) => ({ paddingLeft: `${8 + depth * 14}px` });

export function RoutePicker(props: {
  label: string;
  contexts: readonly RouteContext[];
  onPick: (pick: RoutePick) => void;
  onClose: () => void;
  /** A route typed may be created (default: yes). */
  allowNew?: boolean;
  /** « Arrivée (à ranger plus tard) » offered. */
  arrival?: boolean;
  /** « À la racine » offered (moving a context). */
  root?: boolean;
  /** Contexts that cannot be chosen (a context and its descendants, when it moves). */
  exclude?: ReadonlySet<string>;
  /** The route the Coffre proposes, and why. */
  proposed?: { pick: RoutePick; label: string; reason: string | null } | null;
  /** The text at the opening. */
  initial?: string;
  /** Shown in place (no floating panel). */
  inline?: boolean;
}) {
  const { contexts, exclude, onClose, onPick } = props;
  const allowNew = props.allowNew !== false;
  const [query, setQuery] = useState(props.initial ?? '');
  const [active, setActive] = useState(0);
  const [showTree, setShowTree] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const usable = useMemo(() => contexts.filter((c) => !exclude?.has(c.id)), [contexts, exclude]);

  const lines = useMemo((): Line[] => {
    const out: Line[] = [];
    const text = query.trim();
    if (!text) {
      if (props.proposed)
        out.push({
          key: 'proposed',
          label: props.proposed.label,
          hint: props.proposed.reason ? `proposé : ${props.proposed.reason}` : 'proposé',
          pick: props.proposed.pick,
        });
      for (const r of recentRoutes()) {
        const res = resolveRoute(r, usable);
        if (!res.existingId) continue;
        if (out.some((l) => l.pick?.kind === 'existing' && l.pick.id === res.existingId)) continue;
        out.push({
          key: `recent:${r}`,
          label: routeLabel(res.segments.map((s) => s.name)),
          hint: 'récent',
          pick: { kind: 'existing', id: res.existingId },
        });
      }
      if (props.root) out.push({ key: 'root', label: 'À la racine', pick: { kind: 'root' } });
      if (props.arrival)
        out.push({
          key: 'arrival',
          label: 'Arrivée (à ranger plus tard)',
          pick: { kind: 'arrival' },
        });
      return out;
    }
    const { trailing } = splitRoute(text);
    if (!trailing)
      for (const s of suggestRoutes(text, usable, 40))
        out.push({ key: s.id, label: routeLabel(s.path), pick: { kind: 'existing', id: s.id } });
    const res = resolveRoute(text, usable);
    if (allowNew && res.newPath) {
      const line: Line = {
        key: 'new',
        label: routeLabel(res.newPath),
        segments: res.segments.map((s) => ({ name: s.name, isNew: s.id === null })),
        error: res.error,
        pick: res.error ? null : { kind: 'new', path: res.newPath },
      };
      // Under a « / » just typed, the creation first; otherwise after the matches.
      if (trailing) out.unshift(line);
      else out.push(line);
    }
    return out;
  }, [query, usable, allowNew, props.proposed, props.root, props.arrival]);

  // A click outside closes it.
  useEffect(() => {
    if (props.inline) return;
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [onClose, props.inline]);

  const choose = (pick: RoutePick | null) => {
    if (!pick) return;
    if (pick.kind === 'existing') {
      const c = contexts.find((x) => x.id === pick.id);
      if (c) rememberRoute(c.path);
    } else if (pick.kind === 'new') rememberRoute(pick.path);
    onPick(pick);
  };

  const sorted = useMemo(
    () =>
      [...usable].sort((a, b) => a.path.join('\u0000').localeCompare(b.path.join('\u0000'), 'fr')),
    [usable],
  );
  const treeShown = useMemo(() => {
    const text = query.trim();
    if (!text || splitRoute(text).trailing) return sorted;
    const hit = new Set(suggestRoutes(text, usable, 200).map((s) => s.id));
    return sorted.filter((c) => hit.has(c.id));
  }, [query, sorted, usable]);

  const childOf = (path: readonly string[]) => {
    setQuery(`${path.join('/')}/`);
    setActive(0);
    input.current?.focus();
  };

  return (
    <div
      className={`coffre-picker coffre-route${props.inline ? ' coffre-route--inline' : ''}`}
      ref={box}
      role="dialog"
      aria-label={props.label}
    >
      <div className="coffre-route__bar">
        <input
          ref={input}
          autoFocus
          className="input"
          placeholder="Cours/Thermo/Labos…"
          value={query}
          aria-label={props.label}
          aria-describedby="coffre-route-help"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(lines.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Tab' && !e.shiftKey && query.trim()) {
              const done = completeRoute(query, usable);
              if (done) {
                e.preventDefault();
                setQuery(done);
                setActive(0);
              }
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              choose(lines[active]?.pick ?? null);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <button
          type="button"
          className={`icon-button${showTree ? ' is-active' : ''}`}
          aria-pressed={showTree}
          aria-label="Choisir dans l’arbre"
          title="Choisir dans l’arbre"
          onClick={() => setShowTree((s) => !s)}
        >
          <Icon name="folder" />
        </button>
      </div>
      <p id="coffre-route-help" className="coffre-route__help">
        « / » entre deux niveaux · Tab complète · Entrée choisit
      </p>
      <ul className="coffre-picker__list" role="listbox" aria-label="Routes">
        {lines.map((l, i) => (
          <li
            key={l.key}
            role="option"
            aria-selected={i === active}
            aria-disabled={!l.pick}
            className={`coffre-picker__item${i === active ? ' coffre-picker__item--on' : ''}${l.segments ? ' coffre-picker__item--new' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(l.pick);
            }}
          >
            {l.segments ? (
              <span className="coffre-route__segments">
                {l.pick ? 'Créer ' : ''}
                {l.segments.map((s, k) => (
                  <span key={k}>
                    {k > 0 && ' › '}
                    <span className={s.isNew ? 'coffre-route__new' : undefined}>{s.name}</span>
                    {s.isNew && <span className="coffre-route__badge">nouveau</span>}
                  </span>
                ))}
                {l.error && <span className="coffre-route__error">{l.error}</span>}
              </span>
            ) : (
              <span>{l.label}</span>
            )}
            {l.hint && <span className="coffre-picker__hint">{l.hint}</span>}
          </li>
        ))}
        {!lines.length && (
          <li className="coffre-picker__empty">
            {query.trim() ? 'Rien ne correspond' : 'Écris une route ou ouvre l’arbre'}
          </li>
        )}
      </ul>
      {showTree && (
        <ul className="coffre-route__tree" role="tree" aria-label="Arbre des contextes">
          {treeShown.map((c) => (
            <li key={c.id} role="treeitem" aria-selected={false} className="coffre-route__node">
              <button
                type="button"
                className="coffre-route__pick"
                style={depthPad(c.path.length - 1)}
                title={routeLabel(c.path)}
                onClick={() => choose({ kind: 'existing', id: c.id })}
              >
                {c.name}
              </button>
              {allowNew && (
                <button
                  type="button"
                  className="icon-button coffre-route__add"
                  aria-label={`Nouveau sous-contexte dans « ${c.name} »`}
                  title="+ sous-contexte ici"
                  onClick={() => childOf(c.path)}
                >
                  <Icon name="plus" />
                </button>
              )}
            </li>
          ))}
          {!treeShown.length && <li className="coffre-picker__empty">Aucun contexte</li>}
        </ul>
      )}
    </div>
  );
}
