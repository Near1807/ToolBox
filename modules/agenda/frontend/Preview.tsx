// v0.41.0: the preview on hover (PC only). The mouse rests ~400 ms on a block
// of the week (or a task « à caser »), or a block gets the keyboard focus: a
// small read-only card next to it says everything (full title, day and time,
// full place, category, note, « facultatif », the import's code and source,
// a task's state, another tool's name and status). It goes when the mouse
// leaves, at a click or the start of a drag, on scroll, with Échap; never
// during a drag. One component for the week and « À caser ». It replaces the
// blocks' native tooltip (their aria-label keeps the whole text).
import {
  type FocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { formatDuration } from '@hub/sdk/dates';
import { describeEvent } from '../shared/import-item';
import { dayLabel, eventWhen, hoursText, minutesBetween } from '../shared/time';
import type { ToPlaceDto } from '../shared/types';
import { colorStyle, fullPlace, type Item, isOptional } from './common';

/** What a card is about: a block of the week, or a task to fit in. */
export type PreviewTarget =
  | { kind: 'item'; item: Item; overlaps?: boolean; movable?: boolean }
  | { kind: 'task'; task: ToPlaceDto; draggable?: boolean };

export interface PreviewContent {
  title: string;
  when: string;
  place: string | null;
  category: string | null;
  note: string | null;
  /** One line each: « Facultatif… », « Code : … », « Importé de … », « Faite »… */
  facts: string[];
  /** What can be done with it (muted): « Glisser pour déplacer… ». */
  hint: string | null;
}

/** The delay before the card shows (the mouse resting on a block). */
export const PREVIEW_DELAY_MS = 400;

/** Pure: what the card says (also the blocks' aria-label). */
export function previewOf(
  target: PreviewTarget,
  today: string,
  toolName: (moduleId: string) => string | null = () => null,
): PreviewContent {
  if (target.kind === 'task') {
    const t = target.task;
    return {
      title: t.title,
      when: t.due
        ? `À faire pour ${dayLabel(t.due, today)}${t.late ? ' (en retard)' : ''}`
        : 'Sans échéance',
      place: null,
      category: 'Tâches',
      note: null,
      facts: [
        t.estimateMin ? `Durée estimée : ${formatDuration(t.estimateMin)}` : 'Sans durée estimée',
        'À caser : pas encore prévue à une heure',
      ],
      hint: target.draggable
        ? 'Glisser dans la semaine pour la prévoir · clic : sa fiche'
        : 'Clic : sa fiche',
    };
  }
  const { item } = target;
  const e = item.event;
  const length = e.allDay ? '' : ` · ${hoursText(minutesBetween(e.start, e.end))}`;
  const facts: string[] = [];
  let place: string | null = null;
  let note: string | null = null;
  if (item.source === 'own') {
    const own = item.event;
    place = own.location?.trim() ? fullPlace(own.location) : null;
    note = own.note?.trim() || null;
    if (isOptional(item))
      facts.push('Facultatif : ne compte ni dans les conflits ni dans la charge');
    if (own.weekly)
      facts.push(own.weekly.moved ? 'Semaine type (déplacé ce jour-là)' : 'Semaine type');
    if (own.source) {
      const o = own.source.original;
      const code =
        o.SUMMARY !== undefined
          ? describeEvent(o.SUMMARY.trim() || '(sans titre)', o.DESCRIPTION ?? '').code
          : null;
      if (code) facts.push(`Code : ${code}`);
      facts.push(`Importé de « ${own.source.name} »`);
    }
  } else if (item.source === 'task') {
    const task = item.event;
    facts.push(task.done ? 'Faite' : 'À faire');
    if (task.due) facts.push(`Échéance : ${dayLabel(task.due, today)}`);
    if (task.afterDue && !task.done) facts.push('Prévue après son échéance');
    facts.push('Tâche de la To-do');
  } else {
    const other = item.event;
    facts.push(`Vient de ${toolName(other.moduleId) ?? 'un autre outil'}`);
    if (other.status) facts.push(other.status);
  }
  if (target.overlaps) facts.push('Chevauche un autre élément');
  return {
    title: e.title,
    when: `${eventWhen(e, today)}${length}`,
    place,
    category: e.category,
    note,
    facts,
    hint:
      item.source === 'foreign'
        ? 'Se modifie dans son outil (clic pour l’ouvrir)'
        : target.movable
          ? 'Glisser pour déplacer · tirer le bas pour la durée · clic : la fiche'
          : 'Clic : la fiche',
  };
}

/** The whole card as one sentence (the blocks' aria-label). */
export const previewText = (c: PreviewContent) =>
  [c.title, c.when, c.place, c.category, c.note, ...c.facts].filter(Boolean).join(' · ');

function Card(props: { content: PreviewContent; anchor: DOMRect }) {
  const c = props.content;
  const { anchor } = props;
  // Measured hidden at the corner, then placed next to the block, in the window.
  const place = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const at = placeCard(
        anchor,
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      el.style.left = `${at.left}px`;
      el.style.top = `${at.top}px`;
      el.style.visibility = 'visible';
    },
    [anchor],
  );
  return (
    <div
      ref={place}
      className="ag-preview"
      role="tooltip"
      style={{ left: 0, top: 0, visibility: 'hidden' }}
    >
      <p className="ag-preview__title">{c.title}</p>
      <p className="ag-preview__when">{c.when}</p>
      {c.place && <p>{c.place}</p>}
      {c.category && (
        <p className="ag-preview__category">
          <span className="ag-preview__dot" style={colorStyle(c.category)} aria-hidden="true" />
          {c.category}
        </p>
      )}
      {c.note && <p className="ag-preview__note">{c.note}</p>}
      {c.facts.map((f) => (
        <p key={f} className="ag-preview__fact">
          {f}
        </p>
      ))}
      {c.hint && <p className="ag-preview__hint">{c.hint}</p>}
    </div>
  );
}

