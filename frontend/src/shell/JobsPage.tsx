import {
  Button,
  Card,
  EmptyState,
  Page,
  ProgressBar,
  useJobs,
  type JobStatus,
} from '@hub/sdk/frontend';
import { useModules } from '../modules/ModulesContext';
import { formatDateTime } from './format';

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'En attente',
  running: 'En cours',
  succeeded: 'Terminée',
  failed: 'Échec',
  cancelled: 'Annulée',
  interrupted: 'Interrompue',
};

export function JobsPage() {
  const { jobs, cancel } = useJobs();
  const { modules } = useModules();
  const moduleName = (id: string) => modules.find((m) => m.id === id)?.manifest.name ?? id;

  return (
    <Page title="Tâches" subtitle="Rendus et autres traitements longs, tous outils confondus.">
      {jobs.length === 0 && <EmptyState title="Aucune tâche pour l’instant." />}
      {jobs.map((job) => (
        <Card
          key={job.id}
          title={
            <>
              {job.title} <span className="muted">· {moduleName(job.moduleId)}</span>
            </>
          }
          actions={
            (job.status === 'queued' || job.status === 'running') && (
              <Button variant="secondary" small onClick={() => void cancel(job.id)}>
                Annuler
              </Button>
            )
          }
        >
          <div className="job-row__meta">
            <span className={`badge badge--${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>
            <span className="muted">{formatDateTime(job.createdAt)}</span>
            {job.message && <span>{job.message}</span>}
          </div>
          {job.status === 'running' && <ProgressBar value={job.progress} />}
          {job.error && <p className="error">{job.error}</p>}
        </Card>
      ))}
    </Page>
  );
}
