// v0.46.0: « Mettre à jour » — first the detailed plan (what will be copied,
// updated, moved, sent to the Recycle Bin; the room needed and the room
// left), then the progress (gauge, counters, « Annuler »), then the report
// (« 12 copiés, 3 mis à jour, vérifiés ») and « Éjecter le disque ».
import { useEffect, useState } from 'react';
import {
  Button,
  Counter,
  ErrorMessage,
  errorMessage,
  formatBytes,
  Icon,
  runJob,
  useApi,
  useModule,
  useTaskFollow,
} from '@hub/sdk/frontend';
import type { DiskStatusDto, UpdateReport } from '../../shared/types';
import { useCoffre } from '../frame';
import { TaskGauge } from './TaskGauge';
import { plural } from './useDisk';

interface Step {
  kind: 'copy' | 'update' | 'move' | 'trash' | 'repair';
  itemId: string;
  name: string;
  from: string | null;
  to: string;
  size: number;
  /** v0.51.0: a project — its files to copy, gone, or compared (adopted). */
  files?: number;
  removed?: number;
  adopt?: boolean;
}
interface Plan {
  steps: Step[];
  counts: DiskStatusDto['counts'];
  needed: number;
  free: number | null;
  enough: boolean;
  problems: { itemId: string; name: string; reason: string }[];
}

const KIND_LABEL: Record<Step['kind'], string> = {
  copy: 'À copier',
  update: 'À mettre à jour (l’ancienne version va dans l’historique)',
  repair: 'À recopier (copie abîmée)',
  move: 'À déplacer ou renommer',
  trash: 'Vers la corbeille du disque',
};

/** v0.51.0: a project, file by file — « 1 fichier à copier, 2 vers l'historique ». */
function projectText(s: Step): string {
  if (s.adopt)
    return `${s.files} fichiers comparés un par un (les identiques ne sont pas recopiés)`;
  const parts = [`${s.files} fichier${s.files === 1 ? '' : 's'} à copier`];
  if (s.removed) parts.push(`${s.removed} supprimé(s) ou renommé(s) vers l’historique`);
  return parts.join(', ');
}

