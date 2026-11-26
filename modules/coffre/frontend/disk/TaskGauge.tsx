// v0.50.0: the progress of a disk task in its dialog (update, verification,
// restoration) — « Démarrage… » from the click until the task is seen, then
// its gauge, its message and « Annuler » (useTaskFollow of the SDK).
import type { ReactNode } from 'react';
import { Button, cancelJob, Gauge, type TaskFollow } from '@hub/sdk/frontend';

export function TaskGauge(props: {
  task: TaskFollow;
  /** Under the gauge: « copié et vérifié », « relu »… */
  sub: string;
  children?: ReactNode;
  onFail: (error: unknown) => void;
}) {
  const { job, phase } = props.task;
  if (phase !== 'starting' && phase !== 'active') return null;
  const progress = job?.progress ?? null;
  return (
    <div className="coffre-update__progress" role="status" data-coffre-task-gauge={phase}>
      <Gauge
        value={progress ?? 0}
        label={progress === null ? '…' : `${Math.round(progress * 100)} %`}
        sub={props.sub}
        size={140}
      />
      <div>
        <p className="coffre-update__message">
          {phase === 'starting' || !job
            ? 'Démarrage…'
            : job.status === 'queued'
              ? 'En attente (une autre tâche du Coffre passe d’abord)…'
              : (job.message ?? 'En cours…')}
        </p>
        {props.children}
        {job && (
          <Button variant="secondary" onClick={() => void cancelJob(job.id).catch(props.onFail)}>
            Annuler
          </Button>
        )}
      </div>
    </div>
  );
}
