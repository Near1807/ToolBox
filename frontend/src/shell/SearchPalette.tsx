// v0.47.0 (Expérimental): the hub's search — Ctrl+K anywhere (MODULES.md
// §5.18, ADR 0057). The tools (the navigation's search, as before) and the
// results of every module that provides a search (the Coffre: its elements,
// their page, the word marked). Results while typing, asked from the server;
// ↑ ↓ to move, Entrée to open, Échap to close. Read only: opening a result is
// only going to a page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, Icon, MarkedText, type IconName } from '@hub/sdk/frontend';
import { ICONS } from '@hub/sdk/icons';
import { useNavigation } from './NavigationContext';
import { filterNavigation } from './navigation';

/** Any part of the shell (the sidebar's field…) opens the search with this event. */
export const SEARCH_EVENT = 'toolbox:search';

interface SearchResult {
  id: string;
  title: string;
  snippet?: string;
  hint?: string;
  icon?: string;
  open: string;
}
interface SearchGroup {
  moduleId: string;
  label: string;
  results: SearchResult[];
  more?: string;
  ms: number;
  error?: string;
}

interface Row {
  key: string;
  title: string;
  snippet?: string;
  hint?: string;
  icon: IconName;
  open: string;
}

const iconOf = (name: string | undefined, fallback: IconName): IconName =>
  name && name in ICONS ? (name as IconName) : fallback;

export function SearchPalette() {
  const navigate = useNavigate();
  const { sidebar } = useNavigation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** The last answer, for the query it answers (another query: not shown). */
  const [answer, setAnswer] = useState<{ q: string; groups: SearchGroup[]; ms: number } | null>(
    null,
  );
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = () => {
      setOpen(true);
      requestAnimationFrame(() => input.current?.select());
    };
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      event.stopPropagation();
      show();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener(SEARCH_EVENT, show);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener(SEARCH_EVENT, show);
    };
  }, []);

  // Asked while typing (a short pause), the last answer only.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) return;
    let live = true;
    const timer = setTimeout(() => {
      api
        .get<{ groups: SearchGroup[]; ms: number }>(
          `/api/core/search?q=${encodeURIComponent(q)}&limit=8`,
        )
        .then((r) => {
          if (!live) return;
          setAnswer({ q, groups: r.groups, ms: r.ms });
          setActive(0);
        })
        .catch(() => live && setAnswer({ q, groups: [], ms: 0 }));
    }, 90);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, open]);

  const answered = answer && answer.q === query.trim() ? answer : null;
  const groups = useMemo(() => answered?.groups ?? [], [answered]);
  const busy = query.trim() !== '' && !answered;
  const ms = answered?.ms ?? null;
  const tools = useMemo<Row[]>(() => {
    if (!query.trim()) return [];
    return filterNavigation(sidebar, query)
      .flatMap((c) => c.tools)
      .slice(0, 6)
      .map((t) => ({
        key: `tool:${t.id}`,
        title: t.name,
        hint: 'Outil',
        icon: iconOf(t.module.manifest.icon, 'grid'),
        open: `/m/${t.id}`,
      }));
  }, [sidebar, query]);
  const sections = useMemo(
    () => [
      ...(tools.length ? [{ key: 'tools', label: 'Outils', rows: tools, more: undefined }] : []),
      ...groups.map((g) => ({
        key: g.moduleId,
        label: g.label,
        more: g.more,
        rows: g.results.map((r): Row => ({
          key: `${g.moduleId}:${r.id}`,
          title: r.title,
          snippet: r.snippet,
          hint: r.hint,
          icon: iconOf(r.icon, 'file'),
          open: r.open,
        })),
      })),
    ],
    [tools, groups],
  );
  const flat = sections.flatMap((s) => s.rows);

  if (!open) return null;
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const go = (route: string) => {
    close();
    void navigate(route);
  };
  let index = -1;
  return (
    <div className="quick-add-layer" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="quick-add search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Rechercher partout"
      >
        <div className="search-palette__bar">
          <Icon name="search" />
          <input
            ref={input}
            autoFocus
            className="input quick-add__input"
            placeholder="Chercher partout : un outil, un fichier, un mot dans un PDF…"
            aria-label="Chercher partout"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(flat.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && flat[active]) {
                e.preventDefault();
                go(flat[active]!.open);
              }
            }}
          />
          <span className="badge badge--warning">Expérimental</span>
        </div>
        <div className="search-palette__list" role="listbox" aria-label="Résultats">
          {sections.map((s) => (
            <section key={s.key} className="search-palette__group">
              <h3 className="search-palette__label">
                {s.label}
                {s.more && (
                  <button
                    type="button"
                    className="search-palette__more"
                    onClick={() => go(s.more!)}
                  >
                    Tous les résultats
                  </button>
                )}
              </h3>
              {s.rows.map((r) => {
                index++;
                const i = index;
                return (
                  <button
                    key={r.key}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={`search-palette__row${i === active ? ' search-palette__row--on' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.open)}
                  >
                    <Icon name={r.icon} />
                    <span className="search-palette__text">
                      <strong>{r.title}</strong>
                      {r.hint && <span className="faint small">{r.hint}</span>}
                      {r.snippet && (
                        <MarkedText className="search-palette__snippet small" text={r.snippet} />
                      )}
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
          {query.trim() && !busy && flat.length === 0 && (
            <p className="faint small search-palette__empty">Rien trouvé.</p>
          )}
        </div>
        <p className="faint small search-palette__foot">
          ↑ ↓ pour choisir · Entrée pour ouvrir · Échap pour fermer
          {ms !== null && ` · ${ms} ms`}
        </p>
      </div>
    </div>
  );
}