export function reportText(r: UpdateReport): string {
  const parts = [
    r.copied && `${r.copied} copié${r.copied > 1 ? 's' : ''}`,
    r.updated && `${r.updated} mis à jour`,
    r.repaired && `${r.repaired} recopié${r.repaired > 1 ? 's' : ''}`,
    r.moved && `${r.moved} déplacé${r.moved > 1 ? 's' : ''}`,
    r.trashed && `${r.trashed} vers la corbeille`,
    r.files &&
      `${r.files} fichier${r.files > 1 ? 's' : ''} de projets copié${r.files > 1 ? 's' : ''}`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(', ')} — vérifiés.` : 'Le disque était déjà à jour.';
}

export function UpdateDialog(props: {
  status: DiskStatusDto;
  onClose: () => void;
  onChanged: () => void;
}) {
  const module = useModule();
  // v0.50.0 (bug G): the task followed from the click — « Démarrage… » until it
  // is seen, then the gauge; never two launches; « introuvable » never read as ended.
  const task = useTaskFollow(props.status.jobId);
  const { job } = task;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eject, setEject] = useState<string | null>(null);
  const [open, setOpen] = useState<Step['kind'] | null>(null);
  const launched = task.phase !== 'idle';
  const running = task.phase === 'starting' || task.phase === 'active';
  const ended = task.phase === 'ended' || task.phase === 'lost';
  const { onChanged } = props;

  useEffect(() => {
    if (launched) return;
    let live = true;
    module.api
      .get<Plan>('/disk/plan')
      .then((p) => live && setPlan(p))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [module.api, launched]);
  useEffect(() => {
    if (ended) onChanged();
  }, [ended, onChanged]);

  const start = () => {
    setError(null);
    task.start(() => module.api.post<{ jobId: string }>('/disk/update'));
  };
  const doEject = async () => {
    setEject('Éjection…');
    try {
      const r = await module.api.post<{ ok: boolean; message: string }>('/disk/eject');
      setEject(r.message);
      onChanged();
    } catch (e) {
      setEject(errorMessage(e));
    }
  };

  const report =
    task.phase === 'ended' && job
      ? ((job.result as UpdateReport | null) ?? props.status.lastUpdate)
      : null;
  const name = props.status.disk?.name ?? 'disque';

  return (
    <div
      className="coffre-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Mettre à jour le disque"
    >
      <div className="coffre-modal__box coffre-update">
        <header className="coffre-update__head">
          <h2>Mettre à jour « {name} »</h2>
          {!running && (
            <button
              type="button"
              className="icon-button"
              aria-label="Fermer"
              onClick={props.onClose}
            >
              <Icon name="close" />
            </button>
          )}
        </header>

        {!launched && plan && (
          <>
            <div className="coffre-update__counters">
              <Counter
                value={plan.counts.copy}
                label="à copier"
                tone={plan.counts.copy ? 'accent' : 'plain'}
              />
              <Counter value={plan.counts.update} label="à mettre à jour" />
              <Counter value={plan.counts.move} label="à déplacer" />
              <Counter value={plan.counts.trash} label="vers la corbeille" />
            </div>
            <p className={plan.enough ? 'muted' : 'coffre-update__refused'}>
              {plan.enough
                ? `Place nécessaire : ${formatBytes(plan.needed)} · libre sur le disque : ${plan.free === null ? 'inconnue' : formatBytes(plan.free)}.`
                : `Pas assez de place sur le disque : il faut ${formatBytes(plan.needed)}, il reste ${formatBytes(plan.free ?? 0)}. Rien ne sera écrit : libère de la place (ou archive moins) d'abord.`}
            </p>
            <div className="coffre-update__plan">
              {(Object.keys(KIND_LABEL) as Step['kind'][]).map((kind) => {
                const list = plan.steps.filter((s) => s.kind === kind);
                if (!list.length) return null;
                return (
                  <section key={kind}>
                    <button
                      type="button"
                      className="coffre-update__group"
                      aria-expanded={open === kind}
                      onClick={() => setOpen(open === kind ? null : kind)}
                    >
                      <Icon name={open === kind ? 'chevron-down' : 'chevron-right'} />
                      {KIND_LABEL[kind]} ({list.length})
                    </button>
                    {open === kind && (
                      <ul>
                        {list.map((s) => (
                          <li key={s.itemId}>
                            <span>{s.name}</span>
                            <span className="muted">
                              {s.kind === 'move' || s.kind === 'trash'
                                ? `${s.from} → ${s.to}`
                                : s.to}
                              {s.files !== undefined ? ` · ${projectText(s)}` : ''}
                              {s.size ? ` · ${formatBytes(s.size)}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
              {!plan.steps.length && <p className="muted">Rien à faire : le disque est à jour.</p>}
            </div>
            {plan.problems.length > 0 && (
              <div className="coffre-update__problems">
                <strong>À voir :</strong>
                <ul>
                  {plan.problems.map((p) => (
                    <li key={p.itemId}>
                      {p.name} — {p.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ExcludedOnDisk />
            <footer className="coffre-update__foot">
              <span className="muted small">
                Chaque copie est relue et comparée avant de prendre sa place. Annulable à tout
                moment.
              </span>
              <Button variant="secondary" onClick={props.onClose}>
                Pas maintenant
              </Button>
              <Button
                disabled={!plan.enough || !plan.steps.length}
                onClick={start}
                data-coffre-update-go
              >
                Mettre à jour
              </Button>
            </footer>
          </>
        )}
        {!launched && !plan && !error && (
          <p className="muted">Calcul du plan (lecture du disque)…</p>
        )}

        <TaskGauge task={task} sub="copié et vérifié" onFail={(e) => setError(errorMessage(e))}>
          <p className="muted small">
            Annuler laisse le disque en ordre : ce qui est déjà copié reste valide, le reste se fera
            à la prochaine mise à jour.
          </p>
        </TaskGauge>
        {ended && (
          <div className="coffre-update__report">
            {job?.status === 'succeeded' && report ? (
              <p className="coffre-update__done">
                <Icon name="circle-check" /> {reportText(report)}
              </p>
            ) : (
              <p className="coffre-update__stopped">
                <Icon name="warning" />{' '}
                {report?.stopped ?? task.error ?? job?.error ?? 'Mise à jour arrêtée.'}
                {report && ` (${reportText(report)})`}
              </p>
            )}
            {report && report.removedVersions > 0 && (
              <p className="muted">
                {plural(report.removedVersions, 'ancienne version', 'anciennes versions')} retirée
                {report.removedVersions > 1 ? 's' : ''} de l'historique (place réservée pleine, les
                plus anciennes d'abord).
              </p>
            )}
            {report && report.oversized.length > 0 && (
              <p className="coffre-update__stopped">
                Plus grosse que toute la place réservée à l'historique (gardée, rien retiré pour
                elle) : {report.oversized.join(', ')}. Augmente la place réservée dans Réglages ›
                Coffre.
              </p>
            )}
            {report && report.problems.length > 0 && (
              <div className="coffre-update__problems">
                <strong>À voir :</strong>
                <ul>
                  {report.problems.map((p) => (
                    <li key={p.itemId}>
                      {p.name} — {p.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {eject && <p className="coffre-update__eject">{eject}</p>}
            <footer className="coffre-update__foot">
              <Button
                variant="secondary"
                onClick={() => void doEject()}
                disabled={eject === 'Éjection…'}
              >
                Éjecter le disque
              </Button>
              <Button onClick={props.onClose}>Fermer</Button>
            </footer>
          </div>
        )}
        {(error ?? (task.phase === 'idle' ? task.error : null)) && (
          <ErrorMessage>{error ?? task.error}</ErrorMessage>
        )}
      </div>
    </div>
  );
}

/**
 * v0.51.0 D4: what projects no longer save but their copy on the disk still
 * holds — proposed with the room it frees; removed (to the disk's history)
 * only by this click, never by an update.
 */
function ExcludedOnDisk() {
  const module = useModule();
  const coffre = useCoffre();
  const list = useApi<
    { itemId: string; name: string; entries: { rel: string; bytes: number }[]; bytes: number }[]
  >(module.url('/disk/excluded'));
  const [busy, setBusy] = useState(false);
  if (!list.data?.length) return null;
  const total = list.data.reduce((s, p) => s + p.bytes, 0);
  const remove = async () => {
    setBusy(true);
    try {
      const r = await runJob<{ removed: number; bytes: number }>(
        module.api.post('/disk/excluded/remove', { itemIds: list.data!.map((p) => p.itemId) }),
      );
      coffre.notify(
        `${r.removed} dossier(s) ou fichier(s) retiré(s) de la copie du disque (${formatBytes(r.bytes)}), gardés dans son historique.`,
      );
      list.reload();
    } catch (e) {
      coffre.fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="coffre-update__problems" data-coffre-excluded-on-disk>
      <strong>Plus sauvegardé, encore sur le disque</strong>{' '}
      <span className="badge badge--warning">Expérimental</span>
      <ul>
        {list.data.map((p) => (
          <li key={p.itemId}>
            {p.name} : {p.entries.map((e) => e.rel).join(', ')} ({formatBytes(p.bytes)})
          </li>
        ))}
      </ul>
      <Button variant="secondary" small disabled={busy} onClick={() => void remove()}>
        Les retirer de la copie du disque ({formatBytes(total)}, vers l’historique)
      </Button>
    </div>
  );
}
