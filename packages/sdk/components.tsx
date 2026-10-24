// Shared components for generated elements (videos, Reels, posts…). Every
// module shows its generated files with these, so they look and behave the
// same everywhere (docs/MODULES.md §8). Styles: `ui-*` classes of
// frontend/src/styles.css, colours from the theme tokens only.
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
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
  /** A video file: its frame at 1 s is shown (no thumbnail image needed). */
  media?: 'image' | 'video';
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
      {props.src && props.media === 'video' ? (
        <video src={`${props.src}#t=1`} preload="metadata" muted playsInline />
      ) : props.src ? (
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

// ---------------------------------------------------------------------------
// Passage selection on a video filmstrip
// ---------------------------------------------------------------------------

/** Zoom levels of the filmstrip (the visible part is 1/zoom of the video). */
const FILM_ZOOMS = [1, 2, 4, 8];

/**
 * Filmstrip of a video (frames side by side) with a window of FIXED width:
 * the passage lasts `windowSec`, only its start is chosen. Drag the window to
 * move it, or click elsewhere to place its start there (same as the excerpt
 * on the waveform). The start is kept inside the video (moved back when the
 * window would pass its end). Zoom (−/+) for long videos: the strip scrolls
 * and keeps the window in view. `playheadSec`: position of a player, shown
 * on the strip. `onPreview` follows the drag (e.g. to seek the player).
 */
export function FilmstripWindow(props: {
  frames: string[];
  durationSec: number;
  windowSec: number;
  start: number;
  playheadSec?: number | null;
  locked?: boolean;
  onMove: (start: number) => void;
  onPreview?: (start: number) => void;
  label?: string;
}) {
  const { durationSec, windowSec } = props;
  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ offset: number; start: number } | null>(null);
  const length = Math.max(0.1, durationSec);
  const percent = (seconds: number) =>
    `${(Math.min(length, Math.max(0, seconds)) / length) * 100}%`;
  const fit = (start: number) =>
    Math.round(Math.min(Math.max(0, start), Math.max(0, length - windowSec)) * 10) / 10;
  const timeAt = (event: PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * length;
  };
  const start = drag ? drag.start : props.start;

  const changeZoom = (next: number) => {
    setZoom(next);
    // Keep the window in view: scroll so that its start is a little after the left edge.
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el) return;
      el.scrollLeft = Math.max(0, (start / length) * el.scrollWidth - el.clientWidth * 0.15);
    });
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (props.locked) return;
    const time = timeAt(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (time >= start && time <= start + windowSec) {
      setDrag({ offset: time - start, start });
    } else {
      // A click places the start there, then the window can be dragged on.
      const placed = fit(time);
      setDrag({ offset: time - placed, start: placed });
      props.onPreview?.(placed);
    }
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const next = fit(timeAt(event) - drag.offset);
    if (next !== drag.start) {
      setDrag({ ...drag, start: next });
      props.onPreview?.(next);
    }
  };
  const up = () => {
    if (!drag) return;
    if (drag.start !== props.start) props.onMove(drag.start);
    setDrag(null);
  };
  const index = FILM_ZOOMS.indexOf(zoom);

  return (
    <div className="ui-film-wrap">
      <div ref={scroller} className="ui-film-scroll">
        <div
          ref={box}
          className={`ui-film${props.locked ? ' ui-film--locked' : ''}`}
          style={{ width: `${zoom * 100}%` }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => setDrag(null)}
          role="group"
          aria-label={props.label ?? 'Passage sur la pellicule de la vidéo'}
        >
          <div className="ui-film__frames">
            {props.frames.map((frame) => (
              <img key={frame} src={frame} alt="" draggable={false} />
            ))}
          </div>
          <div
            className="ui-film__window"
            style={{ left: percent(start), width: percent(Math.min(windowSec, length)) }}
          />
          {props.playheadSec !== undefined && props.playheadSec !== null && (
            <div className="ui-film__playhead" style={{ left: percent(props.playheadSec) }} />
          )}
        </div>
      </div>
      <div className="ui-film__zoom">
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={index <= 0}
          onClick={() => changeZoom(FILM_ZOOMS[index - 1]!)}
          aria-label="Dézoomer la pellicule"
        >
          −
        </button>
        <span className="small muted num">×{zoom}</span>
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={index >= FILM_ZOOMS.length - 1}
          onClick={() => changeZoom(FILM_ZOOMS[index + 1]!)}
          aria-label="Zoomer la pellicule"
        >
          +
        </button>
      </div>
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

// ---------------------------------------------------------------------------
// Texts edited in place (title, description, caption, tags)
// ---------------------------------------------------------------------------

export interface TextFieldSpec {
  key: string;
  label: string;
  multiline?: boolean;
  rows?: number;
  /** Counter shown next to the label; red above the limit. */
  max?: number;
  /** YouTube counts descriptions in bytes. */
  maxUnit?: 'chars' | 'bytes';
  placeholder?: string;
  help?: ReactNode;
  /** « Copier » button next to the label. */
  copy?: boolean;
}

const sizeOf = (text: string, unit: 'chars' | 'bytes' = 'chars') =>
  unit === 'bytes' ? new TextEncoder().encode(text).length : text.length;

/**
 * Texts of a generated element, edited under it: saved when leaving a field,
 * with « Enregistrer » or Ctrl+Entrée. Templates of the settings only pre-fill:
 * `onReset` goes back to the template text, `onSaveAsTemplate` makes the
 * current text the default template (« Enregistrer comme modèle par défaut »).
 */
export function TextFields(props: {
  fields: TextFieldSpec[];
  values: Record<string, string>;
  onSave: (values: Record<string, string>) => Promise<unknown>;
  /** The texts differ from the template (shown as « Personnalisé »). */
  custom?: boolean;
  onReset?: () => Promise<unknown>;
  resetLabel?: string;
  /** Status shown while the text is not custom (default « Texte du modèle »). */
  templateLabel?: string;
  onSaveAsTemplate?: (values: Record<string, string>) => Promise<unknown>;
  /** Locked (e.g. already published). */
  readOnly?: boolean;
  /** Extra buttons in the action row. */
  children?: ReactNode;
}) {
  const saved = JSON.stringify(props.values);
  const [draft, setDraft] = useState(props.values);
  const [base, setBase] = useState(saved);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // New values from the server (after a reset, another page…) replace the draft.
  if (saved !== base) {
    setBase(saved);
    setDraft(props.values);
  }
  const dirty = props.fields.some((f) => (draft[f.key] ?? '') !== (props.values[f.key] ?? ''));

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus(done);
      setTimeout(() => setStatus(null), 2500);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    if (dirty && !props.readOnly) void run(() => props.onSave(draft), 'Enregistré ✓');
  };

  return (
    <div className="ui-texts">
      {props.fields.map((field) => {
        const value = draft[field.key] ?? '';
        const size = sizeOf(value, field.maxUnit);
        const common = {
          className: 'input',
          value,
          placeholder: field.placeholder,
          readOnly: props.readOnly,
          'aria-label': field.label,
          onChange: (event: { target: { value: string } }) =>
            setDraft((current) => ({ ...current, [field.key]: event.target.value })),
          onBlur: save,
          onKeyDown: (event: { key: string; ctrlKey: boolean; metaKey: boolean }) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save();
          },
        };
        return (
          <div key={field.key} className="ui-texts__field">
            <div className="ui-texts__label">
              <span className="label">{field.label}</span>
              <span className="ui-actions">
                {field.max !== undefined && (
                  <span
                    className={`ui-texts__count${size > field.max ? ' ui-texts__count--over' : ''}`}
                  >
                    {size}/{field.max}
                  </span>
                )}
                {field.copy && <CopyButton text={value} disabled={!value} />}
              </span>
            </div>
            {field.multiline ? (
              <textarea rows={field.rows ?? 4} {...common} />
            ) : (
              <input {...common} />
            )}
            {field.help && <span className="faint small">{field.help}</span>}
          </div>
        );
      })}
      <div className="ui-texts__actions">
        {!props.readOnly && (
          <Button small disabled={!dirty || busy} onClick={save}>
            Enregistrer
          </Button>
        )}
        {props.onReset && !props.readOnly && (
          <Button
            variant="secondary"
            small
            disabled={busy || (!props.custom && !dirty)}
            onClick={() => void run(() => props.onReset!(), 'Texte du modèle rétabli')}
          >
            {props.resetLabel ?? 'Rétablir le modèle'}
          </Button>
        )}
        {props.onSaveAsTemplate && (
          <Button
            variant="secondary"
            small
            disabled={busy}
            title="Ce texte devient le modèle des prochains morceaux (le titre, l’artiste… y sont remplacés par leurs repères)."
            onClick={() =>
              void run(() => props.onSaveAsTemplate!(draft), 'Modèle par défaut enregistré ✓')
            }
          >
            Enregistrer comme modèle par défaut
          </Button>
        )}
        {props.children}
        <span className="ui-texts__status">
          {status ??
            (props.custom
              ? 'Personnalisé'
              : props.onReset
                ? (props.templateLabel ?? 'Texte du modèle')
                : '')}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Track list
// ---------------------------------------------------------------------------

export interface TrackListEntry {
  id: number;
  title: string;
  artist: string;
  coverUrl: string | null;
}

/**
 * Page laid out around the tracks: searchable list on the left (cover, title,
 * `detail` line), the selected track's panel (`children`) on the right. The
 * selection is the module's (usually `?track=` in the URL).
 */
export function TrackList<T extends TrackListEntry>(props: {
  tracks: T[];
  selected: number | null;
  onSelect: (id: number) => void;
  /** Second line under the title (duration, publication state…). */
  detail: (track: T) => ReactNode;
  children: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const visible = props.tracks.filter((t) =>
    `${t.title} ${t.artist}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="ui-tracks-layout">
      <aside className="ui-tracks">
        <input
          className="input"
          placeholder="Rechercher…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul>
          {visible.map((track) => (
            <li key={track.id}>
              <button
                type="button"
                className={`ui-tracks__item${track.id === props.selected ? ' ui-tracks__item--active' : ''}`}
                onClick={() => props.onSelect(track.id)}
              >
                {track.coverUrl ? (
                  <img src={track.coverUrl} alt="" />
                ) : (
                  <span className="ui-tracks__placeholder">♪</span>
                )}
                <span>
                  <strong>{track.title}</strong>
                  <span className="muted small">{props.detail(track)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="ui-tracks-layout__main">{props.children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// « Annuler »
// ---------------------------------------------------------------------------

/**
 * Bar shown after an addition or a deletion (« Tâche supprimée — Annuler »).
 * Disappears by itself after `timeoutMs`; the assistant's history and the
 * modules use the same one.
 */
export function UndoToast(props: {
  message: ReactNode;
  onUndo: () => void;
  onDismiss: () => void;
  timeoutMs?: number;
}) {
  const { onDismiss, timeoutMs = 8000 } = props;
  useEffect(() => {
    const timer = setTimeout(onDismiss, timeoutMs);
    return () => clearTimeout(timer);
  }, [onDismiss, timeoutMs]);
  return (
    <div className="ui-undo" role="status">
      <span>{props.message}</span>
      <Button
        variant="secondary"
        small
        onClick={() => {
          props.onUndo();
          onDismiss();
        }}
      >
        Annuler
      </Button>
      <button type="button" className="icon-button" aria-label="Fermer" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick check of the master before a generation
// ---------------------------------------------------------------------------

/** What a generator's `GET …/precheck` answers (from the optional masterAnalysis service). */
export interface PrecheckResult {
  ok: boolean;
  issues: { kind: string; text: string }[];
  /** Page of « Analyse du master » for the track (« Voir l'analyse »), null without the module. */
  path: string | null;
}

/**
 * Checks the master before generating, without ever blocking: `guard(url,
 * generate)` reads the check and runs `generate` at once when there is
 * nothing to say (or the check is unavailable); otherwise `notice` shows the
 * facts with « Générer quand même » / « Voir l'analyse » / « Annuler ».
 */
export function usePrecheck(get: <T>(url: string) => Promise<T>) {
  const [pending, setPending] = useState<{ result: PrecheckResult; generate: () => void } | null>(
    null,
  );
  const guard = async (url: string, generate: () => void | Promise<void>) => {
    let result: PrecheckResult | null;
    try {
      result = await get<PrecheckResult>(url);
    } catch {
      result = null;
    }
    if (!result || result.ok || result.issues.length === 0) return void (await generate());
    setPending({ result, generate: () => void generate() });
  };
  const notice = pending ? (
    <div className="ui-precheck" role="alertdialog" aria-label="Vérification du master">
      <strong>Vérification rapide du master avant de générer :</strong>
      <ul>
        {pending.result.issues.map((issue) => (
          <li key={issue.kind + issue.text}>{issue.text}</li>
        ))}
      </ul>
      <div className="ui-actions">
        <Button
          small
          onClick={() => {
            const generate = pending.generate;
            setPending(null);
            generate();
          }}
        >
          Générer quand même
        </Button>
        {pending.result.path !== null && (
          <Button
            variant="secondary"
            small
            onClick={() => {
              window.location.hash = `#/m/master-analysis${pending.result.path}`;
            }}
          >
            Voir l’analyse
          </Button>
        )}
        <Button variant="secondary" small onClick={() => setPending(null)}>
          Annuler
        </Button>
      </div>
    </div>
  ) : null;
  return { guard, notice };
}
