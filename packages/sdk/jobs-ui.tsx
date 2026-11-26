// v0.49.0 (MODULES.md §5.6 bis): background tasks in the interface, for every
// module — a task card (what it does, « 1 234 / 5 000 fichiers », the item in
// progress, the time left, Annuler; at the end the report with EVERY failed
// item and its reason, « Réessayer ceux-là »), and waitForJob() for a page
// that started a task and wants its result without ever holding a request.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, Button, subscribeJobs, ProgressBar, type JobInfo, type JobStatus } from './frontend';
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

/** v0.50.0: said by a page that just started a task — every useJobs() reads the list again at once. */
export const JOBS_CHANGED_EVENT = 'toolbox:jobs-changed';

/** The task list changed (a task started here): the panels read it again now, not at the next event. */
export function announceJobs(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
}

/** How long a task may stay unseen after its start before it is « introuvable » (never « terminée »). */
const MISSING_AFTER_MS = 5000;

/**
 * Waits for a task to end, through the hub's event stream (and reads of the
 * list: it may be over already). Resolves with the task as it ended
 * (succeeded, failed, cancelled, interrupted): never throws for its outcome.
 * A task that cannot be found (neither in the list nor in the stream for 5 s)
 * REJECTS with « Tâche introuvable » — never read as ended.
 */
export function waitForJob(id: string, onUpdate?: (job: JobInfo) => void): Promise<JobInfo> {
  return new Promise((resolve, reject) => {
    let done = false;
    let found = false;
    let close: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      done = true;
      close();
      if (timer) clearTimeout(timer);
    };
    const seen = (job: JobInfo) => {
      if (done || job.id !== id) return;
      found = true;
      onUpdate?.(job);
      if (isActiveJob(job)) return;
      finish();
      resolve(job);
    };
    close = subscribeJobs(seen);
    const started = Date.now();
    const read = () => {
      if (done || found) return;
      void api
        .get<JobInfo[]>('/api/core/jobs')
        .then((list) => {
          const job = list.find((j) => j.id === id);
          if (job) seen(job);
          else if (!found && !done) {
            if (Date.now() - started >= MISSING_AFTER_MS) {
              finish();
              reject(new Error('Tâche introuvable : elle n’a pas démarré ou a été retirée.'));
            } else timer = setTimeout(read, 1000);
          }
        })
        .catch(() => {
          if (!done && !found) timer = setTimeout(read, 1000);
        });
    };
    read();
  });
}

/**
 * Starts a task (a route answering { jobId }) and waits for its end: its
 * result; a failure throws its message, a cancellation « Annulée », a task not
 * found « Tâche introuvable ». The task lists are told at once (announceJobs).
 */
export async function runJob<T>(
  start: Promise<{ jobId: string }>,
  onUpdate?: (job: JobInfo) => void,
): Promise<T> {
  const { jobId } = await start;
  announceJobs();
  const job = await waitForJob(jobId, onUpdate);
  if (job.status === 'succeeded') return job.result as T;
  throw new Error(
    job.status === 'cancelled'
      ? 'Annulée'
      : (job.error ?? job.message ?? 'La tâche n’a pas abouti'),
  );
}

export interface TaskFollow {
  /**
   * idle: nothing started; starting: asked, the task not seen yet (« Démarrage… »);
   * active: queued or running (the gauge); ended: its final state in `job`;
   * lost: started but not found (`error`), never read as ended.
   */
  phase: 'idle' | 'starting' | 'active' | 'ended' | 'lost';
  job: JobInfo | null;
  /** Why it could not start (the route's message), or why it is lost. */
  error: string | null;
  /** Starts it — ignored while one is starting or running (never two launches). */
  start: (launch: () => Promise<{ jobId: string }>) => void;
  /** Follows a task already running (a dialog reopened during it). */
  follow: (jobId: string) => void;
}

/**
 * v0.50.0: a dialog that starts ONE task and shows it: « Démarrage… » from
 * the click, then its gauge, then its end. The button cannot launch it twice
 * (a click during the start or the run is ignored), the task lists are told
 * at once, and a task that cannot be found is « introuvable », never « terminée ».
 */
export function useTaskFollow(initialJobId?: string | null): TaskFollow {
  const [state, setState] = useState<Pick<TaskFollow, 'phase' | 'job' | 'error'>>({
    phase: initialJobId ? 'starting' : 'idle',
    job: null,
    error: null,
  });
  const busy = useRef(Boolean(initialJobId));
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const follow = useCallback((jobId: string) => {
    busy.current = true;
    setState({ phase: 'starting', job: null, error: null });
    waitForJob(jobId, (job) => {
      if (live.current)
        setState({ phase: isActiveJob(job) ? 'active' : 'ended', job, error: null });
    })
      .then((job) => {
        busy.current = false;
        if (live.current) setState({ phase: 'ended', job, error: null });
      })
      .catch((e: unknown) => {
        busy.current = false;
        if (live.current)
          setState({ phase: 'lost', job: null, error: e instanceof Error ? e.message : String(e) });
      });
  }, []);
  const start = useCallback(
    (launch: () => Promise<{ jobId: string }>) => {
      if (busy.current) return;
      busy.current = true;
      setState({ phase: 'starting', job: null, error: null });
      launch()
        .then(({ jobId }) => {
          announceJobs();
          follow(jobId);
        })
        .catch((e: unknown) => {
          busy.current = false;
          if (live.current)
            setState({
              phase: 'idle',
              job: null,
              error: e instanceof Error ? e.message : String(e),
            });
        });
    },
    [follow],
  );
  const initial = useRef(initialJobId);
  useEffect(() => {
    if (initial.current) follow(initial.current);
  }, [follow]);
  return { ...state, start, follow };
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
