// The week (PC): a column per day, the hours of the day's range, blocks
// coloured by category; on top the all-day and several-day items in bands
// and « À caser » (the To-do's tasks due this week, by due date, then those
// without a date, folded); under each day its load bar by category and a
// state; « X h de libre · Y h à caser »; overlaps flagged; category
// switches (v0.35.0: what is off is neither shown nor counted).
// v0.35.0: drag and drop (PC) — a task from « À caser » to the grid, a block
// to another time or day, its bottom to stretch it; Échap cancels; one write
// on the drop only (the page does it, with « Annuler »).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router';
import { Icon, onPhone, StateBadge, useModuleNames } from '@hub/sdk/frontend';
import { formatDuration } from '@hub/sdk/dates';
import { categoryColor } from '../shared/categories';
import { placeDay, TASKS_CATEGORY, weekSummary, weighsOn, type DayLoad } from '../shared/load';
import { addDays, dayLabel, daysBetween, hoursText } from '../shared/time';
import type { RangeDto, ToPlaceDto } from '../shared/types';
import {
  moveSpan,
  placeSpan,
  sameSpan,
  slotSpan,
  spanLabel,
  stretchSpan,
  type Span,
} from '../shared/drag';
import { CreateSlot, type SlotKind } from './CreateSlot';
import { previewOf, previewText, useHoverPreview } from './Preview';
import { minutesBetween, minutesOfDay } from '../shared/time';
import {
  colorStyle,
  isOptional,
  itemId,
  itemsOf,
  movable,
  placeOf,
  shortPlace,
  switchCategories,
  taskLoads,
  timedBlocks,
  timerRuns,
  type Item,
} from './common';

const HOUR_PX = 44;

const STATE_TONE = { léger: 'success', chargé: 'warning', saturé: 'danger' } as const;

/**
 * The category switches (v0.35.0): ON = shown AND counted (load, free time,
 * overlaps); OFF = neither. Sport, Repas and Timer are off by default; each
 * device keeps its own choices.
 */
export function CategorySwitches(props: {
  categories: string[];
  shown: (category: string) => boolean;
  onToggle: (category: string) => void;
}) {
  if (props.categories.length === 0) return null;
  return (
    <div className="ag-layers" role="group" aria-label="Catégories affichées et comptées">
      <span className="small muted">Catégories :</span>
      {props.categories.map((c) => {
        const on = props.shown(c);
        return (
          <button
            key={c}
            type="button"
            role="switch"
            aria-checked={on}
            className={`ag-layer${on ? ' ag-layer--on' : ' ag-layer--off'}`}
            style={colorStyle(c)}
            title={
              on
                ? `« ${c} » est affiché et compté dans la charge. Clic : éteindre`
                : `« ${c} » n’est ni affiché ni compté. Clic : allumer`
            }
            onClick={() => props.onToggle(c)}
          >
            <span className="ag-switch" aria-hidden="true" />
            {c}
          </button>
        );
      })}
    </div>
  );
}

/** « (hors Sport, Repas) »: what the summary does not count. */
export function offText(categories: string[], shown: (category: string) => boolean): string {
  const off = categories.filter((c) => !shown(c));
  return off.length ? ` · hors ${off.join(', ')}` : '';
}

/** A day's load: a bar cut by category, and its state. */
export function LoadBar(props: { load: DayLoad }) {
  const { load } = props;
  const scale = Math.max(load.rangeMin, load.totalMin);
  return (
    <div className="ag-load" title={loadTitle(load)}>
      <div className="ag-load__bar" aria-hidden="true">
        {load.byCategory.map((c) => (
          <span
            key={c.category}
            className="ag-load__part"
            style={{
              width: `${(c.minutes / scale) * 100}%`,
              background: categoryColor(c.category),
            }}
          />
        ))}
      </div>
      <span className="small ag-load__label">
        <StateBadge tone={STATE_TONE[load.state]}>{load.state}</StateBadge>{' '}
        {load.totalMin ? hoursText(load.totalMin) : '—'}
        {load.tasksWithoutEstimate ? ` · +${load.tasksWithoutEstimate} sans durée` : ''}
      </span>
    </div>
  );
}

