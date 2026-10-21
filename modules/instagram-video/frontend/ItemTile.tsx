import {
  CopyButton,
  FileActions,
  formatDuration,
  MediaThumb,
  OutputCard,
  PublishedCheck,
  StateBadge,
  type JobInfo,
  type StateTone,
} from '@hub/sdk/frontend';
import { STATE_LABELS, type PackItem } from './types';

export { CopyButton };

const STATE_TONES: Record<PackItem['state'], StateTone> = {
  draft: 'neutral',
  rendering: 'running',
  ready: 'success',
  outdated: 'warning',
  failed: 'danger',
  missing: 'warning',
};

/**
 * One file of the pack (post or Reel), with the shared SDK components:
 * preview to drag out of the app, state, publication checkbox and date, actions.
 */
export function ItemTile(props: {
  item: PackItem;
  job: JobInfo | null;
  onAction: (action: 'open' | 'reveal' | 'render') => void;
  onPublish: (fields: { published?: boolean; publishedAt?: string }) => void;
  onCancel?: (jobId: string) => void;
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

  return (
    <OutputCard
      title={item.label}
      badge={<StateBadge tone={STATE_TONES[item.state]}>{STATE_LABELS[item.state]}</StateBadge>}
      dimmed={Boolean(item.publishedAt)}
      selected={props.selected}
      thumb={
        <MediaThumb
          src={item.thumbnailUrl}
          aspect={item.kind === 'post' ? 'portrait' : 'vertical'}
          dragUrl={item.url}
          placeholder={item.kind === 'post' ? 'Image 4:5' : 'Reel 9:16'}
          selected={props.selected}
          onSelect={props.onSelect && item.outputId !== null ? props.onSelect : undefined}
          selectLabel={`Sélectionner ${item.label}`}
        />
      }
      meta={
        item.kind === 'reel' && item.startSec !== null
          ? `${formatDuration(item.startSec)} → ${formatDuration(item.startSec + (item.durationSec ?? 0))}`
          : undefined
      }
      rendering={rendering && job !== null}
      progress={job?.status === 'running' ? job.progress : null}
      onCancel={job && props.onCancel ? () => props.onCancel!(job.id) : undefined}
      error={item.error}
      missing={
        item.state === 'missing' && props.onForget
          ? { onForget: props.onForget, onRegenerate: () => props.onAction('render') }
          : null
      }
      published={<PublishedCheck publishedAt={item.publishedAt} onChange={props.onPublish} />}
      actions={
        <FileActions
          busy={rendering}
          onOpen={item.url ? () => props.onAction('open') : undefined}
          openLabel={item.kind === 'post' ? 'Voir' : 'Lire'}
          onReveal={item.url ? () => props.onAction('reveal') : undefined}
          onRegenerate={
            item.state !== 'draft' && item.state !== 'missing'
              ? () => props.onAction('render')
              : undefined
          }
          onDelete={item.url ? props.onDelete : undefined}
        />
      }
    />
  );
}