/** Where the card goes: right of the block, else left; top aligned, kept in the window. */
export function placeCard(
  anchor: { left: number; right: number; top: number; bottom: number },
  card: { width: number; height: number },
  view: { width: number; height: number },
  gap = 8,
): { left: number; top: number } {
  let left = anchor.right + gap;
  if (left + card.width > view.width - gap) left = anchor.left - gap - card.width;
  left = Math.max(gap, Math.min(left, view.width - gap - card.width));
  let top = anchor.top;
  if (top + card.height > view.height - gap) top = view.height - gap - card.height;
  return { left, top: Math.max(gap, top) };
}

interface Shown {
  target: PreviewTarget;
  anchor: DOMRect;
}

/**
 * The hover preview of a page: `bind(target)` gives the props of an element
 * (pointer and focus), `card` is the card to render once. `disabled` (a drag,
 * the phone) hides it and shows nothing.
 */
export function useHoverPreview(options: {
  today: string;
  disabled: boolean;
  toolName?: (moduleId: string) => string | null;
}): {
  bind: (target: PreviewTarget) => {
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onFocus: (e: FocusEvent<HTMLElement>) => void;
    onBlur: () => void;
  };
  /** Call at a pointer down (a click, a drag that starts): the card goes. */
  hide: () => void;
  card: ReactNode;
} {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | null>(null);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = useCallback(() => {
    cancel();
    setShown(null);
  }, []);
  // Scroll, Échap: the card goes.
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [shown, hide]);
  useEffect(() => cancel, []);
  const bind = (target: PreviewTarget) => ({
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => {
      if (options.disabled || e.pointerType === 'touch' || e.buttons !== 0) return;
      cancel();
      const el = e.currentTarget;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setShown({ target, anchor: el.getBoundingClientRect() });
      }, PREVIEW_DELAY_MS);
    },
    onPointerLeave: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      // The keyboard focus only (a click gives the focus too: no card for it).
      if (options.disabled || !e.currentTarget.matches(':focus-visible')) return;
      cancel();
      setShown({ target, anchor: e.currentTarget.getBoundingClientRect() });
    },
    onBlur: hide,
  });
  // Never during a drag (nor on the phone): nothing shown.
  const content =
    shown && !options.disabled ? previewOf(shown.target, options.today, options.toolName) : null;
  const anchor = shown?.anchor;
  const card =
    content && anchor && createPortal(<Card content={content} anchor={anchor} />, document.body);
  return { bind, hide, card };
}