const loadTitle = (load: DayLoad) =>
  [
    `${hoursText(load.totalMin)} sur ${hoursText(load.rangeMin)} (${load.state})`,
    ...load.byCategory.map((c) => `${c.category} : ${hoursText(c.minutes)}`),
    `Libre : ${hoursText(load.freeMin)}`,
  ].join('\n');

/** What a drop gives: the page writes it (one write), with « Annuler ». */
export type Drop =
  | { kind: 'move' | 'stretch'; item: Item; from: Span; to: Span }
  | { kind: 'place'; task: ToPlaceDto; to: Span };

type DragHandlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
};

/** A drag in progress: nothing is written until the drop. */
interface Dragging {
  /** v0.36.0 « create »: a press or a drag on an empty slot. */
  kind: 'move' | 'stretch' | 'place' | 'create';
  item?: Item;
  task?: ToPlaceDto;
  from?: Span;
  x0: number;
  y0: number;
  /** The column the pointer started in (move). */
  col0: number;
  moved: boolean;
  preview: Span | null;
}

/** Past this many pixels, a press is a drag, not a click. */
const DRAG_PX = 4;

/** « À caser »: the tasks weighing on this week (late first), then those without a date (folded). */
export function ToPlace(props: {
  tasks: ToPlaceDto[];
  firstDay: string;
  lastDay: string;
  today: string;
  /** PC (v0.35.0): a task can be dragged to the grid. */
  dragProps?: (task: ToPlaceDto) => DragHandlers;
  /** The task being dragged (shown faded). */
  dragging?: string | null;
  /** True right after a drag (the click that follows is not an « open »). */
  wasDrag?: () => boolean;
  /** v0.36.0: a click opens the task's sheet here (else: the To-do). */
  onOpenTask?: (task: ToPlaceDto) => void;
  /** v0.41.0 (PC): the preview on hover. */
  hover?: Hover;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const dated = props.tasks.filter((t) => {
    const on = weighsOn(t.due, props.today);
    return on !== null && on >= props.firstDay && on <= props.lastDay;
  });
  const undated = props.tasks.filter((t) => t.due === null);
  const chip = (t: ToPlaceDto) => (
    <li key={t.id}>
      <button
        type="button"
        className={`ag-task${t.late ? ' ag-task--late' : ''}${props.dragProps ? ' ag-task--draggable' : ''}${props.dragging === t.id ? ' ag-block--dragging' : ''}`}
        // v0.41.0: the preview card replaces the native tooltip on the PC.
        title={
          props.hover
            ? undefined
            : props.dragProps
              ? 'Glisser dans la semaine pour la prévoir · clic : sa fiche'
              : props.onOpenTask
                ? 'Sa fiche'
                : 'Ouvrir dans la To-do'
        }
        onClick={() => {
          if (props.wasDrag?.()) return;
          if (props.onOpenTask) props.onOpenTask(t);
          else navigate(t.open);
        }}
        {...props.hover?.bind({ kind: 'task', task: t, draggable: Boolean(props.dragProps) })}
        {...withHide(props.dragProps?.(t), props.hover?.hide)}
      >
        <span className="ag-task__title">{t.title}</span>
        <span className="small muted">
          {t.due
            ? t.late
              ? `en retard (${dayLabel(t.due, props.today)})`
              : dayLabel(t.due, props.today)
            : ''}
          {t.estimateMin ? ` · ${formatDuration(t.estimateMin)}` : ' · sans durée'}
        </span>
      </button>
    </li>
  );
  return (
    <section className="ag-toplace" aria-label="À caser">
      <h2 className="ag-toplace__title">
        À caser <span className="small muted">(tâches de la To-do)</span>
      </h2>
      {dated.length === 0 && undated.length === 0 ? (
        <p className="small muted">Rien à caser cette semaine.</p>
      ) : (
        <ul className="ag-toplace__list">{dated.map(chip)}</ul>
      )}
      {undated.length > 0 && (
        <>
          <button type="button" className="ag-link small" onClick={() => setOpen(!open)}>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} /> Sans échéance ({undated.length})
          </button>
          {open && <ul className="ag-toplace__list">{undated.map(chip)}</ul>}
        </>
      )}
    </section>
  );
}

