// The phone's view: one day at a time (a swipe or the arrows change it):
// the all-day and several-day items in bands, then the timed ones in order,
// « à caser », and the day's load. The PC has the week (WeekView).
// v0.36.0: the free slots are listed between them; a tap creates there
// (« Tâche » or « Rendez-vous »); a task can be ticked from its line.
import { useRef, useState } from 'react';
import { Button, Icon } from '@hub/sdk/frontend';
import { formatDuration } from '@hub/sdk/dates';
import { dayLoad, freeGaps, placeDay, TASKS_CATEGORY, weighsOn } from '../shared/load';
import { slotSpan, type Span } from '../shared/drag';
import { addDays, dayLabel, minutesOfDay, timeOf } from '../shared/time';
import type { RangeDto, ToPlaceDto } from '../shared/types';
import { CreateSlot, type SlotKind } from './CreateSlot';
import {
  colorStyle,
  itemId,
  itemsOf,
  taskLoads,
  timedBlocks,
  timerRuns,
  type Item,
} from './common';
import { LoadBar } from './WeekView';
import { useNavigate } from 'react-router';

export function DayView(props: {
  data: RangeDto;
  day: string;
  shown: (category: string) => boolean;
  onDay: (day: string) => void;
  onOpen: (item: Item) => void;
  /** v0.36.0: tick a task from its line. */
  onTick?: (item: Item, done: boolean) => void;
  /** v0.36.0: a task « à caser » touched: its sheet. */
  onOpenTask?: (task: ToPlaceDto) => void;
  /** v0.36.0: create in a free slot, after the choice. */
  onCreate?: (kind: SlotKind, title: string, span: Span) => Promise<void>;
}) {
  const { data, day } = props;
  const [slot, setSlot] = useState<Span | null>(null);
  const navigate = useNavigate();
  const touch = useRef<{ x: number; y: number } | null>(null);
  const range = { startHour: data.dayStartHour, endHour: data.dayEndHour };
  const items = itemsOf(data, props.shown).filter(
    (i) => i.event.start.slice(0, 10) <= day && i.event.end.slice(0, 10) >= day,
  );
  const bands = items.filter((i) => i.event.allDay);
  const timed = items.filter((i) => !i.event.allDay);
  // The timed items and (v0.36.0) the free slots, in the order of the day.
  type Row =
    | { kind: 'item'; at: number; item: Item }
    | { kind: 'gap'; at: number; from: number; to: number };
  const rows: Row[] = [
    ...timed.map((item): Row => ({
      kind: 'item',
      at: item.event.start.slice(0, 10) < day ? -1 : minutesOfDay(item.event.start.slice(11)),
      item,
    })),
    ...(props.onCreate
      ? freeGaps(day, timedBlocks(data, props.shown), range).map((g): Row => ({
          kind: 'gap',
          at: g.from,
          from: g.from,
          to: g.to,
        }))
      : []),
  ].sort((a, b) => a.at - b.at);
  const overlapping = new Set(
    placeDay(
      day,
      timed.map((i) => ({
        id: itemId(i),
        start: i.event.start,
        end: i.event.end,
        category: i.event.category,
      })),
    )
      .filter((p) => p.overlaps)
      .map((p) => p.id),
  );
  const load = dayLoad(
    day,
    timedBlocks(data, props.shown),
    taskLoads(data, props.shown),
    range,
    data.today,
  );
  const due = data.toPlace.filter((t) => weighsOn(t.due, data.today) === day);
  const undated = data.toPlace.filter((t) => t.due === null);
  return (
    <div
      className="ag-day"
      onTouchStart={(e) => {
        const t = e.touches[0]!;
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        const t = e.changedTouches[0];
        if (!start || !t) return;
        const dx = t.clientX - start.x;
        // A horizontal swipe (not a scroll): the next or previous day.
        if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(t.clientY - start.y))
          props.onDay(addDays(day, dx < 0 ? 1 : -1));
      }}
    >
      <div className="ag-day__nav">
        <Button
          small
          variant="secondary"
          aria-label="Jour précédent"
          onClick={() => props.onDay(addDays(day, -1))}
        >
          ‹
        </Button>
        <strong
          className={day === data.today ? 'ag-day__title ag-day__title--today' : 'ag-day__title'}
        >
          {day === data.today ? 'Aujourd’hui · ' : ''}
          {dayLabel(day, data.today)}
        </strong>
        <Button
          small
          variant="secondary"
          aria-label="Jour suivant"
          onClick={() => props.onDay(addDays(day, 1))}
        >
          ›
        </Button>
      </div>
      {day !== data.today && (
        <button type="button" className="ag-link small" onClick={() => props.onDay(data.today)}>
          Revenir à aujourd’hui
        </button>
      )}
      <LoadBar load={load} />
      {bands.map((i) => (
        <button
          key={itemId(i)}
          type="button"
          className="ag-band"
          style={colorStyle(i.event.category)}
          onClick={() => props.onOpen(i)}
        >
          {i.event.title}
          {i.event.start.slice(0, 10) !== i.event.end.slice(0, 10) &&
            ` (jusqu’au ${dayLabel(i.event.end.slice(0, 10), data.today)})`}
        </button>
      ))}
      {timed.length === 0 && bands.length === 0 && !props.onCreate && (
        <p className="muted">Rien de prévu ce jour-là.</p>
      )}
      <ul className="ag-list">
        {rows.map((row) =>
          row.kind === 'gap' ? (
            <li key={`gap:${row.from}`}>
              {slot && slot.start === `${day}T${timeOf(row.from)}` ? (
                <CreateSlot
                  span={slot}
                  today={data.today}
                  todo={data.todo}
                  onCancel={() => setSlot(null)}
                  onSubmit={async (kind, title) => {
                    await props.onCreate!(kind, title, slot);
                    setSlot(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="ag-gap"
                  title="Toucher pour créer ici"
                  onClick={() => setSlot(slotSpan(day, row.from, Math.min(row.to, row.from + 30)))}
                >
                  <span className="ag-list__time">
                    {timeOf(row.from)}–{timeOf(row.to)}
                  </span>
                  <span className="small muted">
                    Libre · <Icon name="plus" /> créer ici
                  </span>
                </button>
              )}
            </li>
          ) : (
            <li key={itemId(row.item)} className="ag-list__row">
              {row.item.source === 'task' && props.onTick && (
                <input
                  type="checkbox"
                  className="ag-list__check"
                  checked={row.item.event.done}
                  aria-label={
                    row.item.event.done
                      ? `Marquer « ${row.item.event.title} » à faire`
                      : `Cocher « ${row.item.event.title} »`
                  }
                  onChange={(e) => props.onTick!(row.item, e.target.checked)}
                />
              )}
              <button
                type="button"
                className="ag-list__item"
                style={colorStyle(row.item.event.category)}
                onClick={() => props.onOpen(row.item)}
              >
                <span className="ag-list__time">
                  {timerRuns(data, row.item) && (
                    <span className="ag-block__timer" title="Son timer tourne">
                      <Icon name="timer" />{' '}
                    </span>
                  )}
                  {row.item.event.start.slice(0, 10) === day ? row.item.event.start.slice(11) : '…'}
                  –{row.item.event.end.slice(0, 10) === day ? row.item.event.end.slice(11) : '…'}
                </span>
                <span
                  className={`ag-list__title${row.item.source === 'task' && row.item.event.done ? ' ag-done' : ''}`}
                >
                  {row.item.event.title}
                </span>
                <span className="small muted">
                  {row.item.event.category}
                  {overlapping.has(itemId(row.item)) && (
                    <>
                      {' · '}
                      <Icon name="warning" /> chevauche un autre élément
                    </>
                  )}
                </span>
              </button>
            </li>
          ),
        )}
      </ul>
      {data.todo && props.shown(TASKS_CATEGORY) && (due.length > 0 || undated.length > 0) && (
        <section className="ag-toplace" aria-label="À caser">
          <h2 className="ag-toplace__title">À caser</h2>
          <ul className="ag-toplace__list">
            {[...due, ...undated].map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`ag-task${t.late ? ' ag-task--late' : ''}`}
                  onClick={() => (props.onOpenTask ? props.onOpenTask(t) : navigate(t.open))}
                >
                  <span className="ag-task__title">{t.title}</span>
                  <span className="small muted">
                    {t.late ? 'en retard · ' : t.due ? '' : 'sans échéance · '}
                    {t.estimateMin ? formatDuration(t.estimateMin) : 'sans durée'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
