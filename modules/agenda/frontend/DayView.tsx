// The phone's view: one day at a time (a swipe or the arrows change it):
// the all-day and several-day items in bands, then the timed ones in order,
// « à caser », and the day's load. The PC has the week (WeekView).
import { useRef } from 'react';
import { Button, Icon } from '@hub/sdk/frontend';
import { formatDuration } from '@hub/sdk/dates';
import { dayLoad, placeDay, weighsOn } from '../shared/load';
import { addDays, dayLabel } from '../shared/time';
import type { RangeDto } from '../shared/types';
import { colorStyle, itemId, itemsOf, taskLoads, timedBlocks, type Item } from './common';
import { LoadBar } from './WeekView';
import { useNavigate } from 'react-router';

export function DayView(props: {
  data: RangeDto;
  day: string;
  shown: (category: string) => boolean;
  onDay: (day: string) => void;
  onOpen: (item: Item) => void;
}) {
  const { data, day } = props;
  const navigate = useNavigate();
  const touch = useRef<{ x: number; y: number } | null>(null);
  const range = { startHour: data.dayStartHour, endHour: data.dayEndHour };
  const items = itemsOf(data, props.shown).filter(
    (i) => i.event.start.slice(0, 10) <= day && i.event.end.slice(0, 10) >= day,
  );
  const bands = items.filter((i) => i.event.allDay);
  const timed = items.filter((i) => !i.event.allDay);
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
  const load = dayLoad(day, timedBlocks(data), taskLoads(data), range, data.today);
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
      {timed.length === 0 && bands.length === 0 ? (
        <p className="muted">Rien de prévu ce jour-là.</p>
      ) : (
        <ul className="ag-list">
          {timed.map((i) => (
            <li key={itemId(i)}>
              <button
                type="button"
                className="ag-list__item"
                style={colorStyle(i.event.category)}
                onClick={() => props.onOpen(i)}
              >
                <span className="ag-list__time">
                  {i.event.start.slice(0, 10) === day ? i.event.start.slice(11) : '…'}–
                  {i.event.end.slice(0, 10) === day ? i.event.end.slice(11) : '…'}
                </span>
                <span className="ag-list__title">{i.event.title}</span>
                <span className="small muted">
                  {i.event.category}
                  {overlapping.has(itemId(i)) && (
                    <>
                      {' · '}
                      <Icon name="warning" /> chevauche un autre élément
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.todo && (due.length > 0 || undated.length > 0) && (
        <section className="ag-toplace" aria-label="À caser">
          <h2 className="ag-toplace__title">À caser</h2>
          <ul className="ag-toplace__list">
            {[...due, ...undated].map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`ag-task${t.late ? ' ag-task--late' : ''}`}
                  onClick={() => navigate(t.open)}
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
