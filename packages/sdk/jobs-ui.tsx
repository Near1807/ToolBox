// v0.49.0 (MODULES.md §5.6 bis): background tasks in the interface, for every
// module — a task card (what it does, « 1 234 / 5 000 fichiers », the item in
// progress, the time left, Annuler; at the end the report with EVERY failed
// item and its reason, « Réessayer ceux-là »), and waitForJob() for a page
// that started a task and wants its result without ever holding a request.
import { useState } from 'react';
import {
  api,
  Button,
  openEventStream,
  ProgressBar,
  type JobInfo,
  type JobStatus,
} from './frontend';
import { Icon } from './icons';

export const JOB_STATUS_TEXT: Record<JobStatus, string> = {
  queued: 'En attente',
  running: 'En cours',
  succeeded: 'Terminée',
  failed: 'Échec',
  cancelled: 'Annulée',
  interrupted: 'Interrompue',
};

/** « 3 min 20 s », « 45 s », « 1 h 05 ». */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 ? ` ${String(s % 60).padStart(2, '0')} s` : ''}`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** « 1 234 / 5 000 fichiers » (the numbers in French). */
export function jobCountText(job: JobInfo): string | null {
  const d = job.details;
  if (!d || d.done === null) return null;
  const n = (x: number) => x.toLocaleString('fr-FR');
  return `${n(d.done)}${d.total !== null ? ` / ${n(d.total)}` : ''}${d.unit ? ` ${d.unit}` : ''}`;
}

export const isActiveJob = (job: JobInfo) => job.status === 'queued' || job.status === 'running';

/**
 * Waits for a task to end, through the hub's event stream (and one read at
 * the start: it may be over already). Resolves with the task as it ended
 * (succeeded, failed, cancelled, interrupted): never throws for its outcome.
 */
export function waitForJob(id: string, onUpdate?: (job: JobInfo) => void): Promise<JobInfo> {
  return new Promise((resolve) => {
    let done = false;
    let close: () => void = () => {};
    const seen = (job: JobInfo) => {
      if (done || job.id !== id) return;
      onUpdate?.(job);
      if (isActiveJob(job)) return;
      done = true;
      close();
      resolve(job);
    };
    close = openEventStream('/api/core/jobs/stream', { job: (data) => seen(data as JobInfo) });
    void api
      .get<JobInfo[]>('/api/core/jobs')
      .then((list) => {
        const job = list.find((j) => j.id === id);
        if (job) seen(job);
      })
      .catch(() => undefined);
  });
}

/**
 * One task: its title, state, « fait / total », the item in progress, the
 * time left, Annuler; ended: the report (« 4 998 faits, 2 erreurs ») with
 * the reason of every failed item and « Réessayer ceux-là ».
 */
export function JobCard(props: {
  job: JobInfo;
  /** Its place in the queue (« en attente, 2e »), when it waits for others. */
  position?: number;
  onCancel?: (id: string) => void;
  onRetry?: (job: JobInfo) => void;
  onDismiss?: (id: string) => void;
  /** The module's name (on the hub's Tâches page). */
  source?: string;
}) {
  const { job } = props;
  const d = job.details;
  const [open, setOpen] = useState(false);
  const active = isActiveJob(job);
  const count = jobCountText(job);
  const errors = d?.errorCount ?? 0;
  const tone =
    job.status === 'failed' || (errors > 0 && !active)
      ? 'warn'
      : job.status === 'succeeded'
        ? 'ok'
        : job.status === 'cancelled' || job.status === 'interrupted'
          ? 'off'
          : 'on';
  return (
    <article className={`ui-job ui-job--${tone}`} data-job={job.id} data-job-status={job.status}>
      <header className="ui-job__head">
        <strong className="ui-job__title">{job.title}</strong>
        {props.source && <span className="muted small">{props.source}</span>}
        <span className={`badge badge--${job.status}`}>
          {JOB_STATUS_TEXT[job.status]}
          {job.status === 'queued' && props.position ? ` (${props.position}e)` : ''}
        </span>
        <span className="ui-job__actions">
          {active && props.onCancel && (
            <Button variant="secondary" small onClick={() => props.onCancel?.(job.id)}>
              Annuler
            </Button>
          )}
          {!active && props.onDismiss && (
            <button
              type="button"
              className="icon-button"
              aria-label="Retirer de la liste"
              title="Retirer de la liste"
              onClick={() => props.onDismiss?.(job.id)}
            >
              <Icon name="close" />
            </button>
          )}
        </span>
      </header>
      {job.status === 'running' && (
        <ProgressBar value={d?.total ? (d.done ?? 0) / d.total : job.progress} />
      )}
      <p className="ui-job__line small">
        {count && <span>{count}</span>}
        {active && d?.current && (
          <span className="ui-job__current" title={d.current}>
            {d.current}
          </span>
        )}
        {job.status === 'running' && d?.etaSeconds !== null && d?.etaSeconds !== undefined && (
          <span>reste environ {formatDuration(d.etaSeconds)}</span>
        )}
        {d?.resumed && <span>repris après la fermeture de ToolBox</span>}
        {job.message && !active && <span>{job.message}</span>}
        {active && job.message && !count && <span>{job.message}</span>}
      </p>
      {job.error && <p className="error small">{job.error}</p>}
      {errors > 0 && (
        <div className="ui-job__errors">
          <button
            type="button"
            className="ui-job__toggle"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? 'chevron-down' : 'chevron-right'} />
            {errors} erreur{errors > 1 ? 's' : ''} : {open ? 'masquer' : 'voir pourquoi'}
          </button>
          {open && (
            <ul className="ui-job__list small">
              {d!.errors.map((e, i) => (
                <li key={i}>
                  <span className="ui-job__item" title={e.item}>
                    {e.item}
                  </span>{' '}
                  — {e.reason}
                </li>
              ))}
              {d!.errorCount > d!.errors.length && (
                <li className="muted">… et {d!.errorCount - d!.errors.length} autre(s)</li>
              )}
            </ul>
          )}
          {!active && d?.retryable && props.onRetry && (
            <Button small onClick={() => props.onRetry?.(job)}>
              Réessayer ceux-là
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

/** « Réessayer ceux-là »: the new task (or an error message). */
export const retryJob = (id: string) => api.post<JobInfo>(`/api/core/jobs/${id}/retry`);
export const cancelJob = (id: string) => api.post(`/api/core/jobs/${id}/cancel`);
