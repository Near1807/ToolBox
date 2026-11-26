// v0.49.0 (Expérimental): the Coffre's tasks, above every page of the Coffre
// (both tabs) — what runs or waits (« 1 234 / 5 000 fichiers », the file in
// progress, the time left, Annuler, their order), and what just ended with
// its report (every failed item and why, « Réessayer ceux-là ») until it is
// dismissed. The reading of the texts (search) shows here too while it runs.
import { useEffect, useMemo, useState } from 'react';
import {
  cancelJob,
  isActiveJob,
  JobCard,
  retryJob,
  useApi,
  useJobs,
  useModule,
  type JobInfo,
} from '@hub/sdk/frontend';
import type { IndexStatusDto } from '../shared/types';

const DISMISSED_KEY = 'toolbox.coffre.tasksDismissed';
/** An ended task stays shown this long (unless dismissed). */
const KEEP_ENDED_MS = 30 * 60_000;

function dismissedAtStart(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function CoffreTasks(props: { onFail: (error: unknown) => void }) {
  const module = useModule();
  const { jobs } = useJobs(module.id);
  const [dismissed, setDismissed] = useState<string[]>(dismissedAtStart);
  const [now, setNow] = useState(() => Date.now());
  // The clock for « ended a while ago » (an ended task leaves the panel after a while).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const shown = useMemo(
    () =>
      jobs
        .filter(
          (j) =>
            !dismissed.includes(j.id) &&
            (isActiveJob(j) ||
              (j.finishedAt !== null &&
                now - Date.parse(j.finishedAt) < KEEP_ENDED_MS &&
                // A plain success with nothing to say leaves at once (the message said it).
                (j.status !== 'succeeded' || (j.details?.errorCount ?? 0) > 0))),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [jobs, dismissed, now],
  );
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-200)));
    } catch {
      // Not kept: shown again after a reload.
    }
  };
  const position = (job: JobInfo) =>
    jobs
      .filter((j) => j.status === 'queued' && j.type === job.type)
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
      .findIndex((j) => j.id === job.id) + 1;

  return (
    <section
      className="coffre-tasks"
      aria-label="Tâches du Coffre"
      aria-live="polite"
      data-coffre-tasks
    >
      {shown.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          position={job.status === 'queued' ? position(job) : undefined}
          onCancel={(id) => void cancelJob(id).catch(props.onFail)}
          onRetry={(j) => {
            dismiss(j.id);
            void retryJob(j.id).catch(props.onFail);
          }}
          onDismiss={dismiss}
        />
      ))}
      <TextReading />
    </section>
  );
}

/** The reading of the texts for the search (a worker, low priority): its progress. */
function TextReading() {
  const module = useModule();
  const status = useApi<IndexStatusDto & { reading: string | null }>(module.url('/search/status'));
  const s = status.data;
  const { reload } = status;
  const running = Boolean(s && s.pending > 0 && s.running);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 2500);
    return () => clearInterval(t);
  }, [running, reload]);
  if (!s || !running) return null;
  return (
    <p className="coffre-tasks__reading small" data-coffre-reading>
      Lecture des textes pour la recherche : {s.done.toLocaleString('fr-FR')} /{' '}
      {s.total.toLocaleString('fr-FR')}
      {s.reading ? ` · ${s.reading}` : ''} — en arrière-plan, priorité basse.
    </p>
  );
}
