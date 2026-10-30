// Layout pieces shared by the views: key figures in large type, groups
// titled by question, details folded by default, column and lane choices
// remembered on this computer, neutral emphasis of large differences.
// Presentation only: every number shown comes from the measures as they are.
import { useState, type ReactNode } from 'react';
import { Help } from './guide/Help';
import { Icon } from '@hub/sdk/frontend';

export interface Figure {
  label: string;
  value: string;
  unit?: string;
  /** A second, smaller line (e.g. « 0 écrêtage »). */
  sub?: string;
  topic?: string;
  /** Neutral emphasis class (see `emphasis`). */
  tone?: string;
}

/** A row of key figures, large and readable at a glance. */
export function KeyFigures(props: { items: Figure[]; label: string }) {
  return (
    <dl className="ma-figures" aria-label={props.label}>
      {props.items.map((item) => (
        <div key={item.label} className="ma-figure">
          <dt>
            {item.label}
            {item.topic && <Help topic={item.topic} />}
          </dt>
          <dd className={item.tone}>
            <span className="ma-figure__value num">{item.value}</span>
            {item.unit && <span className="ma-figure__unit">{item.unit}</span>}
          </dd>
          {item.sub && <dd className="ma-figure__sub">{item.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A card answering one question (« Volume et dynamique »…), its detail folded. */
export function Group(props: {
  title: string;
  topic?: string;
  figures?: Figure[];
  children?: ReactNode;
  detail?: ReactNode;
  detailLabel?: string;
  wide?: boolean;
}) {
  return (
    <section className={`card ma-group${props.wide ? ' ma-group--wide' : ''}`}>
      <h3>
        {props.title}
        {props.topic && <Help topic={props.topic} />}
      </h3>
      {props.figures && <KeyFigures items={props.figures} label={props.title} />}
      {props.children}
      {props.detail && <Details label={props.detailLabel}>{props.detail}</Details>}
    </section>
  );
}

/** « Voir le détail » / « Masquer le détail », folded by default. */
export function Details(props: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const label = props.label ?? 'le détail';
  return (
    <div className="ma-details">
      <button
        type="button"
        className="ma-details__toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} /> {open ? 'Masquer' : 'Voir'} {label}
      </button>
      {open && <div className="ma-details__body">{props.children}</div>}
    </div>
  );
}

/**
 * A set of ids kept in this computer's storage (lanes shown, columns shown):
 * a convenience of the interface, never data of the module.
 */
export function useStoredChoice(key: string, defaults: string[]) {
  const [shown, setShown] = useState<Set<string>>(() => {
    try {
      const saved = window.localStorage.getItem(`master-analysis.${key}`);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch {
      // Storage unavailable: the defaults.
    }
    return new Set(defaults);
  });
  const toggle = (id: string) => {
    const next = new Set(shown);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setShown(next);
    try {
      window.localStorage.setItem(`master-analysis.${key}`, JSON.stringify([...next]));
    } catch {
      // Not remembered: still applied for this page.
    }
  };
  return { shown, toggle };
}

/** Toggle chips: which lanes or columns are shown. */
export function Choice(props: {
  label: string;
  options: readonly { id: string; label: string }[];
  shown: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="ma-choice" role="group" aria-label={props.label}>
      <span className="ma-choice__label">{props.label}</span>
      {props.options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="ma-chip"
          aria-pressed={props.shown.has(o.id)}
          onClick={() => props.onToggle(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Neutral emphasis of a difference, without any wording: bold from `strong`
 * (3 dB / LU by default), faded under `faint` (1). The guide states the rule.
 */
export function emphasis(value: number | null | undefined, strong = 3, faint = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'ma-faint';
  const size = Math.abs(value);
  return size >= strong ? 'ma-strong' : size < faint ? 'ma-faint' : '';
}
