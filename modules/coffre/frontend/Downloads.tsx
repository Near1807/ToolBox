// v0.47.0 (Expérimental): « 3 nouveaux téléchargements » on the Coffre's home
// (only when Thomas switched the watching on, Réglages › Coffre) — « Ranger »
// opens the rangement window with them, « Ignorer » stops proposing them;
// « Proposer aussi les fichiers déjà présents » once, with a selection.
// Nothing is put away nor touched without a click.
import { useEffect, useState } from 'react';
import { Button, Counter, formatBytes, useApi, useModule } from '@hub/sdk/frontend';
import type { DownloadDto, DownloadsDto } from '../shared/types';
import { useCoffre } from './frame';

/** The watching's state, read again every few seconds while it is on. */
export function useDownloads(everyMs = 5000) {
  const module = useModule();
  const state = useApi<DownloadsDto>(module.url('/downloads'));
  const { reload } = state;
  const on = state.data?.enabled === true;
  useEffect(() => {
    if (!on) return;
    const t = setInterval(reload, everyMs);
    return () => clearInterval(t);
  }, [on, reload, everyMs]);
  return state;
}

export function DownloadsPanel() {
  const coffre = useCoffre();
  const module = useModule();
  const state = useDownloads();
  const [existing, setExisting] = useState<DownloadDto[] | null>(null);
  const d = state.data;
  if (!d?.enabled) return null;
  const n = d.pending.length;
  const ignore = (paths: string[]) =>
    void module.api
      .post('/downloads/ignore', { paths })
      .then(() => state.reload())
      .catch(coffre.fail);
  return (
    <section className="coffre-panel coffre-downloads" aria-label="Nouveaux téléchargements">
      <h2 className="coffre-h2">
        Téléchargements <span className="badge badge--warning">Expérimental</span>
      </h2>
      {n ? (
        <>
          <Counter
            value={n}
            label={n > 1 ? 'nouveaux téléchargements' : 'nouveau téléchargement'}
            tone="accent"
          />
          <ul className="coffre-downloads__list">
            {d.pending.slice(0, 4).map((p) => (
              <li key={p.path} title={p.path}>
                {p.name} <span className="muted small">{formatBytes(p.size)}</span>
              </li>
            ))}
            {n > 4 && (
              <li className="muted small">
                et {n - 4} autre{n > 5 ? 's' : ''}
              </li>
            )}
          </ul>
          <div className="coffre-downloads__actions">
            <Button onClick={() => coffre.range(d.pending.map((p) => p.path))}>Ranger</Button>
            <Button variant="secondary" onClick={() => ignore(d.pending.map((p) => p.path))}>
              Ignorer
            </Button>
          </div>
        </>
      ) : (
        <p className="muted small">
          Rien de nouveau dans {d.folder}
          {d.waiting ? ` (${d.waiting} en cours de téléchargement)` : ''}.
        </p>
      )}
      <button
        type="button"
        className="coffre-linklike small"
        onClick={() =>
          void module.api
            .get<DownloadDto[]>('/downloads/existing')
            .then(setExisting)
            .catch(coffre.fail)
        }
      >
        Proposer aussi les fichiers déjà présents…
      </button>
      {existing && (
        <ExistingDialog
          files={existing}
          onClose={() => setExisting(null)}
          onRange={(paths) => {
            setExisting(null);
            coffre.range(paths);
          }}
        />
      )}
    </section>
  );
}

/** The files that were there before the activation: Thomas chooses which to put away. */
function ExistingDialog(props: {
  files: DownloadDto[];
  onClose: () => void;
  onRange: (paths: string[]) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const all = chosen.size === props.files.length && props.files.length > 0;
  return (
    <div
      className="coffre-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Fichiers déjà présents"
    >
      <div className="coffre-modal__box coffre-existing">
        <h2>Fichiers déjà dans le dossier</h2>
        <p className="muted small">
          Ils étaient là avant l’activation. Coche ceux à ranger : la fenêtre de rangement s’ouvre
          avec eux. Les autres restent où ils sont.
        </p>
        {props.files.length ? (
          <>
            <label className="coffre-existing__all">
              <input
                type="checkbox"
                checked={all}
                onChange={() =>
                  setChosen(all ? new Set() : new Set(props.files.map((f) => f.path)))
                }
              />{' '}
              Tout cocher ({props.files.length})
            </label>
            <ul className="coffre-existing__list">
              {props.files.map((f) => (
                <li key={f.path}>
                  <label>
                    <input
                      type="checkbox"
                      checked={chosen.has(f.path)}
                      onChange={() => {
                        const next = new Set(chosen);
                        if (next.has(f.path)) next.delete(f.path);
                        else next.add(f.path);
                        setChosen(next);
                      }}
                    />{' '}
                    {f.name} <span className="muted small">{formatBytes(f.size)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">Aucun fichier d’avant l’activation dans ce dossier.</p>
        )}
        <div className="coffre-existing__foot">
          <Button variant="secondary" onClick={props.onClose}>
            Fermer
          </Button>
          <Button disabled={!chosen.size} onClick={() => props.onRange([...chosen])}>
            Ranger la sélection ({chosen.size})
          </Button>
        </div>
      </div>
    </div>
  );
}
