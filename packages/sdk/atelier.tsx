// v0.45.0: the « atelier » components (first used by the Coffre, reusable
// anywhere): a circular gauge, a counter, a card in relief with a preview, a
// filter pill, a context tile. Only theme tokens (docs/THEMES.md): the ONE
// vivid colour is the theme's accent, for the action and what matters; each
// reads in light and dark themes. Styles: frontend/src/styles.css « Atelier ».
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';

/** A circular gauge: `value` from 0 to 1 (clamped), its label in the middle. */
export function Gauge(props: {
  value: number;
  label: ReactNode;
  /** Under the label (« 12 Go libres »). */
  sub?: ReactNode;
  /** Diameter in px (default 112). */
  size?: number;
  /** « warn » past a threshold the caller decides (the danger token). */
  tone?: 'accent' | 'warn';
  title?: string;
}) {
  const size = props.size ?? 112;
  const stroke = Math.max(6, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0));
  return (
    <div
      className={`atelier-gauge atelier-gauge--${props.tone ?? 'accent'}`}
      style={{ width: size, height: size } as CSSProperties}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      title={props.title}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className="atelier-gauge__track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
        />
        <circle
          className="atelier-gauge__value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={`${circumference * value} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="atelier-gauge__text">
        <strong>{props.label}</strong>
        {props.sub && <span>{props.sub}</span>}
      </div>
    </div>
  );
}

/** A big number and what it counts (« 128 éléments »); `accent` for what matters. */
export function Counter(props: {
  value: ReactNode;
  label: ReactNode;
  tone?: 'accent' | 'plain';
  title?: string;
}) {
  return (
    <div
      className={`atelier-counter atelier-counter--${props.tone ?? 'plain'}`}
      title={props.title}
    >
      <strong className="atelier-counter__value">{props.value}</strong>
      <span className="atelier-counter__label">{props.label}</span>
    </div>
  );
}

/**
 * A card in relief: its preview on top, its title and lines below; hover
 * actions over the preview. A click (or Entrée) runs `onOpen`.
 */
export function ReliefCard(props: {
  preview: ReactNode;
  title: ReactNode;
  /** Lines under the title (nature, context, date…). */
  meta?: ReactNode;
  /** Pills over the preview (« lien externe »…). */
  badges?: ReactNode;
  /** Buttons shown on hover (and to the keyboard). */
  actions?: ReactNode;
  /** A large card (« En cours »). */
  large?: boolean;
  selected?: boolean;
  /** Dimmed (an element not available here). */
  muted?: boolean;
  onOpen?: () => void;
  onPreview?: () => void;
  /** Its own events (right click, drag…), merged by the caller. */
  bind?: Record<string, unknown>;
  label?: string;
}) {
  const open = (e: MouseEvent | KeyboardEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    props.onOpen?.();
  };
  return (
    <article
      className={`atelier-card${props.large ? ' atelier-card--large' : ''}${props.selected ? ' atelier-card--selected' : ''}${props.muted ? ' atelier-card--muted' : ''}`}
      tabIndex={0}
      aria-label={props.label}
      onDoubleClick={open}
      onKeyDown={open}
      {...props.bind}
    >
      <button
        type="button"
        className="atelier-card__preview"
        onClick={props.onPreview ?? props.onOpen}
        tabIndex={-1}
        aria-label="Aperçu"
      >
        {props.preview}
      </button>
      {props.badges && <div className="atelier-card__badges">{props.badges}</div>}
      {props.actions && <div className="atelier-card__actions">{props.actions}</div>}
      <div className="atelier-card__body">
        <div className="atelier-card__title">{props.title}</div>
        {props.meta && <div className="atelier-card__meta">{props.meta}</div>}
      </div>
    </article>
  );
}

/** A filter pill: on / off, with the number it would show. */
export function FilterPill(props: {
  label: ReactNode;
  count?: number;
  on: boolean;
  onClick: () => void;
  /** A colour dot (a context's colour, a CSS value). */
  dot?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`atelier-pill${props.on ? ' atelier-pill--on' : ''}`}
      aria-pressed={props.on}
      title={props.title}
      onClick={props.onClick}
    >
      {props.dot && (
        <span className="atelier-pill__dot" style={{ background: props.dot }} aria-hidden="true" />
      )}
      <span>{props.label}</span>
      {props.count !== undefined && <span className="atelier-pill__count">{props.count}</span>}
    </button>
  );
}

/**
 * A context's tile: its colour, its name, its count, « nouveau ». Something
 * dropped on it goes there (`onDrop`).
 */
export function ContextTile(props: {
  name: ReactNode;
  /** A CSS value (a theme token, or a free colour). */
  color: string;
  count: number;
  /** Added lately (« nouveau » pill). */
  fresh?: number;
  /** The parent's names (« Cours »). */
  path?: ReactNode;
  onOpen: () => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
  /** Something is being dragged over it. */
  dropping?: boolean;
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDragLeave?: (e: DragEvent<HTMLElement>) => void;
  bind?: Record<string, unknown>;
}) {
  return (
    <button
      type="button"
      className={`atelier-tile${props.dropping ? ' atelier-tile--drop' : ''}`}
      style={{ '--tile-color': props.color } as CSSProperties}
      onClick={props.onOpen}
      onDrop={props.onDrop}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      {...props.bind}
    >
      <span className="atelier-tile__bar" aria-hidden="true" />
      {props.path && <span className="atelier-tile__path">{props.path}</span>}
      <span className="atelier-tile__name">{props.name}</span>
      <span className="atelier-tile__foot">
        <span className="atelier-tile__count">{props.count}</span>
        {props.fresh ? (
          <span className="atelier-tile__fresh">
            {props.fresh} nouveau{props.fresh > 1 ? 'x' : ''}
          </span>
        ) : null}
      </span>
    </button>
  );
}
