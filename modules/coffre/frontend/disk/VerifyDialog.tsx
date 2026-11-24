// v0.46.0 H: « Vérifier le disque » — long, cancellable; then the report:
// files damaged or missing. Nothing is corrected alone: « Recopier depuis le
// PC » (when the PC has that very version) marks them, and the next update
// copies them again; otherwise it is said.
import { useEffect, useState } from 'react';
import {
  Button,
  ErrorMessage,
  errorMessage,
  Gauge,
  Icon,
  useJobs,
  useModule,
} from '@hub/sdk/frontend';
import { plural } from './useDisk';

interface Problem {
  itemId: string;
  name: string;
  where: 'actuel' | 'historique' | 'corbeille';
  path: string;
  problem: 'abîmé' | 'manquant';
  canRecopy: boolean;
}
interface Report {
  checked: number;
  problems: Problem[];
  stopped: string | null;
}

export function VerifyDialog(props: {
  onClose: () => void;
  onChanged: () => void;
  onUpdate: () => void;
}) {
  const module = useModule();
  const { jobs, cancel } = useJobs(module.id);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marked, setMarked] = useState(0);
  const job = jobs.find((j) => j.id === jobId) ?? null;
  const running = !job || job.status === 'queued' || job.status === 'running';

  useEffect(() => {
    module.api
      .post<{ jobId: string }>('/disk/verify')
      .then((r) => setJobId(r.jobId))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [module.api]);

  const report = job && !running ? (job.result as Report | null) : null;
  const recopy = (report?.problems ?? []).filter((p) => p.canRecopy);
  const repair = async () => {
    try {
      const r = await module.api.post<{ marked: number }>('/disk/repair', {
        itemIds: recopy.map((p) => p.itemId),
      });
      setMarked(r.marked);
      props.onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="coffre-modal" role="dialog" aria-modal="true" aria-label="Vérifier le disque">
      <div className="coffre-modal__box coffre-update">
        <header className="coffre-update__head">
          <h2>Vérifier le disque</h2>
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
        {running && (
          <div className="coffre-update__progress">
            <Gauge
              value={job?.progress ?? 0}
              label={`${Math.round((job?.progress ?? 0) * 100)} %`}
              sub="relu"
              size={140}
            />
            <div>
              <p className="coffre-update__message">{job?.message ?? 'Démarrage…'}</p>
              <p className="muted small">
                Chaque fichier du disque est relu et son empreinte comparée. Rien n'est modifié.
              </p>
              {job && (
                <Button variant="secondary" onClick={() => void cancel(job.id)}>
                  Annuler
                </Button>
              )}
            </div>
          </div>
        )}
        {report && (
          <>
            {report.problems.length === 0 ? (
              <p className="coffre-update__done">
                <Icon name="circle-check" /> {plural(report.checked, 'fichier')} relu
                {report.checked > 1 ? 's' : ''} : aucun problème.
              </p>
            ) : (
              <>
                <p className="coffre-update__stopped">
                  <Icon name="warning" /> {plural(report.problems.length, 'problème')} sur{' '}
                  {plural(report.checked, 'fichier')} relu{report.checked > 1 ? 's' : ''}. Rien n'a
                  été corrigé.
                </p>
                <div className="coffre-update__problems">
                  <ul>
                    {report.problems.map((p) => (
                      <li key={`${p.itemId}${p.path}`}>
                        <strong>{p.name}</strong> ({p.where}) : {p.problem}
                        {p.canRecopy
                          ? ' — la version du PC est la même : elle peut être recopiée.'
                          : p.where === 'actuel'
                            ? ' — le PC n’a pas cette version : à garder en tête.'
                            : ' — une ancienne version : elle ne peut pas être recopiée.'}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            {report.stopped && <p className="muted">{report.stopped}</p>}
            {marked > 0 && (
              <p>
                {plural(marked, 'élément')} sera recopié à la prochaine mise à jour (le fichier
                abîmé est mis de côté dans « _ToolBox/Abimes »).
              </p>
            )}
            <footer className="coffre-update__foot">
              {recopy.length > 0 && !marked && (
                <Button onClick={() => void repair()}>
                  Recopier depuis le PC ({recopy.length})
                </Button>
              )}
              {marked > 0 && <Button onClick={props.onUpdate}>Mettre à jour maintenant</Button>}
              <Button variant="secondary" onClick={props.onClose}>
                Fermer
              </Button>
            </footer>
          </>
        )}
        {job?.status === 'failed' && <ErrorMessage>{job.error}</ErrorMessage>}
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </div>
    </div>
  );
}
