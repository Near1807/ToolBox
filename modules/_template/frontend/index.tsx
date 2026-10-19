// Frontend of the template module: pages, sidebar entry, home widget.
// Only @hub/sdk/frontend (and React) may be imported from the hub.
import { useState } from 'react';
import {
  Button,
  Card,
  defineFrontendModule,
  EmptyState,
  ErrorMessage,
  errorMessage,
  Page,
  ProgressBar,
  useApi,
  useJobs,
  useModule,
  type JobInfo,
} from '@hub/sdk/frontend';

interface Note {
  id: number;
  text: string;
  created_at: string;
}

interface Summary {
  count: number;
  greeting: string | null;
}

function NotesPage() {
  const module = useModule();
  const summary = useApi<Summary>(module.url('/summary'));
  const notes = useApi<Note[]>(module.url('/notes'));
  const { jobs, cancel } = useJobs(module.id);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    notes.reload();
    summary.reload();
  };

  const addNote = async () => {
    try {
      await module.api.post('/notes', { text });
      setText('');
      setError(null);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeNote = async (id: number) => {
    await module.api.delete(`/notes/${id}`);
    refresh();
  };

  return (
    <Page title={module.manifest.name} subtitle={summary.data?.greeting ?? undefined}>
      <Card title="Notes">
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void addNote();
          }}
        >
          <input
            className="input"
            value={text}
            placeholder="Nouvelle note…"
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit">Ajouter</Button>
        </form>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {notes.data?.length === 0 && <EmptyState title="Aucune note pour l’instant." />}
        <ul className="list">
          {notes.data?.map((note) => (
            <li key={note.id} className="list__item">
              <span>{note.text}</span>
              <Button variant="secondary" small onClick={() => void removeNote(note.id)}>
                Supprimer
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Tâche de démonstration"
        actions={<Button onClick={() => void module.api.post('/demo-job')}>Lancer</Button>}
      >
        {jobs.length === 0 && <p className="muted">Aucune tâche lancée.</p>}
        {jobs.slice(0, 5).map((job: JobInfo) => (
          <div key={job.id} className="job-row">
            <div className="job-row__title">
              {job.title} <span className="muted">— {job.message ?? job.status}</span>
            </div>
            <ProgressBar
              value={job.status === 'running' ? job.progress : job.status === 'succeeded' ? 1 : 0}
            />
            {(job.status === 'running' || job.status === 'queued') && (
              <Button variant="secondary" small onClick={() => void cancel(job.id)}>
                Annuler
              </Button>
            )}
          </div>
        ))}
      </Card>
    </Page>
  );
}

function HomeWidget() {
  const module = useModule();
  const summary = useApi<Summary>(module.url('/summary'));
  if (!summary.data) return null;
  return <span className="muted">{summary.data.count} note(s)</span>;
}

export default defineFrontendModule({
  pages: [{ path: '', component: NotesPage }],
  nav: { label: 'Modèle' },
  HomeWidget,
});
