// v0.50.0 (Expérimental, ADR 0067): the inside of a Fin de route or a Projet —
// its tree on the left (hidden folders only with the box), the chosen file
// shown on the right by its READER, the README by default (else the files in
// cards). Keyboard: ↑ ↓ move, → opens a folder, ← closes it (or goes to its
// parent), Entrée shows a file; Ctrl+P finds a file by its name in this folder.
// One always ENTERS in ToolBox: VS Code or the application only on request
// (a button, a double-click: v0.47.1's rules — code goes to VS Code, a program
// is never run without the question naming it).
import { useEffect, useMemo, useRef, useState } from 'react';
import { runnableQuestion, isRunnable } from '@hub/sdk/core';
import { Button, ErrorMessage, formatBytes, Icon, useApi, useModule } from '@hub/sdk/frontend';
import { fold } from '../shared/deduce';
import { languageOfExt, extOf } from '../shared/kinds';
import type { FolderDto, InsideDto, InsideEntryDto, ItemDto } from '../shared/types';
import { useCoffre } from './frame';
import { ReaderView } from './ReaderView';
import { shortDate } from './logic';

const SHOW_HIDDEN = 'toolbox.coffre.showHidden';

const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

export function Inside(props: { folder: FolderDto; files: ItemDto[] | null }) {
  const module = useModule();
  const coffre = useCoffre();
  const f = props.folder;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(SHOW_HIDDEN) === '1';
    } catch {
      return false;
    }
  });
  const inside = useApi<InsideDto>(
    module.url(`/folders/${f.id}/inside${hidden ? '?hidden=1' : ''}`),
  );
  const data = inside.data;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const list = useRef<HTMLUListElement>(null);

  // The README by default (once the list is read).
  const shown = chosen ?? data?.readme ?? null;
  const entries = useMemo(() => data?.entries ?? [], [data]);
  const byRel = useMemo(() => new Map(entries.map((e) => [e.rel, e])), [entries]);
  /** The lines shown: a folder's children only when it is open. */
  const rows = useMemo(
    () =>
      entries.filter((e) => {
        for (let p = parentOf(e.rel); p; p = parentOf(p)) if (!open.has(p)) return false;
        return true;
      }),
    [entries, open],
  );

  const showFile = (e: InsideEntryDto) => {
    setChosen(e.rel);
    setFocus(e.rel);
  };
  /** Outside ToolBox, on request only. */
  const openOutside = (e: InsideEntryDto | null, how: 'vscode' | 'app' | 'folder') => {
    let runnable = false;
    if (how === 'app' && e && !e.dir && isRunnable(e.name) && !languageOfExt(extOf(e.name))) {
      if (!window.confirm(runnableQuestion(e.name))) return;
      runnable = true;
    }
    void module.api
      .post(`/folders/${f.id}/open`, { rel: e?.rel ?? '', how, runnable })
      .catch(coffre.fail);
  };

  const onKey = (ev: React.KeyboardEvent) => {
    if (finding) return;
    const at = rows.findIndex((r) => r.rel === focus);
    const cur = rows[at];
    const move = (to: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (next) setFocus(next.rel);
    };
    if (ev.key === 'ArrowDown') move(at + 1);
    else if (ev.key === 'ArrowUp') move(at - 1);
    else if (ev.key === 'ArrowRight' && cur?.dir) setOpen(new Set([...open, cur.rel]));
    else if (ev.key === 'ArrowLeft' && cur) {
      if (cur.dir && open.has(cur.rel)) setOpen(new Set([...open].filter((o) => o !== cur.rel)));
      else if (parentOf(cur.rel)) setFocus(parentOf(cur.rel));
    } else if (ev.key === 'Enter' && cur) {
      if (cur.dir)
        setOpen(
          new Set(open.has(cur.rel) ? [...open].filter((o) => o !== cur.rel) : [...open, cur.rel]),
        );
      else showFile(cur);
    } else return;
    ev.preventDefault();
  };
  // Ctrl+P: a file by its name, in this folder.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setFinding(true);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-inside="${CSS.escape(focus ?? '')}"]`)?.focus();
  }, [focus]);

  const found = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return entries
      .filter((e) => !e.dir && words.every((w) => fold(e.rel).includes(w)))
      .slice(0, 30);
  }, [entries, query]);

  const file = shown ? byRel.get(shown) : undefined;
  const item = file?.itemId ? props.files?.find((i) => i.id === file.itemId) : undefined;

  return (
    <div className="coffre-inside" data-coffre-inside>
      <div className="coffre-inside__bar">
        {f.project && (
          <Button onClick={() => openOutside(null, 'vscode')} disabled={!coffre.tools.vscode}>
            Ouvrir dans VS Code
          </Button>
        )}
        <Button variant="secondary" onClick={() => openOutside(null, 'folder')}>
          Afficher dans l’explorateur
        </Button>
        <Button variant="secondary" onClick={() => setFinding(true)} title="Ctrl+P">
          Chercher un fichier…
        </Button>
        <label className="small">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => {
              setHidden(e.target.checked);
              try {
                localStorage.setItem(SHOW_HIDDEN, e.target.checked ? '1' : '0');
              } catch {
                // Not kept.
              }
            }}
            data-coffre-show-hidden
          />{' '}
          Afficher les dossiers cachés
        </label>
        {data?.git && (
          <span className="coffre-inside__git" data-coffre-git>
            <Icon name="activity" />
            {data.git.branch ? ` ${data.git.branch}` : ' (détaché)'}
            {data.git.commit &&
              ` · ${data.git.commit.hash} ${data.git.commit.message}${data.git.commit.date ? ` (${shortDate(data.git.commit.date)})` : ''}`}
          </span>
        )}
      </div>
      {inside.error && <ErrorMessage>{inside.error}</ErrorMessage>}
      {finding && (
        <div className="coffre-inside__find" role="dialog" aria-label="Chercher un fichier">
          <input
            className="input"
            autoFocus
            placeholder="Nom du fichier…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFinding(false);
                setQuery('');
              } else if (e.key === 'Enter' && found[0]) {
                const e0 = found[0];
                const parts = e0.rel.split('/');
                setOpen(
                  new Set([
                    ...open,
                    ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')),
                  ]),
                );
                showFile(e0);
                setFinding(false);
                setQuery('');
              }
            }}
            data-coffre-find
          />
          <ul>
            {found.map((e) => (
              <li key={e.rel}>
                <button
                  type="button"
                  className="coffre-linklike"
                  onClick={() => {
                    showFile(e);
                    setFinding(false);
                    setQuery('');
                  }}
                >
                  {e.rel}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="coffre-inside__body">
        <ul
          className="coffre-inside__tree"
          role="tree"
          aria-label={`Contenu de ${f.name}`}
          ref={list}
          onKeyDown={onKey}
        >
          {rows.map((e) => {
            const depth = e.rel.split('/').length - 1;
            return (
              <li
                key={e.rel}
                role="treeitem"
                aria-expanded={e.dir ? open.has(e.rel) : undefined}
                aria-selected={shown === e.rel}
                tabIndex={(focus ?? rows[0]?.rel) === e.rel ? 0 : -1}
                data-inside={e.rel}
                className={`coffre-inside__row${shown === e.rel ? ' is-current' : ''}${e.hidden ? ' is-hidden' : ''}`}
                style={{ paddingLeft: `${6 + depth * 14}px` }}
                onFocus={() => setFocus(e.rel)}
                onClick={() =>
                  e.dir
                    ? setOpen(
                        new Set(
                          open.has(e.rel) ? [...open].filter((o) => o !== e.rel) : [...open, e.rel],
                        ),
                      )
                    : showFile(e)
                }
                onDoubleClick={() =>
                  !e.dir && openOutside(e, languageOfExt(extOf(e.name)) ? 'vscode' : 'app')
                }
              >
                <Icon
                  name={e.dir ? (open.has(e.rel) ? 'chevron-down' : 'chevron-right') : 'file'}
                />
                <span>{e.name}</span>
                {e.excluded && <span className="muted small"> (exclu)</span>}
              </li>
            );
          })}
          {data && !rows.length && <li className="muted">Vide</li>}
          {data?.truncated && (
            <li className="muted small">Trop de fichiers : la liste s’arrête ici.</li>
          )}
        </ul>
        <div className="coffre-inside__view">
          {file && !file.dir ? (
            <>
              <div className="coffre-inside__head">
                <strong>{file.rel}</strong>
                <span className="muted small"> · {formatBytes(file.size)}</span>
                {item && (
                  <Button variant="secondary" small onClick={() => coffre.preview([item], 0)}>
                    Étiquettes…
                  </Button>
                )}
                <Button
                  variant="secondary"
                  small
                  onClick={() =>
                    openOutside(file, languageOfExt(extOf(file.name)) ? 'vscode' : 'app')
                  }
                >
                  {languageOfExt(extOf(file.name))
                    ? 'Ouvrir dans VS Code'
                    : 'Ouvrir dans son application'}
                </Button>
              </div>
              <ReaderView
                key={file.rel}
                source={{ name: file.name, ext: extOf(file.name), size: file.size, url: file.url }}
                mode="full"
                icon="file"
                fallback={<p className="muted">Pas d’aperçu pour ce type de fichier.</p>}
              />
            </>
          ) : (
            <div className="coffre-inside__cards">
              {entries
                .filter((e) => !e.dir && !e.rel.includes('/'))
                .slice(0, 60)
                .map((e) => (
                  <button
                    key={e.rel}
                    type="button"
                    className="coffre-inside__card"
                    onClick={() => showFile(e)}
                  >
                    <Icon name="file" />
                    <span>{e.name}</span>
                  </button>
                ))}
              {data && !entries.some((e) => !e.dir && !e.rel.includes('/')) && (
                <p className="muted">Pas de fichier à ce niveau : ouvre un dossier à gauche.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
