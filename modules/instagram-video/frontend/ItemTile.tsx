import { useState, type DragEvent } from 'react';
import {
  Button,
  copyText,
  formatDuration,
  ProgressBar,
  startFileDrag,
  type JobInfo,
} from '@hub/sdk/frontend';
import { STATE_LABELS, type PackItem } from './types';

const STATE_BADGES: Record<PackItem['state'], string> = {
  draft: '',
  rendering: 'badge--running',
  ready: 'badge--succeeded',
  outdated: 'badge--warning',
  failed: 'badge--failed',
  missing: 'badge--warning',
};

/** "2026-10-19T…" → "2026-10-19" for <input type="date">. */
function dateValue(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * One file of the pack (post or Reel): preview to drag out of the app,
 * state, publication checkbox and date, actions.
 */
export function ItemTile(props: {
  item: PackItem;
  job: JobInfo | null;
  onAction: (action: 'open' | 'reveal' | 'render') => void;
  onPublish: (fields: { published?: boolean; publishedAt?: string }) => void;
  onCancel?: (jobId: string) => void;
}) {
  const { item, job } = props;
  const rendering = item.state === 'rendering';
  const draggable = Boolean(item.url);

  const dragStart = (event: DragEvent) => {
    if (item.url && startFileDrag(item.url)) event.preventDefault();
  };

  return (
    <div className={`iv-tile${item.publishedAt ? ' iv-tile--published' : ''}`}>
      <div
        className={`iv-tile__preview iv-tile__preview--${item.kind}`}
        draggable={draggable}
        onDragStart={dragStart}
        title={draggable ? 'Glisse ce fichier vers Instagram, l’Explorateur…' : undefined}
      >
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt="" draggable={false} />
        ) : (
          <span className="muted small">{item.kind === 'post' ? 'Image 4:5' : 'Reel 9:16'}</span>
        )}
        {draggable && <span className="iv-tile__drag">⇱ glisser</span>}
      </div>
      <div className="iv-tile__body">
        <div className="iv-tile__title">
          <strong>{item.label}</strong>
          <span className={`badge ${STATE_BADGES[item.state]}`}>{STATE_LABELS[item.state]}</span>
        </div>
        {item.kind === 'reel' && item.startSec !== null && (
          <span className="muted small">
            {formatDuration(item.startSec)} →{' '}
            {formatDuration(item.startSec + (item.durationSec ?? 0))}
          </span>
        )}
        {rendering && job && (
          <div className="iv-tile__progress">
            <ProgressBar value={job.status === 'running' ? job.progress : null} />
            {props.onCancel && (
              <Button variant="secondary" small onClick={() => props.onCancel!(job.id)}>
                Annuler
              </Button>
            )}
          </div>
        )}
        {item.error && !rendering && <span className="error small">{item.error}</span>}
        <label className="iv-tile__published">
          <input
            type="checkbox"
            checked={Boolean(item.publishedAt)}
            onChange={(e) => props.onPublish({ published: e.target.checked })}
          />
          Publié
          {item.publishedAt && (
            <input
              type="date"
              className="input iv-tile__date"
              value={dateValue(item.publishedAt)}
              onChange={(e) => e.target.value && props.onPublish({ publishedAt: e.target.value })}
            />
          )}
        </label>
        <div className="iv-tile__actions">
          {item.url && (
            <Button variant="secondary" small onClick={() => props.onAction('open')}>
              {item.kind === 'post' ? 'Voir' : 'Lire'}
            </Button>
          )}
          {item.url && (
            <Button variant="secondary" small onClick={() => props.onAction('reveal')}>
              Dossier
            </Button>
          )}
          {item.state !== 'draft' && (
            <Button
              variant="secondary"
              small
              disabled={rendering}
              onClick={() => props.onAction('render')}
            >
              Régénérer
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** « Copier » button that confirms for a moment. */
export function CopyButton(props: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      small
      onClick={() =>
        void copyText(props.text).then((ok) => {
          setCopied(ok);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? 'Copié ✓' : (props.label ?? 'Copier')}
    </Button>
  );
}
