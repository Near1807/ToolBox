// The week (PC): a column per day, the hours of the day's range, blocks
// coloured by category; on top the all-day and several-day items in bands
// and « À caser » (the To-do's tasks due this week, by due date, then those
// without a date, folded); under each day its load bar by category and a
// state; « X h de libre · Y h à caser »; overlaps flagged; layers.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon, StateBadge } from '@hub/sdk/frontend';
import { formatDuration } from '@hub/sdk/dates';
import { categoryColor } from '../shared/categories';
import { placeDay, weekSummary, weighsOn, type DayLoad } from '../shared/load';
import { addDays, dayLabel, daysBetween, hoursText } from '../shared/time';
import type { RangeDto, ToPlaceDto } from '../shared/types';
import { colorStyle, itemId, itemsOf, taskLoads, timedBlocks, type Item } from './common';

const HOUR_PX = 44;

const STATE_TONE = { léger: 'success', chargé: 'warning', saturé: 'danger' } as const;

export function Layers(props: {
  categories: string[];
  hidden: string[];
  onToggle: (category: string) => void;
}) {
  if (props.categories.length === 0) return null;
  return (
    <div className="ag-layers" role="group" aria-label="Calques">
      <span className="small muted">Calques :</span>
      {props.categories.map((c) => {
        const on = !props.hidden.includes(c);
        return (
          <button
            key={c}
            type="button"
            className={`ag-layer${on ? '' : ' ag-layer--off'}`}
            style={colorStyle(c)}
            aria-pressed={on}
            title={on ? `Masquer « ${c} »` : `Afficher « ${c} »`}
            onClick={() => props.onToggle(c)}
          >
            <span className="ag-dot" aria-hidden="true" />
            {c}
          </button>
        );
      })}
    </div>
  );
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

/** « À caser »: the tasks weighing on this week (late first), then those without a date (folded). */
export function ToPlace(props: {
  tasks: ToPlaceDto[];
  firstDay: string;
  lastDay: string;
  today: string;
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
        className={`ag-task${t.late ? ' ag-task--late' : ''}`}
        title="Ouvrir dans la To-do"
        onClick={() => navigate(t.open)}
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

/** A block in the grid (own: its detail; another module's: opens it there). */
function Block(props: {
  item: Item;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  overlaps: boolean;
  onOpen: (item: Item) => void;
}) {
  const { item } = props;
  const e = item.event;
  return (
    <button
      type="button"
      className={`ag-block${props.height < 34 ? ' ag-block--short' : ''}${props.overlaps ? ' ag-block--overlap' : ''}${item.source === 'foreign' ? ' ag-block--foreign' : ''}`}
      style={{
        ...colorStyle(e.category),
        top: props.top,
        height: Math.max(18, props.height),
        left: `${(props.lane / props.lanes) * 100}%`,
        width: `${100 / props.lanes}%`,
      }}
      title={`${e.title}\n${e.start.slice(11)}–${e.end.slice(11)} · ${e.category}${props.overlaps ? '\nChevauche un autre élément' : ''}`}
      onClick={() => props.onOpen(item)}
    >
      <span className="ag-block__time">
        {e.start.slice(11)}
        {props.overlaps && <Icon name="warning" />}
      </span>
      <span className="ag-block__title">{e.title}</span>
    </button>
  );
}

export function WeekView(props: {
  data: RangeDto;
  monday: string;
  shown: (category: string) => boolean;
  onOpen: (item: Item) => void;
}) {
  const { data, monday } = props;
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sunday = days[6]!;
  const range = { startHour: data.dayStartHour, endHour: data.dayEndHour };
  const summary = weekSummary(monday, 7, timedBlocks(data), taskLoads(data), range, data.today);
  const items = itemsOf(data, props.shown);
  const allDay = items.filter((i) => i.event.allDay);
  const timed = items.filter((i) => !i.event.allDay);
  const height = (range.endHour - range.startHour) * HOUR_PX;
  const hours = Array.from(
    { length: range.endHour - range.startHour },
    (_, i) => range.startHour + i,
  );

  return (
    <>
      <p className="ag-summary">
        <strong>{hoursText(summary.freeMin)} de libre</strong>
        {data.todo && (
          <>
            {' · '}
            <strong>{hoursText(summary.toPlaceMin)} à caser</strong>
            {summary.tasksWithoutEstimate > 0 &&
              ` · + ${summary.tasksWithoutEstimate} tâche${summary.tasksWithoutEstimate > 1 ? 's' : ''} sans durée`}
          </>
        )}
        <span className="small muted">
          {' '}
          (de {range.startHour} h à {range.endHour} h chaque jour)
        </span>
      </p>
      {data.todo && (
        <ToPlace tasks={data.toPlace} firstDay={monday} lastDay={sunday} today={data.today} />
      )}
      <div className="ag-week" style={{ '--ag-days': 7 } as React.CSSProperties}>
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
                title={`${i.event.title} · ${i.event.category}`}
                onClick={() => props.onOpen(i)}
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
        {days.map((d) => {
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
            })),
          );
          return (
            <div
              key={d}
              className={`ag-week__day${d === data.today ? ' ag-week__day--today' : ''}`}
              style={{ height, backgroundSize: `100% ${HOUR_PX}px` }}
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
                    onOpen={props.onOpen}
                  />
                );
              })}
              {d === data.today && <NowLine startHour={range.startHour} endHour={range.endHour} />}
            </div>
          );
        })}
        <div className="ag-week__corner small muted">Charge</div>
        {summary.days.map((load) => (
          <LoadBar key={load.day} load={load} />
        ))}
      </div>
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
