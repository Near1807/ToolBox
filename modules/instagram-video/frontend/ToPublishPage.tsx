import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  Card,
  confirmDelete,
  EmptyState,
  ErrorMessage,
  errorMessage,
  outputs,
  Page,
  useApi,
  useJobs,
  useModule,
} from '@hub/sdk/frontend';
import { CopyButton, ItemTile } from './ItemTile';
import type { PackItem } from './types';

interface Entry {
  track: { id: number; title: string; artist: string };
  item: PackItem;
}

/** Every generated file not yet published, across all tracks. */
export function ToPublishPage() {
  const module = useModule();
  const list = useApi<Entry[]>(module.url('/to-publish'));
  const { jobs } = useJobs(module.id);
  const [error, setError] = useState<string | null>(null);
  const seenJobs = useRef(new Set<string>());

  const { reload } = list;
  useEffect(() => {
    for (const job of jobs) {
      if (job.status === 'succeeded' && !seenJobs.current.has(job.id)) {
        seenJobs.current.add(job.id);
        reload();
      }
    }
  }, [jobs, reload]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const groups = new Map<number, { track: Entry['track']; items: PackItem[] }>();
  for (const entry of list.data ?? []) {
    const group = groups.get(entry.track.id) ?? { track: entry.track, items: [] };
    group.items.push(entry.item);
    groups.set(entry.track.id, group);
  }

  return (
    <Page
      title="À publier"
      subtitle="Les posts et Reels générés qui ne sont pas encore cochés « Publié »."
      actions={
        <Link className="button button--secondary" to={module.path()}>
          Retour aux packs
        </Link>
      }
    >
      {list.error && <ErrorMessage>{list.error}</ErrorMessage>}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {list.data?.length === 0 && (
        <EmptyState title="Rien à publier.">
          Tout est publié, ou aucun pack n’a encore été généré.
        </EmptyState>
      )}
      {[...groups.values()].map(({ track, items }) => (
        <Card
          key={track.id}
          title={
            <Link to={`${module.path()}?track=${track.id}`}>
              {track.artist ? `${track.artist} — ${track.title}` : track.title}
            </Link>
          }
        >
          <div className="iv-tiles">
            {items.map((item) => (
              <div key={item.id} className="iv-publish">
                <ItemTile
                  item={item}
                  job={jobs.find((job) => job.id === item.jobId) ?? null}
                  onAction={(action) =>
                    void run(() => module.api.post(`/items/${item.id}/${action}`))
                  }
                  onPublish={(fields) =>
                    void run(() => module.api.patch(`/items/${item.id}`, fields))
                  }
                  onDelete={() => {
                    if (item.outputId !== null && confirmDelete(`« ${item.fileName} »`)) {
                      void run(() => outputs.delete([item.outputId!]));
                    }
                  }}
                />
                <CopyButton text={item.caption} label="Copier la légende" />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </Page>
  );
}
