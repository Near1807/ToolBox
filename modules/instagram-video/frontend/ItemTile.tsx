import { useState, type DragEvent } from 'react';
import {
  Button,
  copyText,
  formatDuration,
  MissingFile,
  ProgressBar,
  startFileDrag,
  type JobInfo,
} from '@hub/sdk/frontend';
import { STATE_LABELS, STYLE_NAMES, STYLES, type PackItem, type ReelStyle } from './types';

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
  /** Style and hook phrase of a Reel (pack page only). */
  onUpdate?: (fields: { style?: ReelStyle; hookText?: string }) => void;
  /** Multiple selection (checkbox on the preview). */
  selected?: boolean;
  onSelect?: () => void;
  /** File to the Recycle Bin (after confirmation by the caller). */
  onDelete?: () => void;
  /** « Retirer de la liste » when the file is missing. */
  onForget?: () => void;
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
        {props.onSelect && item.outputId !== null && (
          <input
            type="checkbox"
            className="iv-tile__select"
            aria-label={`Sélectionner ${item.label}`}
            checked={Boolean(props.selected)}
            onChange={props.onSelect}
          />
        )}
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
        {item.kind === 'reel' && props.onUpdate && (
          <select
            className="input iv-tile__style"
            aria-label={`Style du ${item.label}`}
            value={item.style ?? 'reveal'}
            disabled={rendering}
            onChange={(e) => props.onUpdate!({ style: e.target.value as ReelStyle })}
          >
            {STYLES.map((style) => (
              <option key={style} value={style}>
                {STYLE_NAMES[style]}
              </option>
            ))}
          </select>
        )}
        {item.style === 'hook' && props.onUpdate && (
          <HookInput
            key={item.hookText ?? ''}
            saved={item.hookText ?? ''}
            onSave={(hookText) => props.onUpdate!({ hookText })}
          />
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
        {item.state === 'missing' && props.onForget && (
          <MissingFile onForget={props.onForget} onRegenerate={() => props.onAction('render')} />
        )}
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
          {item.state !== 'draft' && item.state !== 'missing' && (
            <Button
              variant="secondary"
              small
              disabled={rendering}
              onClick={() => props.onAction('render')}
            >
              Régénérer
            </Button>
          )}
          {item.url && props.onDelete && (
            <Button variant="danger" small disabled={rendering} onClick={props.onDelete}>
              Supprimer
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Hook phrase of a Reel, saved when leaving the field. */
function HookInput(props: { saved: string; onSave: (text: string) => void }) {
  const [text, setText] = useState(props.saved);
  return (
    <input
      className="input iv-tile__hook"
      aria-label="Phrase d’accroche"
      placeholder="Phrase d’accroche"
      maxLength={120}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== props.saved && props.onSave(text.trim())}
    />
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
