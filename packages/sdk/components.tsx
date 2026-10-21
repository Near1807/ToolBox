// Shared components for generated elements (videos, Reels, posts…). Every
// module shows its generated files with these, so they look and behave the
// same everywhere (docs/MODULES.md §8). Styles: `ui-*` classes of
// frontend/src/styles.css, colours from the theme tokens only.
import { useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react';
import { Button, copyText, MissingFile, ProgressBar, startFileDrag } from './frontend';

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type StateTone = 'neutral' | 'running' | 'success' | 'warning' | 'danger' | 'accent';

const TONE_CLASSES: Record<StateTone, string> = {
  neutral: '',
  running: 'badge--running',
  success: 'badge--success',
  warning: 'badge--warning',
  danger: 'badge--danger',
  accent: 'badge--accent',
};

/** Status pill (Généré, Planifié, Programmé, Publié, Erreur…). */
export function StateBadge(props: { tone?: StateTone; title?: string; children: ReactNode }) {
  return (
    <span className={`badge ${TONE_CLASSES[props.tone ?? 'neutral']}`} title={props.title}>
      {props.children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Thumbnail
// ---------------------------------------------------------------------------

export type MediaAspect = 'landscape' | 'vertical' | 'portrait' | 'square';

/**
 * Preview of a generated file. When `dragUrl` is set (its signed media URL),
 * the preview can be dragged out of the app (Instagram, Explorer…).
 */
export function MediaThumb(props: {
  src?: string | null;
  aspect?: MediaAspect;
  dragUrl?: string | null;
  /** Shown when there is no image yet (e.g. « Reel 9:16 »). */
  placeholder?: ReactNode;
  /** Multiple selection checkbox in the corner. */
  selected?: boolean;
  onSelect?: () => void;
  selectLabel?: string;
  children?: ReactNode;
}) {
  const draggable = Boolean(props.dragUrl);
  const dragStart = (event: DragEvent) => {
    if (props.dragUrl && startFileDrag(props.dragUrl)) event.preventDefault();
  };
  const aspect = props.aspect ?? 'landscape';
  return (
    <div
      className={`ui-thumb${aspect === 'landscape' ? '' : ` ui-thumb--${aspect}`}`}
      draggable={draggable}
      onDragStart={dragStart}
      title={draggable ? 'Glisse ce fichier vers Instagram, l’Explorateur…' : undefined}
    >
      {props.src ? (
        <img src={props.src} alt="" draggable={false} />
      ) : (
        <span className="small">{props.placeholder}</span>
      )}
      {draggable && <span className="ui-thumb__drag">⇱ glisser</span>}
      {props.onSelect && (
        <input
          type="checkbox"
          className="ui-thumb__select"
          aria-label={props.selectLabel ?? 'Sélectionner'}
          checked={Boolean(props.selected)}
          onChange={props.onSelect}
          onClick={(event) => event.stopPropagation()}
        />
      )}
      {props.children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// « Publié » box
// ---------------------------------------------------------------------------

/** "2026-10-19T…" → "2026-10-19" (local day) for <input type="date">. */
export function dateInputValue(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** « Publié » checkbox and, once ticked, the publication date (editable). */
export function PublishedCheck(props: {
  publishedAt: string | null;
  onChange: (change: { published?: boolean; publishedAt?: string }) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <label className="ui-published">
      <input
        type="checkbox"
        checked={Boolean(props.publishedAt)}
        disabled={props.disabled}
        onChange={(e) => props.onChange({ published: e.target.checked })}
      />
      {props.label ?? 'Publié'}
      {props.publishedAt && (
        <input
          type="date"
          className="input ui-published__date"
          value={dateInputValue(props.publishedAt)}
          disabled={props.disabled}
          onChange={(e) => e.target.value && props.onChange({ publishedAt: e.target.value })}
        />
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Actions on a generated file
// ---------------------------------------------------------------------------

/**
 * The usual buttons, always in the same order: Lire/Voir, Dossier, Régénérer,
 * Supprimer. A button appears only when its handler is given.
 */
export function FileActions(props: {
  onOpen?: () => void;
  openLabel?: string;
  onReveal?: () => void;
  onRegenerate?: () => void;
  regenerateLabel?: string;
  onDelete?: () => void;
  /** While rendering: Régénérer and Supprimer are disabled. */
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="ui-actions">
      {props.onOpen && (
        <Button variant="secondary" small onClick={props.onOpen}>
          {props.openLabel ?? 'Lire'}
        </Button>
      )}
      {props.onReveal && (
        <Button variant="secondary" small onClick={props.onReveal}>
          Dossier
        </Button>
      )}
      {props.onRegenerate && (
        <Button variant="secondary" small disabled={props.busy} onClick={props.onRegenerate}>
          {props.regenerateLabel ?? 'Régénérer'}
        </Button>
      )}
      {props.children}
      {props.onDelete && (
        <Button variant="danger" small disabled={props.busy} onClick={props.onDelete}>
          Supprimer
        </Button>
      )}
    </div>
  );
}

/** « Copier » button that confirms for a moment. */
export function CopyButton(props: { text: string; label?: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      small
      disabled={props.disabled}
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

// ---------------------------------------------------------------------------
// Generated element card
// ---------------------------------------------------------------------------

/**
 * One generated element: thumbnail, title + status, details, render progress,
 * error / missing file, « Publié » box, actions. Lay several out in a
 * `<div className="ui-cards">` grid.
 */
export function OutputCard(props: {
  title: ReactNode;
  badge?: ReactNode;
  thumb?: ReactNode;
  /** Short details under the title (excerpt, duration…). */
  meta?: ReactNode;
  /** Render in progress: null = indeterminate. */
  progress?: number | null;
  rendering?: boolean;
  onCancel?: () => void;
  error?: string | null;
  /** File deleted or moved outside the app. */
  missing?: { onForget: () => void; onRegenerate?: () => void } | null;
  published?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  /** Published or excluded elements are shown a little dimmed. */
  dimmed?: boolean;
  children?: ReactNode;
}) {
  const classes = ['ui-card'];
  if (props.selected) classes.push('ui-card--selected');
  if (props.dimmed) classes.push('ui-card--dimmed');
  return (
    <div className={classes.join(' ')}>
      {props.thumb}
      <div className="ui-card__body">
        <div className="ui-card__title">
          <strong>{props.title}</strong>
          {props.badge}
        </div>
        {props.meta && <span className="muted small">{props.meta}</span>}
        {props.rendering && (
          <div className="ui-card__progress">
            <ProgressBar value={props.progress ?? null} />
            {props.onCancel && (
              <Button variant="secondary" small onClick={props.onCancel}>
                Annuler
              </Button>
            )}
          </div>
        )}
        {props.error && !props.rendering && <span className="error small">{props.error}</span>}
        {props.missing && (
          <MissingFile
            onForget={props.missing.onForget}
            onRegenerate={props.missing.onRegenerate}
          />
        )}
        {props.children}
        {props.published}
        {props.actions}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Excerpt selection on a waveform
// ---------------------------------------------------------------------------

export interface WaveRegion {
  id: number;
  /** 1..4: colour (theme series) and number shown. */
  position: number;
  start: number;
  clipSec: number;
  /** Published excerpts cannot be moved. */
  locked: boolean;
}

/**
 * Waveform of a track with one coloured region per excerpt. Drag a region to
 * move its start; a click outside the regions moves the active excerpt there.
 * `peaks`: 0..1 per bar (e.g. from the video engine's waveform).
 */
export function ExcerptWaveform(props: {
  peaks: number[];
  durationSec: number;
  regions: WaveRegion[];
  activeId: number | null;
  playheadSec: number | null;
  onActivate: (id: number) => void;
  onMove: (id: number, start: number) => void;
  label?: string;
}) {
  const { peaks, durationSec, regions } = props;
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: number; offset: number; start: number } | null>(null);
  const percent = (seconds: number) =>
    `${(Math.min(durationSec, Math.max(0, seconds)) / durationSec) * 100}%`;

  const timeAt = (event: PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * durationSec;
  };
  const fit = (start: number, clip: number) =>
    Math.round(Math.min(Math.max(0, start), Math.max(0, durationSec - clip)) * 10) / 10;
  const startOf = (region: WaveRegion) => (drag?.id === region.id ? drag.start : region.start);

  const down = (event: PointerEvent<HTMLDivElement>) => {
    const time = timeAt(event);
    const under = regions.filter(
      (r) => !r.locked && time >= startOf(r) && time <= startOf(r) + r.clipSec,
    );
    const target = under.find((r) => r.id === props.activeId) ?? under[0];
    if (target) {
      props.onActivate(target.id);
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ id: target.id, offset: time - target.start, start: target.start });
      return;
    }
    const active = regions.find((r) => r.id === props.activeId && !r.locked);
    if (active) props.onMove(active.id, fit(time, active.clipSec));
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const region = regions.find((r) => r.id === drag.id)!;
    setDrag({ ...drag, start: fit(timeAt(event) - drag.offset, region.clipSec) });
  };

  const up = () => {
    if (!drag) return;
    const region = regions.find((r) => r.id === drag.id);
    if (region && drag.start !== region.start) props.onMove(drag.id, drag.start);
    setDrag(null);
  };

  return (
    <div
      ref={box}
      className="ui-wave"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
      role="group"
      aria-label={props.label ?? 'Extraits sur la forme d’onde'}
    >
      <div className="ui-wave__bars">
        {peaks.map((peak, index) => (
          <span
            key={index}
            className="ui-wave__bar"
            style={{ height: `${Math.max(3, peak * 100)}%` }}
          />
        ))}
      </div>
      {regions.map((region) => (
        <div
          key={region.id}
          className={[
            'ui-wave__region',
            `ui-wave__region--${region.position}`,
            region.id === props.activeId ? 'ui-wave__region--active' : '',
            region.locked ? 'ui-wave__region--locked' : '',
          ].join(' ')}
          style={{ left: percent(startOf(region)), width: percent(region.clipSec) }}
        >
          <span>{region.position}</span>
        </div>
      ))}
      {props.playheadSec !== null && (
        <div className="ui-wave__playhead" style={{ left: percent(props.playheadSec) }} />
      )}
    </div>
  );
}

/** Round numbered chip in the colour of an excerpt (1..4). */
export function ExcerptChip(props: {
  position: number;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`ui-chip-number ui-chip-number--${props.position}`}
      style={props.active ? { boxShadow: 'var(--glow)' } : undefined}
      onClick={props.onClick}
      title={props.title}
      aria-pressed={props.active}
    >
      {props.position}
    </button>
  );
}
