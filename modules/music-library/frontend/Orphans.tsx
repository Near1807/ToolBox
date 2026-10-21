import { useState } from 'react';
import {
  Button,
  Card,
  confirmDelete,
  ErrorMessage,
  errorMessage,
  MediaThumb,
  outputs,
  OutputCard,
  SelectionBar,
  StateBadge,
  useApi,
  useModule,
  useSelection,
  type OutputRecord,
} from '@hub/sdk/frontend';
import type { TrackDto } from '../contract';

/**
 * « Sans projet »: generated elements whose track is unknown (made by an old
 * version) or deleted. Each one can be attached to a track, or deleted.
 */
export function Orphans(props: { tracks: TrackDto[] }) {
  const module = useModule();
  const orphans = useApi<OutputRecord[]>(module.url('/orphans'));
  const selection = useSelection<number>();
  const [trackId, setTrackId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  if (!orphans.data || orphans.data.length === 0) return null;
  const list = orphans.data;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      selection.clear();
      orphans.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const attach = (ids: number[]) =>
    run(() => module.api.post('/orphans/attach', { ids, trackId: Number(trackId) }));

  return (
    <Card title={`Sans projet (${list.length})`}>
      <div className="ml-orphans">
        <p className="muted small">
          Ces fichiers générés ne sont rattachés à aucun morceau (morceau supprimé, ou fichier d’une
          ancienne version). Rattache-les à un morceau pour les retrouver dans son projet, ou
          supprime-les.
        </p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="inline-form">
          <select
            className="input"
            aria-label="Morceau auquel rattacher"
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
          >
            <option value="">Choisir un morceau…</option>
            {props.tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.title}
                {track.artist ? ` — ${track.artist}` : ''}
              </option>
            ))}
          </select>
          <Button
            small
            disabled={!trackId || selection.selected.size === 0}
            onClick={() => void attach([...selection.selected])}
          >
            Rattacher la sélection ({selection.selected.size})
          </Button>
        </div>
        <SelectionBar
          total={list.length}
          count={selection.selected.size}
          onSelectAll={() => selection.setAll(list.map((o) => o.id))}
          onClear={selection.clear}
          onDelete={() => {
            if (confirmDelete(`les ${selection.selected.size} fichiers sélectionnés`)) {
              void run(() => outputs.delete([...selection.selected]));
            }
          }}
        />
        <div className="ui-cards">
          {list.map((record) => (
            <OutputCard
              key={record.id}
              title={record.label}
              selected={selection.has(record.id)}
              badge={
                record.exists ? (
                  <StateBadge tone="warning">Sans projet</StateBadge>
                ) : (
                  <StateBadge tone="warning">Introuvable</StateBadge>
                )
              }
              thumb={
                <MediaThumb
                  src={record.url}
                  media={/\.(mp4|mov|webm)$/i.test(record.fileName) ? 'video' : 'image'}
                  dragUrl={record.url}
                  placeholder={record.fileName}
                  selected={selection.has(record.id)}
                  onSelect={() => selection.toggle(record.id)}
                  selectLabel={`Sélectionner ${record.fileName}`}
                />
              }
              meta={record.fileName}
              actions={
                <div className="ui-actions">
                  <Button
                    variant="secondary"
                    small
                    disabled={!trackId}
                    title={trackId ? undefined : 'Choisis d’abord un morceau ci-dessus'}
                    onClick={() => void attach([record.id])}
                  >
                    Rattacher
                  </Button>
                  <Button
                    variant="danger"
                    small
                    onClick={() => {
                      if (confirmDelete(`« ${record.fileName} »`)) {
                        void run(() => outputs.delete([record.id]));
                      }
                    }}
                  >
                    Supprimer
                  </Button>
                </div>
              }
            />
          ))}
        </div>
      </div>
    </Card>
  );
}
