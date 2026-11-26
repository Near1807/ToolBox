// v0.50.0 (Expérimental, ADR 0067): the inside of a Fin de route or a Projet —
// its tree on the left (hidden folders only with the box), the chosen file
// shown on the right by its READER, the README by default (else the files in
// cards). Keyboard: ↑ ↓ move, → opens a folder, ← closes it (or goes to its
// parent), Entrée shows a file; Ctrl+P finds a file by its name in this folder.
// One always ENTERS in ToolBox: VS Code or the application only on request
// (a button, a double-click: v0.47.1's rules — code goes to VS Code, a program
// is never run without the question naming it).
// v0.51.0 (ADR 0068): a project's file opened from the search (positioned on
// it, the reader at its line or page); what it does not save shown greyed
// with its reason (« Ne pas sauvegarder ce dossier » / « Le sauvegarder quand
// même »); a file inside a project: its labels come from the project, its
// own window (« Plein écran »).
import { useEffect, useMemo, useRef, useState } from 'react';
import { runnableQuestion, isRunnable } from '@hub/sdk/core';
import {
  Button,
  ErrorMessage,
  formatBytes,
  Icon,
  runJob,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import { fold } from '../shared/deduce';
import { languageOfExt, extOf } from '../shared/kinds';
import type {
  ExclusionReasonDto,
  ExclusionsDto,
  FolderDto,
  InnerFileDto,
  InsideDto,
  InsideEntryDto,
  ItemDto,
} from '../shared/types';
import { useCoffre } from './frame';
import { ReaderView } from './ReaderView';
import { shortDate } from './logic';

const SHOW_HIDDEN = 'toolbox.coffre.showHidden';

const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

/** v0.51.0: why a path is not saved, said plainly. */
export const EXCLUDED_TEXT: Record<ExclusionReasonDto, string> = {
  défaut: 'non sauvegardé, recréable',
  '.gitignore': 'non sauvegardé (.gitignore)',
  choisi: 'non sauvegardé (ton choix)',
};

/** v0.51.0: a file to open from the search (its line or page, the words marked). */
export interface InsideFocus {
  rel: string;
  line?: number;
  page?: number;
  query?: string;
}

export function Inside(props: {
  folder: FolderDto;
  files: ItemDto[] | null;
  focus?: InsideFocus | null;
}) {
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
  const project = f.project ? (props.files?.find((x) => x.kind === 'project') ?? null) : null;
  const [showExcluded, setShowExcluded] = useState(false);

  // v0.51.0: opened on one file (the search): its folders open, it is shown
  // (once per file asked, when the list is read: state adjusted while rendering).
  const wanted = props.focus ?? null;
  const focusKey =
    wanted && data ? `${wanted.rel}|${wanted.line ?? ''}|${wanted.page ?? ''}` : null;
  const [applied, setApplied] = useState<string | null>(null);
  if (wanted && focusKey && applied !== focusKey) {
    const parts = wanted.rel.split('/');
    setApplied(focusKey);
    setOpen(
      new Set([...open, ...parts.slice(0, -1).map((_, k) => parts.slice(0, k + 1).join('/'))]),
    );
    setChosen(wanted.rel);
    setFocus(wanted.rel);
  }

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
      .post(`/folders/${f.id}/open`, {
        rel: e?.rel ?? '',
        how,
        runnable,
        // v0.51.0: VS Code at the line found by the search.
        line: e && wanted?.rel === e.rel ? wanted.line : undefined,
      })
      .catch(coffre.fail);
  };
  /** v0.51.0: « Ne pas sauvegarder ce dossier » / « Le sauvegarder quand même » / « Comme avant ». */
  const exclusion = async (rel: string, action: 'exclude' | 'include' | 'reset') => {
    try {
      const r = await runJob<{ undoId: string; files: number }>(
        module.api.post(`/folders/${f.id}/exclusions`, { rel, action }),
      );
      coffre.notify(
        action === 'exclude'
          ? `« ${rel} » n’est plus sauvegardé (les fichiers ne bougent pas).`
          : `« ${rel} » est sauvegardé.`,
        r.undoId,
      );
      inside.reload();
      coffre.refresh();
    } catch (e) {
      coffre.fail(e);
    }
  };
  /** v0.51.0: a file in its own window (« Plein écran »). */
  const fullScreen = (e: InsideEntryDto) => {
    const call = e.itemId
      ? module.api.post(`/files/${e.itemId}/read-window`)
      : project
        ? module.api.post(`/files/${project.id}/inner/read-window`, { rel: e.rel })
        : null;
    if (call) void call.catch(coffre.fail);
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
      {project && (
        <ProjectSaveBar
          folder={f}
          entry={focus ? (byRel.get(focus) ?? null) : null}
          open={showExcluded}
          onToggle={() => setShowExcluded(!showExcluded)}
          onChange={(rel, action) => void exclusion(rel, action)}
        />
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
                className={`coffre-inside__row${shown === e.rel ? ' is-current' : ''}${e.hidden ? ' is-hidden' : ''}${e.excluded ? ' is-excluded' : ''}`}
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
                {e.excluded && (
                  <span className="small coffre-inside__excl">
                    {' '}
                    {e.excludedReason
                      ? EXCLUDED_TEXT[e.excludedReason]
                      : 'non sauvegardé, recréable'}
                  </span>
                )}
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
                {(item || project) && (
                  <Button
                    variant="secondary"
                    small
                    onClick={() => fullScreen(file)}
                    data-coffre-inner-fullscreen
                  >
                    Plein écran
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
              {project && <InnerLabels projectId={project.id} rel={file.rel} />}
              <ReaderView
                key={file.rel}
                source={{ name: file.name, ext: extOf(file.name), size: file.size, url: file.url }}
                locate={
                  wanted?.rel === file.rel
                    ? { line: wanted.line, page: wanted.page, query: wanted.query }
                    : undefined
                }
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

/**
 * v0.51.0: what a project does not save — the focused folder's choice
 * (« Ne pas sauvegarder ce dossier » / « Le sauvegarder quand même »), and the
 * list of what is not saved with its reason and the room it frees.
 */
function ProjectSaveBar(props: {
  folder: FolderDto;
  entry: InsideEntryDto | null;
  open: boolean;
  onToggle: () => void;
  onChange: (rel: string, action: 'exclude' | 'include' | 'reset') => void;
}) {
  const module = useModule();
  const list = useApi<ExclusionsDto>(
    props.open ? module.url(`/folders/${props.folder.id}/exclusions`) : null,
  );
  const e = props.entry;
  const isGit = e ? e.rel.split('/').includes('.git') : false;
  return (
    <div className="coffre-inside__save" data-coffre-save-bar>
      {e?.dir && !isGit && (
        <>
          <span className="small">
            Dossier « {e.rel} » :{' '}
            {e.excluded
              ? e.excludedReason
                ? EXCLUDED_TEXT[e.excludedReason]
                : 'non sauvegardé'
              : 'sauvegardé'}
          </span>
          {e.excluded ? (
            <Button
              variant="secondary"
              small
              onClick={() =>
                props.onChange(e.rel, e.excludedReason === 'choisi' ? 'reset' : 'include')
              }
              data-coffre-include
            >
              {e.excludedReason === 'choisi'
                ? 'Le sauvegarder de nouveau'
                : 'Le sauvegarder quand même'}
            </Button>
          ) : (
            <Button
              variant="secondary"
              small
              onClick={() => props.onChange(e.rel, 'exclude')}
              data-coffre-exclude
            >
              Ne pas sauvegarder ce dossier
            </Button>
          )}
        </>
      )}
      <Button variant="secondary" small onClick={props.onToggle} aria-expanded={props.open}>
        Ce qui n’est pas sauvegardé…
      </Button>
      <span className="badge badge--warning">Expérimental</span>
      {props.open && (
        <div className="coffre-inside__excluded" data-coffre-excluded-list>
          {list.error && <ErrorMessage>{list.error}</ErrorMessage>}
          {list.data && !list.data.excluded.length && (
            <p className="muted small">Tout est sauvegardé (sauf .git, toujours gardé).</p>
          )}
          {list.data && list.data.excluded.length > 0 && (
            <>
              <p className="muted small">
                Ni sauvegardé sur le disque, ni cherché. Les fichiers restent où ils sont.
                Sauvegardé : {list.data.files.toLocaleString('fr-FR')} fichier(s),{' '}
                {formatBytes(list.data.bytes)}.
              </p>
              <ul>
                {list.data.excluded.map((x) => (
                  <li key={x.rel}>
                    <span>{x.rel}</span>
                    <span className="muted small">
                      {' '}
                      · {EXCLUDED_TEXT[x.reason]} · {x.partial ? 'plus de ' : ''}
                      {formatBytes(x.bytes)} gagnés
                    </span>{' '}
                    <button
                      type="button"
                      className="coffre-linklike small"
                      onClick={() =>
                        props.onChange(x.rel, x.reason === 'choisi' ? 'reset' : 'include')
                      }
                    >
                      {x.reason === 'choisi'
                        ? 'Le sauvegarder de nouveau'
                        : 'Le sauvegarder quand même'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** v0.51.0: a file inside a project has no sheet: its labels are deduced or the project's. */
function InnerLabels(props: { projectId: string; rel: string }) {
  const module = useModule();
  const r = useApi<InnerFileDto>(
    module.url(`/files/${props.projectId}/inner?rel=${encodeURIComponent(props.rel)}`),
  );
  if (!r.data) return null;
  return (
    <p className="small coffre-inside__labels" data-coffre-inner-labels>
      {r.data.labels.map((l) => (
        <span key={`${l.family}:${l.value}`} className="coffre-chip" title={l.reason ?? undefined}>
          {l.value}
        </span>
      ))}
      <span className="muted">
        {' '}
        Pas de fiche par fichier dans un projet : c’est le projet qui porte les étiquettes.
      </span>
    </p>
  );
}