/** Below this height (px) a block is « short »: one line, the title first (30 min and 45 min are). */
export const SHORT_BLOCK_PX = 36;
/** Line height of a block's text (0.8rem × 1.2), to know how many lines of title fit. */
const LINE_PX = 15.4;
/** Inner margins (top + bottom) of a block, px. */
const BLOCK_PAD_PX = 4;

/** How many lines of title fit under the time line of a tall block (at least one). */
export const titleLines = (height: number) =>
  Math.max(1, Math.floor((height - BLOCK_PAD_PX - LINE_PX) / LINE_PX));

/** v0.40.0: what a ghost (move, stretch, create) says: « 08:15 – 09:00 · 45 min ». */
export const ghostLabel = (span: { start: string; end: string }) =>
  `${span.start.slice(11)} – ${span.end.slice(11)} · ${hoursText(minutesBetween(span.start, span.end))}`;

/** Below this height (px) the ghost's label sits under it (it would not fit inside). */
const GHOST_LABEL_INSIDE_PX = 22;

/**
 * v0.40.0: the ghost of a move, a stretch or a creation: the whole width of
 * its day column, and its time always readable — inside when it fits, else
 * just under it — updated at each snap.
 */
export function Ghost(props: {
  span: { start: string; end: string };
  top: number;
  height: number;
  category: string;
  className?: string;
}) {
  const height = Math.max(18, props.height);
  const inside = height >= GHOST_LABEL_INSIDE_PX;
  return (
    <span
      className={`ag-block ag-block--ghost${props.className ? ` ${props.className}` : ''}`}
      style={{ ...colorStyle(props.category), top: props.top, height }}
      aria-live="polite"
    >
      <span className={`ag-ghost__label${inside ? '' : ' ag-ghost__label--below'}`}>
        {ghostLabel(props.span)}
      </span>
    </span>
  );
}

/**
 * A block in the grid (own: its detail; a planned task: its panel; another
 * module's: opens it there). v0.38.0: no control on the block (a task is
 * ticked in its panel); the TITLE first: a short block is one line « Title
 * [icons] time », the time only when there is room (else in the tooltip); a
 * tall one shows the time, then the title on the lines left, « … » when it
 * does not fit. Never a smaller font: the room comes from the margins.
 */
/** v0.41.0: the hover preview of the week, given to its blocks and tasks (PC). */
type Hover = Pick<ReturnType<typeof useHoverPreview>, 'bind' | 'hide'> & {
  toolName: (moduleId: string) => string | null;
};

/** Drag handlers whose pointer down also hides the preview (a click, a drag that starts). */
function withHide(handlers: DragHandlers | undefined, hide: (() => void) | undefined) {
  if (!hide) return handlers ?? {};
  return {
    ...handlers,
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      hide();
      handlers?.onPointerDown(e);
    },
  };
}

