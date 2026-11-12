// The month, light: what each day holds (the events over several days shown
// on each of their days, to see a camp or the exams at a glance). A click on
// a day opens its week; on an item, its detail (or its module).
import { addDays, dayLabel, MONTHS, weekday } from '../shared/time';
import type { RangeDto } from '../shared/types';
import { colorStyle, itemId, itemsOf, type Item } from './common';

const HEADS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

/** The first and last days drawn for a month (whole weeks, Monday to Sunday). */
export function monthGrid(month: string): { from: string; to: string } {
  const first = `${month}-01`;
  const from = addDays(first, -weekday(first));
  const next =
    month.slice(5) === '12'
      ? `${Number(month.slice(0, 4)) + 1}-01-01`
      : `${month.slice(0, 4)}-${String(Number(month.slice(5)) + 1).padStart(2, '0')}-01`;
  const last = addDays(next, -1);
  return { from, to: addDays(last, 6 - weekday(last)) };
}

export function monthTitle(month: string): string {
  const name = MONTHS[Number(month.slice(5)) - 1]!;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${month.slice(0, 4)}`;
}

export function MonthView(props: {
  data: RangeDto;
  month: string;
  shown: (category: string) => boolean;
  onOpen: (item: Item) => void;
  onDay: (day: string) => void;
}) {
  const { data, month } = props;
  const { from, to } = monthGrid(month);
  const items = itemsOf(data, props.shown);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return (
    <div className="ag-month">
      {HEADS.map((h) => (
        <div key={h} className="ag-month__head small muted">
          {h}
        </div>
      ))}
      {days.map((d) => {
        const of = items.filter(
          (i) => i.event.start.slice(0, 10) <= d && i.event.end.slice(0, 10) >= d,
        );
        const other = d.slice(0, 7) !== month;
        return (
          <div
            key={d}
            className={`ag-month__day${other ? ' ag-month__day--other' : ''}${d === data.today ? ' ag-month__day--today' : ''}`}
          >
            <button
              type="button"
              className="ag-month__num"
              title={`Semaine du ${dayLabel(d, data.today)}`}
              onClick={() => props.onDay(d)}
            >
              {Number(d.slice(8))}
            </button>
            <ul className="ag-month__items">
              {of.slice(0, 4).map((i) => (
                <li key={itemId(i)}>
                  <button
                    type="button"
                    className={`ag-chip${i.event.allDay ? ' ag-chip--allday' : ''}`}
                    style={colorStyle(i.event.category)}
                    title={`${i.event.title} · ${i.event.category}`}
                    onClick={() => props.onOpen(i)}
                  >
                    {!i.event.allDay && i.event.start.slice(0, 10) === d && (
                      <span className="ag-chip__time">{i.event.start.slice(11)}</span>
                    )}
                    {i.event.title}
                  </button>
                </li>
              ))}
              {of.length > 4 && (
                <li className="small muted">
                  <button type="button" className="ag-link" onClick={() => props.onDay(d)}>
                    + {of.length - 4} autre{of.length > 5 ? 's' : ''}
                  </button>
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
