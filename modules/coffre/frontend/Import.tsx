// v0.48.0 (Expérimental): « Importer une arborescence » (ADR 0065). First the
// preview, nothing written: the contexts to create under a route (the route
// picker; the root by default), files and size per folder, the code
// projects kept as ONE element (a box per project), their dependencies and
// build folders (left out by default), the duplicates (left aside unless
// kept), the system / temporary files ignored, the existing contexts merged.
// Then « Importer »: a copy in the background (the original untouched; an
// adoption for a folder already in the Coffre: no copy) — progress, cancel,
// resumed after a restart — and ONE « Annuler ».
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Button,
  ErrorMessage,
  errorMessage,
  formatBytes,
  Icon,
  ProgressBar,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import { routeLabel } from '../shared/route';
import type {
  FoundFolderDto,
  ImportNodeDto,
  ImportPreviewDto,
  ImportStatusDto,
} from '../shared/types';
import { useCoffre } from './frame';
import { choiceLabel, pickToChoice, type ContextChoice } from './logic';
import { RoutePicker } from './RoutePicker';

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

interface Choices {
  asFolder: string[];
  asProject: string[];
  deps: string[];
  keepDuplicates: boolean;
}

function routeBody(choice: ContextChoice) {
  if (!choice) return {};
  return choice.kind === 'existing' ? { contextId: choice.id } : { newContext: choice.path };
}

