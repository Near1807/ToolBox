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
  Gauge,
  Icon,
  useJobs,
  useModule,
} from '@hub/sdk/frontend';
import type { DiskStatusDto, UpdateReport } from '../../shared/types';
import { plural } from './useDisk';

interface Step {
  kind: 'copy' | 'update' | 'move' | 'trash' | 'repair';
  itemId: string;
  name: string;
  from: string | null;
  to: string;
  size: number;
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

export function reportText(r: UpdateReport): string {
  const parts = [
    r.copied && `${r.copied} copié${r.copied > 1 ? 's' : ''}`,
    r.updated && `${r.updated} mis à jour`,
    r.repaired && `${r.repaired} recopié${r.repaired > 1 ? 's' : ''}`,
    r.moved && `${r.moved} déplacé${r.moved > 1 ? 's' : ''}`,
    r.trashed && `${r.trashed} vers la corbeille`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(', ')} — vérifiés.` : 'Le disque était déjà à jour.';
}

export function UpdateDialog(props: {
  status: DiskStatusDto;
  onClose: () => void;
  onChanged: () => void;
}) {
  const module = useModule();
  const { jobs, cancel } = useJobs(module.id);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(props.status.jobId);
  const [eject, setEject] = useState<string | null>(null);
  const [open, setOpen] = useState<Step['kind'] | null>(null);
  const job = jobs.find((j) => j.id === jobId) ?? null;
  const running = job && (job.status === 'queued' || job.status === 'running');
  const { onChanged } = props;

  useEffect(() => {
    if (jobId) return;
    let live = true;
    module.api
      .get<Plan>('/disk/plan')
      .then((p) => live && setPlan(p))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [module.api, jobId]);
  useEffect(() => {
    if (job && !running) onChanged();
  }, [job, running, onChanged]);

  const start = async () => {
    setError(null);
    try {
      setJobId((await module.api.post<{ jobId: string }>('/disk/update')).jobId);
    } catch (e) {
      setError(errorMessage(e));
    }
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
    job && !running ? ((job.result as UpdateReport | null) ?? props.status.lastUpdate) : null;
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

        {!jobId && plan && (
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
            <footer className="coffre-update__foot">
              <span className="muted small">
                Chaque copie est relue et comparée avant de prendre sa place. Annulable à tout
                moment.
              </span>
              <Button variant="secondary" onClick={props.onClose}>
                Pas maintenant
              </Button>
              <Button disabled={!plan.enough || !plan.steps.length} onClick={() => void start()}>
                Mettre à jour
              </Button>
            </footer>
          </>
        )}
        {!jobId && !plan && !error && <p className="muted">Calcul du plan (lecture du disque)…</p>}

        {jobId && running && job && (
          <div className="coffre-update__progress">
            <Gauge
              value={job.progress ?? 0}
              label={job.progress === null ? '…' : `${Math.round((job.progress ?? 0) * 100)} %`}
              sub="copié et vérifié"
              size={140}
            />
            <div>
              <p className="coffre-update__message">{job.message ?? 'Démarrage…'}</p>
              <p className="muted small">
                Annuler laisse le disque en ordre : ce qui est déjà copié reste valide, le reste se
                fera à la prochaine mise à jour.
              </p>
              <Button variant="secondary" onClick={() => void cancel(job.id)}>
                Annuler
              </Button>
            </div>
          </div>
        )}

        {jobId && !running && (
          <div className="coffre-update__report">
            {job?.status === 'succeeded' && report ? (
              <p className="coffre-update__done">
                <Icon name="circle-check" /> {reportText(report)}
              </p>
            ) : (
              <p className="coffre-update__stopped">
                <Icon name="warning" /> {report?.stopped ?? job?.error ?? 'Mise à jour arrêtée.'}
                {report && ` (${reportText(report)})`}
              </p>
            )}
            {report && report.removedVersions > 0 && (
              <p className="muted">
                {plural(report.removedVersions, 'ancienne version')} retirée
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
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </div>
    </div>
  );
}
