import { EmptyState, JobCard, Page, retryJob, useJobs, type JobInfo } from '@hub/sdk/frontend';
import { useModules } from '../modules/ModulesContext';

export function JobsPage() {
  const { jobs, cancel } = useJobs();
  const { modules } = useModules();
  const moduleName = (id: string) => modules.find((m) => m.id === id)?.manifest.name ?? id;
  // v0.49.0: the place of a waiting task among those of its type (they run in order).
  const position = (job: JobInfo) =>
    jobs
      .filter((j) => j.status === 'queued' && j.moduleId === job.moduleId && j.type === job.type)
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
      .findIndex((j) => j.id === job.id) + 1;

  return (
    <Page
      title="Tâches"
      subtitle="Rendus, copies, imports et autres traitements longs, tous outils confondus."
    >
      {jobs.length === 0 && <EmptyState title="Aucune tâche pour l’instant." />}
      <div className="ui-jobs">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            source={moduleName(job.moduleId)}
            position={job.status === 'queued' ? position(job) : undefined}
            onCancel={(id) => void cancel(id)}
            onRetry={(j) => void retryJob(j.id).catch(() => undefined)}
          />
        ))}
      </div>
    </Page>
  );
}