export function ImportDialog(props: {
  source: string;
  adopt: boolean;
  route: string | null;
  onClose: () => void;
}) {
  const coffre = useCoffre();
  const [route, setRoute] = useState<ContextChoice>(
    props.route ? { kind: 'existing', id: props.route, origin: 'chosen', reason: null } : null,
  );
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choices>({
    asFolder: [],
    asProject: [],
    deps: [],
    keepDuplicates: false,
  });
  const [status, setStatus] = useState<ImportStatusDto | null>(null);
  const { api } = coffre;

  // The preview (again when the route changes): nothing is written.
  useEffect(() => {
    let live = true;
    api
      .post<ImportPreviewDto>('/import/preview', {
        source: props.source,
        adopt: props.adopt,
        ...routeBody(route),
      })
      .then((p) => live && (setPreview(p), setError(null)))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [api, props.source, props.adopt, route]);

  // The progress, while it runs.
  const running = status?.state === 'running';
  useEffect(() => {
    if (!status || !running) return;
    const t = setInterval(() => {
      api
        .get<ImportStatusDto>(`/import/${status.id}`)
        .then((s) => {
          setStatus(s);
          if (s.state !== 'running') coffre.refresh();
        })
        .catch(() => undefined);
    }, 500);
    return () => clearInterval(t);
  }, [api, status, running, coffre]);

  const start = async () => {
    setError(null);
    try {
      setStatus(
        await api.post<ImportStatusDto>('/import/start', {
          source: props.source,
          adopt: props.adopt,
          ...routeBody(route),
          ...choices,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const kept = useMemo(() => {
    if (!preview) return null;
    // What « Importer » will take, with Thomas's choices.
    let files = 0;
    let bytes = 0;
    let projects = 0;
    const walk = (n: ImportNodeDto) => {
      const project =
        (n.marker !== null && !choices.asFolder.includes(n.rel)) ||
        choices.asProject.includes(n.rel);
      if (project) {
        projects++;
        files += n.files;
        bytes += n.bytes;
        for (const d of n.deps)
          if (choices.deps.includes(d.rel)) {
            files += d.files;
            bytes += d.bytes;
          }
        return;
      }
      if (n.marker === null) {
        files += n.files;
        bytes += n.bytes;
      } else {
        // A project imported as folders: its own files here, its sub-folders below.
        files += n.files - n.children.reduce((s, c) => s + c.totalFiles, 0);
        bytes += n.bytes - n.children.reduce((s, c) => s + c.totalBytes, 0);
      }
      n.children.forEach(walk);
    };
    walk(preview.tree);
    if (!choices.keepDuplicates && !props.adopt) files -= preview.duplicates.length;
    return { files: Math.max(0, files), bytes, projects };
  }, [preview, choices, props.adopt]);

  const toggle = (key: 'asFolder' | 'asProject' | 'deps', rel: string) =>
    setChoices((c) => ({
      ...c,
      [key]: c[key].includes(rel) ? c[key].filter((x) => x !== rel) : [...c[key], rel],
    }));

  const node = (n: ImportNodeDto, depth: number): React.ReactNode => {
    const detected = n.marker !== null;
    const project =
      (detected && !choices.asFolder.includes(n.rel)) || choices.asProject.includes(n.rel);
    return (
      <li key={n.rel || '.'} className="coffre-import__node">
        <div className="coffre-import__line" style={{ paddingLeft: `${depth * 16}px` }}>
          <Icon name={project ? 'package' : 'folder'} />
          <strong className="coffre-import__name">{n.name}</strong>
          <span className="muted small">
            {project
              ? `projet : ${plural(n.files, 'fichier')}, ${formatBytes(n.bytes)}`
              : `${plural(n.files, 'fichier')}${n.files ? `, ${formatBytes(n.bytes)}` : ''}`}
          </span>
          {n.exists && !project && <span className="coffre-chip">existe déjà : fusionné</span>}
          {n.invalidName && <span className="coffre-chip coffre-chip--warn">{n.invalidName}</span>}
          {depth > 0 && (
            <label
              className={`coffre-import__project${project ? '' : ' coffre-import__project--off'}`}
              title={n.marker ? `Repéré : ${n.marker}` : undefined}
            >
              <input
                type="checkbox"
                checked={project}
                onChange={() => toggle(detected ? 'asFolder' : 'asProject', n.rel)}
              />{' '}
              un seul élément (projet{n.marker ? ` · ${n.marker}` : ''})
            </label>
          )}
        </div>
        {project && n.deps.length > 0 && (
          <ul className="coffre-import__deps" style={{ paddingLeft: `${depth * 16 + 24}px` }}>
            {n.deps.map((d) => (
              <li key={d.rel}>
                <label>
                  <input
                    type="checkbox"
                    checked={choices.deps.includes(d.rel)}
                    onChange={() => toggle('deps', d.rel)}
                  />{' '}
                  {d.rel.slice(n.rel ? n.rel.length + 1 : 0)}{' '}
                  <span className="muted small">
                    dépendances / compilation : {plural(d.files, 'fichier')}, {formatBytes(d.bytes)}{' '}
                    (laissé de côté sauf si coché)
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {!project && n.children.length > 0 && (
          <ul className="coffre-import__tree">{n.children.map((c) => node(c, depth + 1))}</ul>
        )}
      </li>
    );
  };

  const where = props.adopt
    ? routeLabel(preview?.route ?? []) || 'la racine du Coffre'
    : route
      ? choiceLabel(route, coffre.contexts)
      : 'la racine du Coffre';

  return (
    <div
      className="coffre-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Importer une arborescence"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !running) {
          e.preventDefault();
          props.onClose();
        }
      }}
    >
      <div className="coffre-modal__box coffre-import" data-coffre-import>
        <header className="coffre-deposit__head">
          <h2>{props.adopt ? 'Adopter un dossier du Coffre' : 'Importer une arborescence'}</h2>
          <span className="badge badge--warning">Expérimental</span>
          <button type="button" className="icon-button" aria-label="Fermer" onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="coffre-import__body">
          <p className="coffre-import__source" title={props.source}>
            <Icon name="folder" /> {props.source}
          </p>
          <p className="muted small">
            {props.adopt
              ? 'Ce dossier est déjà dans le Coffre : ses sous-dossiers deviennent des contextes, ses fichiers restent où ils sont (aucune copie).'
              : 'Ses sous-dossiers deviennent des contextes et ses fichiers y sont copiés. L’original ne bouge pas.'}
          </p>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          {!status && (
            <div className="coffre-import__route">
              <span className="coffre-batch__label">Sous</span>
              {props.adopt ? (
                <strong>{where}</strong>
              ) : (
                <>
                  <button
                    type="button"
                    className="coffre-sheet__pick"
                    onClick={() => setPicking(true)}
                    data-coffre-import-route
                  >
                    {where}
                  </button>
                  {picking && (
                    <RoutePicker
                      label="Importer sous"
                      contexts={coffre.contexts}
                      root
                      onClose={() => setPicking(false)}
                      onPick={(pick) => {
                        setPicking(false);
                        setPreview(null);
                        setRoute(
                          pick.kind === 'root' || pick.kind === 'arrival'
                            ? null
                            : pickToChoice(pick),
                        );
                      }}
                    />
                  )}
                </>
              )}
            </div>
          )}
          {!preview && !error && <p className="muted">Lecture du dossier…</p>}
          {preview && !status && (
            <>
              <ul
                className="coffre-import__tree coffre-import__root"
                aria-label="Contextes à créer"
              >
                {node(preview.tree, 0)}
              </ul>
              <div className="coffre-import__notes">
                {preview.merges.length > 0 && (
                  <p className="small">
                    <Icon name="folder-input" /> Fusionné avec{' '}
                    {plural(preview.merges.length, 'contexte')} existant
                    {preview.merges.length > 1 ? 's' : ''} :{' '}
                    {preview.merges.slice(0, 4).map(routeLabel).join(', ')}
                    {preview.merges.length > 4 ? '…' : ''}
                  </p>
                )}
                {preview.duplicates.length > 0 && !props.adopt && (
                  <details className="small">
                    <summary>
                      {plural(preview.duplicates.length, 'doublon')} (même empreinte) : laissé
                      {preview.duplicates.length > 1 ? 's' : ''} de côté
                    </summary>
                    <ul>
                      {preview.duplicates.slice(0, 50).map((d) => (
                        <li key={d.rel}>
                          {d.rel} —{' '}
                          {d.existing
                            ? `déjà dans le Coffre : « ${d.existing.name} »`
                            : `même contenu que ${d.twinOf}`}
                        </li>
                      ))}
                    </ul>
                    <label>
                      <input
                        type="checkbox"
                        checked={choices.keepDuplicates}
                        onChange={(e) =>
                          setChoices({ ...choices, keepDuplicates: e.target.checked })
                        }
                      />{' '}
                      Les importer quand même
                    </label>
                  </details>
                )}
                {preview.ignored.length > 0 && (
                  <details className="small">
                    <summary>
                      {plural(preview.totals.ignored, 'fichier')} système ou temporaire
                      {preview.totals.ignored > 1 ? 's' : ''} ignoré
                      {preview.totals.ignored > 1 ? 's' : ''}
                    </summary>
                    <ul>
                      {preview.ignored.slice(0, 50).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </>
          )}
          {status && (
            <div className="coffre-import__progress" role="status" data-coffre-import-status>
              {status.state === 'running' && (
                <>
                  <ProgressBar
                    value={status.bytesTotal ? status.bytesDone / status.bytesTotal : null}
                  />
                  <p>
                    {status.done} / {status.total} · {formatBytes(status.bytesDone)} sur{' '}
                    {formatBytes(status.bytesTotal)} · en arrière-plan (tu peux fermer cette fenêtre
                    ; reprise après un redémarrage)
                  </p>
                </>
              )}
              {status.state === 'done' && (
                <p>
                  <Icon name="circle-check" /> Importé : {plural(status.items, 'élément')},{' '}
                  {plural(status.contexts, 'contexte')} créé{status.contexts > 1 ? 's' : ''}. Chaque
                  élément est « à compléter ».{' '}
                  <Link to={coffre.path('etat/tocomplete')} onClick={props.onClose}>
                    Voir « À compléter »
                  </Link>
                </p>
              )}
              {status.state === 'cancelled' && <p>Import annulé : rien n’a été gardé.</p>}
              {status.state === 'failed' && <ErrorMessage>{status.error ?? 'Échec'}</ErrorMessage>}
            </div>
          )}
        </div>
        <footer className="coffre-deposit__foot">
          {!status && (
            <>
              <Button variant="secondary" onClick={props.onClose}>
                Fermer
              </Button>
              <Button
                autoFocus
                disabled={!preview || !kept}
                onClick={() => void start()}
                data-coffre-import-start
              >
                {props.adopt ? 'Adopter' : 'Importer'}
                {kept ? ` (${plural(kept.files, 'fichier')}, ${formatBytes(kept.bytes)})` : ''}
              </Button>
            </>
          )}
          {status?.state === 'running' && (
            <Button
              variant="secondary"
              onClick={() =>
                void api
                  .post(`/import/${status.id}/cancel`, {})
                  .catch((e) => setError(errorMessage(e)))
              }
            >
              Annuler l’import
            </Button>
          )}
          {status && status.state !== 'running' && (
            <>
              {status.state === 'done' && status.undoId && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    void api
                      .post('/undo', { undoId: status.undoId })
                      .then(() => {
                        coffre.notify(
                          props.adopt
                            ? 'Adoption annulée : les fichiers restent dans le Coffre.'
                            : 'Import annulé : les copies sont retirées, l’original n’a pas bougé.',
                        );
                        coffre.refresh();
                        props.onClose();
                      })
                      .catch((e) => setError(errorMessage(e)))
                  }
                >
                  Annuler l’import
                </Button>
              )}
              <Button onClick={props.onClose}>Fermer</Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * Gestion › the imports: « Importer une arborescence… », the imports running
 * or just done (progress, cancel), the folders put in the Coffre by hand
 * (proposed for adoption — never adopted alone).
 */
export function ImportsPanel() {
  const coffre = useCoffre();
  const module = useModule();
  const list = useApi<ImportStatusDto[]>(module.url('/import/list'));
  const found = useApi<FoundFolderDto[]>(module.url('/import/found'));
  const { reload } = list;
  const running = (list.data ?? []).some((i) => i.state === 'running');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 1000);
    return () => clearInterval(t);
  }, [running, reload]);
  // The running ones, then the last three.
  const recent = (list.data ?? []).filter((i, n) => i.state === 'running' || n < 3);
  return (
    <section className="coffre-panel coffre-imports" aria-label="Importer" data-coffre-imports>
      <h2 className="coffre-h2">
        Importer <span className="badge badge--warning">Expérimental</span>
      </h2>
      {(found.data ?? []).map((f) => (
        <div key={f.rel} className="coffre-banner" role="status" data-coffre-found>
          <span>
            Dossier « {f.rel} » ajouté à la main dans le Coffre ({plural(f.files, 'fichier')}) :
            ToolBox ne le connaît pas encore.
          </span>
          <Button small onClick={() => coffre.importTree(f.path, { adopt: true })}>
            L’adopter…
          </Button>
        </div>
      ))}
      <Button variant="secondary" onClick={() => coffre.importTree()} data-coffre-import-open>
        Importer une arborescence…
      </Button>
      <p className="muted small">
        Un dossier existant (« Programmation ») : ses sous-dossiers deviennent des contextes, ses
        fichiers y vont, un projet de code reste un seul élément. Aperçu d’abord ; l’original ne
        bouge pas.
      </p>
      {recent.length > 0 && (
        <ul className="coffre-imports__list">
          {recent.map((i) => (
            <li key={i.id}>
              <strong>{i.source.split(/[\\/]/).pop()}</strong>{' '}
              <span className="muted small">
                {i.state === 'running'
                  ? `${i.done} / ${i.total} · ${formatBytes(i.bytesDone)} sur ${formatBytes(i.bytesTotal)}`
                  : i.state === 'done'
                    ? `${plural(i.items, 'élément')} importé${i.items > 1 ? 's' : ''}`
                    : i.state === 'cancelled'
                      ? 'annulé'
                      : i.state === 'undone'
                        ? 'annulé après coup'
                        : `échec : ${i.error ?? ''}`}
              </span>
              {i.state === 'running' && (
                <>
                  <ProgressBar value={i.bytesTotal ? i.bytesDone / i.bytesTotal : null} />
                  <Button
                    variant="secondary"
                    small
                    onClick={() =>
                      void coffre.api
                        .post(`/import/${i.id}/cancel`, {})
                        .then(reload)
                        .catch(coffre.fail)
                    }
                  >
                    Annuler l’import
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