export function Block(props: {
  item: Item;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  overlaps: boolean;
  dragging: boolean;
  onOpen: (item: Item) => void;
  wasDrag: () => boolean;
  drag?: (kind: 'move' | 'stretch') => DragHandlers;
  /** v0.36.0: its timer runs now. */
  running?: boolean;
  /** v0.41.0 (PC): the preview on hover; its text is the block's aria-label. */
  hover?: Hover;
  /** v0.41.0: the day the preview counts from (« demain »…); the aria-label is written with it. */
  today?: string;
}) {
  const { item } = props;
  const e = item.event;
  const task = item.source === 'task' ? item.event : null;
  const canMove = Boolean(props.drag);
  const height = Math.max(18, props.height);
  const short = height < SHORT_BLOCK_PX;
  // « Prévue après son échéance » no longer matters once the task is done.
  const late = Boolean(task?.afterDue && !task.done);
  // v0.40.0: « facultatif »: shown, dimmed and hatched, never a conflict.
  const optional = isOptional(item);
  // v0.41.0: « Titre · Lieu » (display only); the place is cut (« … ») before the title.
  const place = placeOf(item);
  const placeText = place ? <span className="ag-block__place"> · {shortPlace(place)}</span> : null;
  const icons = (
    <>
      {props.running && (
        <span className="ag-block__timer" title="Son timer tourne">
          <Icon name="timer" />
        </span>
      )}
      {(props.overlaps || late) && (
        <span className="ag-block__warn">
          <Icon name="warning" />
        </span>
      )}
    </>
  );
  return (
    <div
      className={`ag-block${short ? ' ag-block--short' : ''}${props.overlaps ? ' ag-block--overlap' : ''}${item.source === 'foreign' ? ' ag-block--foreign ag-block--fixed' : ''}${task ? ' ag-block--task' : ''}${task?.done ? ' ag-block--done' : ''}${optional ? ' ag-block--optional' : ''}${canMove ? ' ag-block--movable' : ''}${props.dragging ? ' ag-block--dragging' : ''}`}
      style={{
        ...colorStyle(e.category),
        top: props.top,
        height,
        left: `${(props.lane / props.lanes) * 100}%`,
        width: `${100 / props.lanes}%`,
      }}
    >
      <button
        type="button"
        className="ag-block__body"
        // v0.41.0: no native tooltip (the preview card says it all); the whole text for a screen reader.
        aria-label={previewText(
          previewOf(
            { kind: 'item', item, overlaps: props.overlaps, movable: canMove },
            props.today ?? e.start.slice(0, 10),
            props.hover?.toolName,
          ),
        )}
        onClick={() => {
          if (!props.wasDrag()) props.onOpen(item);
        }}
        {...props.hover?.bind({ kind: 'item', item, overlaps: props.overlaps, movable: canMove })}
        {...withHide(props.drag?.('move'), props.hover?.hide)}
      >
        {short ? (
          <>
            <span className="ag-block__head">
              <span className="ag-block__title">
                {e.title}
                {placeText}
              </span>
              {icons}
            </span>
            <span className="ag-block__time">{e.start.slice(11)}</span>
          </>
        ) : (
          <>
            <span className="ag-block__time">
              {e.start.slice(11)}
              {icons}
            </span>
            <span
              className="ag-block__title ag-block__title--lines"
              style={{ WebkitLineClamp: titleLines(height) }}
            >
              {e.title}
              {placeText}
            </span>
          </>
        )}
      </button>
      {canMove && (
        <span
          className="ag-block__stretch"
          aria-hidden="true"
          title="Tirer pour changer la durée"
          {...props.drag?.('stretch')}
        />
      )}
    </div>
  );
}

