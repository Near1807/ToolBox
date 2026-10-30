// Small shared pieces: platform icons, the chip of an element in the
// calendar, the status badge, the preview to drag out of the app.
import { useState, type DragEvent } from 'react';
import { Button, copyText, startFileDrag, Icon } from '@hub/sdk/frontend';
import { STATUS_LABELS, TRACK_COLORS, type ItemKind, type PlannerItem } from './types';

const ICON_TITLES: Record<ItemKind, string> = {
  youtube: 'Vidéo YouTube',
  short: 'YouTube Short',
  'insta-post': 'Post Instagram',
  'insta-reel': 'Reel Instagram',
};

/** One glyph per kind: YouTube in red, Instagram in pink; vertical = Short / Reel. */
export function PlatformIcon(props: { kind: ItemKind; size?: number }) {
  const size = props.size ?? 16;
  const youtube = props.kind === 'youtube' || props.kind === 'short';
  const vertical = props.kind === 'short' || props.kind === 'insta-reel';
  const color = youtube ? 'var(--brand-youtube)' : 'var(--brand-instagram)';
  return (
    <svg
      className="rp-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={ICON_TITLES[props.kind]}
    >
      <title>{ICON_TITLES[props.kind]}</title>
      {vertical ? (
        <rect
          x="4"
          y="1"
          width="8"
          height="14"
          rx="2"
          fill={youtube ? color : 'none'}
          stroke={color}
          strokeWidth="1.6"
        />
      ) : (
        <rect
          x="1"
          y={youtube ? 3 : 1}
          width="14"
          height={youtube ? 10 : 14}
          rx="3"
          fill={youtube ? color : 'none'}
          stroke={color}
          strokeWidth="1.6"
        />
      )}
      {props.kind === 'insta-post' ? (
        <circle cx="8" cy="8" r="3" fill="none" stroke={color} strokeWidth="1.6" />
      ) : (
        <path
          d={vertical ? 'M6.6 5.6v4.8L10.4 8z' : 'M6.4 5.5v5L10.6 8z'}
          fill={youtube ? 'var(--on-overlay)' : color}
        />
      )}
    </svg>
  );
}

export const trackColor = (index: number) => TRACK_COLORS[index % TRACK_COLORS.length]!;

const STATUS_CLASSES: Record<PlannerItem['status'], string> = {
  planned: '',
  queued: 'badge--queued',
  uploading: 'badge--running',
  scheduled: 'badge--loaded',
  'to-schedule': 'badge--warning',
  published: 'badge--succeeded',
  failed: 'badge--failed',
};

export function StatusBadge(props: { item: PlannerItem }) {
  const { item } = props;
  const label =
    item.platform === 'instagram' && item.status === 'planned'
      ? 'À publier à la main'
      : STATUS_LABELS[item.status];
  return (
    <span className="rp-badges">
      <span className={`badge ${STATUS_CLASSES[item.status]}`}>{label}</span>
      {item.late && <span className="badge badge--failed">En retard</span>}
      {!item.source.exists && item.status !== 'published' && item.status !== 'scheduled' && (
        <span className="badge badge--warning">
          {item.source.gone
            ? 'Fichier supprimé'
            : item.source.rendered
              ? 'Fichier introuvable'
              : 'À générer'}
        </span>
      )}
    </span>
  );
}

/** An element in the calendar, draggable to another day. */
export function ItemChip(props: { item: PlannerItem; onOpen: () => void; compact?: boolean }) {
  const { item } = props;
  const done = item.status === 'published';
  return (
    <button
      type="button"
      className={[
        'rp-chip',
        done ? 'rp-chip--done' : '',
        item.late ? 'rp-chip--late' : '',
        item.status === 'failed' || (!item.source.exists && !done && item.status !== 'scheduled')
          ? 'rp-chip--problem'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ borderLeftColor: trackColor(item.colorIndex) }}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-toolbox-planner-item', String(item.id));
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={props.onOpen}
      title={`${item.label} — ${item.trackTitle} · ${item.time} · ${STATUS_LABELS[item.status]}${item.late ? ' · en retard' : ''}`}
    >
      <PlatformIcon kind={item.kind} size={14} />
      <span className="rp-chip__text">
        {!props.compact && <span className="rp-chip__time">{item.time}</span>}
        <span className="rp-chip__label">{item.label}</span>
        <span className="rp-chip__track">{item.trackTitle}</span>
      </span>
      <span className={`rp-dot rp-dot--${item.status}`} aria-hidden="true" />
    </button>
  );
}

export function CopyCaption(props: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      small
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        setCopied(await copyText(props.text));
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <>
          Copié <Icon name="check" />
        </>
      ) : (
        (props.label ?? 'Copier la légende')
      )}
    </Button>
  );
}

/** Preview of the file, to drag into Instagram (browser), the Explorer… */
export function DragPreview(props: { item: PlannerItem; size?: 'small' | 'large' }) {
  const { item } = props;
  const url = item.source.url;
  const dragStart = (event: DragEvent) => {
    event.stopPropagation();
    if (url && startFileDrag(url)) event.preventDefault();
  };
  const vertical = item.kind === 'insta-reel' || item.kind === 'short';
  const className = `rp-preview rp-preview--${props.size ?? 'small'}${vertical ? ' rp-preview--vertical' : ''}`;
  if (!url) {
    return (
      <div className={`${className} rp-preview--empty`}>
        <PlatformIcon kind={item.kind} size={22} />
      </div>
    );
  }
  const image = item.kind === 'insta-post' ? url : item.source.thumbnailUrl;
  return (
    <div
      className={className}
      draggable
      onDragStart={dragStart}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      title="Glisse le fichier vers Instagram (navigateur), l’Explorateur…"
    >
      {image ? (
        <img src={image} alt="" draggable={false} />
      ) : (
        <video src={url} muted preload="metadata" draggable={false} />
      )}
      <span className="rp-preview__hint">
        <Icon name="move" /> glisser
      </span>
    </div>
  );
}