export function WeekView(props: {
  data: RangeDto;
  monday: string;
  shown: (category: string) => boolean;
  onOpen: (item: Item) => void;
  /** PC: a drop (one write by the page, with « Annuler »). */
  onDrop?: (drop: Drop) => void;
  /** v0.36.0: a task « à caser » clicked: its sheet. */
  onOpenTask?: (task: ToPlaceDto) => void;
  /** v0.36.0: create in an empty slot (« Tâche » or « Rendez-vous »), one write after the choice. */
  onCreate?: (kind: SlotKind, title: string, span: Span) => Promise<void>;
}) {
  const { data, monday } = props;
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sunday = days[6]!;
  const range = { startHour: data.dayStartHour, endHour: data.dayEndHour };
  // Only what is switched on is counted (load, free time, overlaps).
  const summary = weekSummary(
    monday,
    7,
    timedBlocks(data, props.shown),
    taskLoads(data, props.shown),
    range,
    data.today,
  );
  const tasksOn = props.shown(TASKS_CATEGORY);
  const items = itemsOf(data, props.shown);
  const allDay = items.filter((i) => i.event.allDay);
  const timed = items.filter((i) => !i.event.allDay);
  const height = (range.endHour - range.startHour) * HOUR_PX;
  const hours = Array.from(
    { length: range.endHour - range.startHour },
    (_, i) => range.startHour + i,
  );

  // --- Drag and drop -----------------------------------------------------------
  const columns = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<Dragging | null>(null);
  const [drag, setDrag] = useState<Dragging | null>(null);
  /** The click right after a drag is not an « open ». */
  const justDragged = useRef(false);
  const wasDrag = () => {
    const was = justDragged.current;
    justDragged.current = false;
    return was;
  };
  const update = (next: Dragging | null) => {
    dragRef.current = next;
    setDrag(next);
  };
  // Échap cancels (nothing was written).
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (dragRef.current?.moved) justDragged.current = true;
      update(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

  /** The column under x (clamped to the week when `clamp`), and its rectangle. */
  const columnAt = (x: number, clamp: boolean) => {
    const rects = columns.current.map((c) => c?.getBoundingClientRect() ?? null);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r && x >= r.left && x < r.right) return { index: i, rect: r };
    }
    if (!clamp) return null;
    const first = rects[0];
    const index = first && x < first.left ? 0 : 6;
    return rects[index] ? { index, rect: rects[index] } : null;
  };
  const minutesAt = (y: number, rect: DOMRect) =>
    range.startHour * 60 + ((y - rect.top) / HOUR_PX) * 60;

  const preview = (d: Dragging, x: number, y: number): Span | null => {
    if (d.kind === 'create') {
      const rect = columns.current[d.col0]?.getBoundingClientRect();
      if (!rect) return null;
      return slotSpan(days[d.col0]!, minutesAt(d.y0, rect), minutesAt(y, rect));
    }
    if (d.kind === 'place') {
      const col = columnAt(x, false);
      if (!col || y < col.rect.top || y > col.rect.bottom) return null;
      return placeSpan(days[col.index]!, minutesAt(y, col.rect), d.task!.estimateMin);
    }
    const deltaMin = ((y - d.y0) / HOUR_PX) * 60;
    if (d.kind === 'stretch') return stretchSpan(d.from!, deltaMin);
    const col = columnAt(x, true);
    return moveSpan(d.from!, (col?.index ?? d.col0) - d.col0, deltaMin);
  };

  const handlers = (start: () => Omit<Dragging, 'x0' | 'y0' | 'col0' | 'moved' | 'preview'>) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const begin = start();
      if (begin.kind === 'create' ? !props.onCreate : !props.onDrop) return;
      // Create: only on the empty background of a day, never through a block.
      if (begin.kind === 'create' && e.target !== e.currentTarget) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setCreating(null);
      update({
        ...begin,
        x0: e.clientX,
        y0: e.clientY,
        col0: columnAt(e.clientX, true)?.index ?? 0,
        moved: false,
        preview: null,
      });
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > DRAG_PX;
      if (!moved) return;
      update({ ...d, moved, preview: preview(d, e.clientX, e.clientY) });
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      e.stopPropagation();
      update(null);
      if (d.kind === 'create') {
        // A click: 30 min from that quarter; a drag: the slot covered. Nothing written yet.
        const rect = columns.current[d.col0]?.getBoundingClientRect();
        const span =
          d.moved && d.preview
            ? d.preview
            : rect
              ? slotSpan(days[d.col0]!, minutesAt(d.y0, rect), null)
              : null;
        if (span) setCreating(span);
        return;
      }
      if (!d.moved) return; // a click: the button's onClick opens it
      justDragged.current = true;
      const to = d.preview;
      // Dropped outside the grid, or where it was: nothing to write.
      if (!to) return;
      if (d.kind === 'place') props.onDrop?.({ kind: 'place', task: d.task!, to });
      else if (!sameSpan(to, d.from!))
        props.onDrop?.({ kind: d.kind, item: d.item!, from: d.from!, to });
    },
    onPointerCancel: () => update(null),
  });

  const blockDrag = (item: Item) =>
    props.onDrop && movable(item)
      ? (kind: 'move' | 'stretch') =>
          handlers(() => ({
            kind,
            item,
            from: { start: item.event.start, end: item.event.end },
          }))
      : undefined;
  const placeDrag = props.onDrop
    ? (task: ToPlaceDto) => handlers(() => ({ kind: 'place' as const, task }))
    : undefined;
  const createDrag = props.onCreate
    ? () => handlers(() => ({ kind: 'create' as const }))
    : undefined;
  const [creating, setCreating] = useState<Span | null>(null);
  // v0.41.0: the preview on hover (PC; never during a drag, nor while creating).
  const toolName = useModuleNames();
  const hoverPreview = useHoverPreview({
    today: data.today,
    disabled: onPhone() || Boolean(drag),
    toolName,
  });
  const hover: Hover | undefined = onPhone()
    ? undefined
    : { bind: hoverPreview.bind, hide: hoverPreview.hide, toolName };
  const draggingId = drag?.moved ? (drag.item ? itemId(drag.item) : (drag.task?.id ?? null)) : null;

  return (
    <>
      <p className="ag-summary">
        <strong>{hoursText(summary.freeMin)} de libre</strong>
        {data.todo && tasksOn && (
          <>
            {' · '}
            <strong>{hoursText(summary.toPlaceMin)} à caser</strong>
            {summary.tasksWithoutEstimate > 0 &&
              ` · + ${summary.tasksWithoutEstimate} tâche${summary.tasksWithoutEstimate > 1 ? 's' : ''} sans durée`}
          </>
        )}
        <span className="small muted">
          {' '}
          (de {range.startHour} h à {range.endHour} h chaque jour
          {offText(switchCategories(data), props.shown)})
        </span>
      </p>
      {data.todo && tasksOn && (
        <ToPlace
          tasks={data.toPlace}
          firstDay={monday}
          lastDay={sunday}
          today={data.today}
          dragProps={placeDrag}
          dragging={draggingId}
          wasDrag={wasDrag}
          onOpenTask={props.onOpenTask}
          hover={hover}
        />
      )}
      <div
        className={`ag-week${drag?.moved ? ' ag-week--dragging' : ''}`}
        style={{ '--ag-days': 7 } as React.CSSProperties}
      >
        <div className="ag-week__corner" />
        {days.map((d) => (
          <div
            key={d}
            className={`ag-week__head${d === data.today ? ' ag-week__head--today' : ''}`}
          >
            {dayLabel(d, data.today)}
          </div>
        ))}
        {/* All day and several days: bands over their days. */}
        <div className="ag-week__allday-label small muted">Journée</div>
        <div className="ag-week__allday">
          {allDay.map((i) => {
            const first = i.event.start.slice(0, 10) < monday ? monday : i.event.start.slice(0, 10);
            const last = i.event.end.slice(0, 10) > sunday ? sunday : i.event.end.slice(0, 10);
            return (
              <button
                key={itemId(i)}
                type="button"
                className={`ag-band${i.source === 'foreign' ? ' ag-block--foreign' : ''}`}
                style={{
                  ...colorStyle(i.event.category),
                  gridColumn: `${daysBetween(monday, first) + 1} / ${daysBetween(monday, last) + 2}`,
                }}
                title={hover ? undefined : `${i.event.title} · ${i.event.category}`}
                aria-label={previewText(previewOf({ kind: 'item', item: i }, data.today, toolName))}
                onClick={() => props.onOpen(i)}
                {...hover?.bind({ kind: 'item', item: i })}
                onPointerDown={hover?.hide}
              >
                {i.event.start.slice(0, 10) < monday && '← '}
                {i.event.title}
                {i.event.end.slice(0, 10) > sunday && ' →'}
              </button>
            );
          })}
        </div>
        <div className="ag-week__hours" style={{ height }}>
          {hours.map((h) => (
            <span
              key={h}
              className="ag-hour small muted"
              style={{ top: (h - range.startHour) * HOUR_PX }}
            >
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {days.map((d, index) => {
          const mine = timed.filter(
            (i) => i.event.start.slice(0, 10) <= d && i.event.end.slice(0, 10) >= d,
          );
          const placed = placeDay(
            d,
            mine.map((i) => ({
              id: itemId(i),
              start: i.event.start,
              end: i.event.end,
              category: i.event.category,
              optional: isOptional(i),
            })),
          );
          const ghost =
            drag?.moved && drag.preview && drag.preview.start.slice(0, 10) === d
              ? drag.preview
              : null;
          const ghostCategory = drag?.item?.event.category ?? 'Tâches';
          const slot = creating && creating.start.slice(0, 10) === d ? creating : null;
          return (
            <div
              key={d}
              ref={(el) => {
                columns.current[index] = el;
              }}
              className={`ag-week__day${d === data.today ? ' ag-week__day--today' : ''}${createDrag ? ' ag-week__day--creatable' : ''}`}
              style={{ height, backgroundSize: `100% ${HOUR_PX}px` }}
              title={createDrag ? 'Clic ou glisser sur un créneau vide : créer ici' : undefined}
              {...createDrag?.()}
            >
              {placed.map((p) => {
                const item = mine.find((i) => itemId(i) === p.id)!;
                const from = Math.max(p.from, range.startHour * 60);
                const to = Math.min(p.to, range.endHour * 60);
                if (to <= from) return null;
                return (
                  <Block
                    key={p.id}
                    item={item}
                    top={((from - range.startHour * 60) / 60) * HOUR_PX}
                    height={((to - from) / 60) * HOUR_PX - 2}
                    lane={p.lane}
                    lanes={p.lanes}
                    overlaps={p.overlaps}
                    dragging={draggingId === p.id}
                    onOpen={props.onOpen}
                    wasDrag={wasDrag}
                    drag={blockDrag(item)}
                    running={timerRuns(data, item)}
                    hover={hover}
                    today={data.today}
                  />
                );
              })}
              {slot && props.onCreate && (
                <>
                  <Ghost
                    className="ag-slot"
                    span={slot}
                    category="Tâches"
                    top={
                      ((minutesOfDay(slot.start.slice(11)) - range.startHour * 60) / 60) * HOUR_PX
                    }
                    height={(minutesBetween(slot.start, slot.end) / 60) * HOUR_PX - 2}
                  />
                  <CreateSlot
                    key={slot.start + slot.end}
                    span={slot}
                    today={data.today}
                    todo={data.todo}
                    className={`ag-create--week${index >= 5 ? ' ag-create--left' : ''}`}
                    style={{
                      top:
                        ((minutesOfDay(slot.start.slice(11)) - range.startHour * 60) / 60) *
                          HOUR_PX +
                        Math.max(18, (minutesBetween(slot.start, slot.end) / 60) * HOUR_PX),
                    }}
                    onCancel={() => setCreating(null)}
                    onSubmit={async (kind, title) => {
                      await props.onCreate!(kind, title, slot);
                      setCreating(null);
                    }}
                  />
                </>
              )}
              {ghost && (
                <Ghost
                  span={ghost}
                  category={ghostCategory}
                  top={
                    ((minutesOfDay(ghost.start.slice(11)) - range.startHour * 60) / 60) * HOUR_PX
                  }
                  height={
                    ((Math.min(
                      minutesOfDay(ghost.start.slice(11)) + minutesBetween(ghost.start, ghost.end),
                      range.endHour * 60,
                    ) -
                      minutesOfDay(ghost.start.slice(11))) /
                      60) *
                      HOUR_PX -
                    2
                  }
                />
              )}
              {d === data.today && <NowLine startHour={range.startHour} endHour={range.endHour} />}
            </div>
          );
        })}
        <div className="ag-week__corner small muted">Charge</div>
        {summary.days.map((load) => (
          <LoadBar key={load.day} load={load} />
        ))}
      </div>
      {drag?.moved && (
        <p className="small muted ag-drag-hint" role="status">
          {drag.preview
            ? `${dayLabel(drag.preview.start.slice(0, 10), data.today)} ${spanLabel(drag.preview)}`
            : 'Lâche sur la grille pour prévoir la tâche'}{' '}
          · Échap pour annuler
        </p>
      )}
      {hoverPreview.card}
    </>
  );
}

/** Where now is in today's column. */
function NowLine(props: { startHour: number; endHour: number }) {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < props.startHour * 60 || minutes >= props.endHour * 60) return null;
  return (
    <span
      className="ag-now"
      style={{ top: ((minutes - props.startHour * 60) / 60) * HOUR_PX }}
      aria-hidden="true"
    />
  );
}
