// Month and week views of every planned element, all tracks together.
// Dropping an element on another day moves it (YouTube: publishAt updated).
import { useState, type DragEvent } from 'react';
import { addDays, monthGrid, monthTitle, shortDate, SHORT_DAYS, startOfWeek } from './dates';
import { ItemChip } from './ItemParts';
import type { PlannerItem } from './types';

export type CalendarView = 'month' | 'week';

function DayCell(props: {
  date: string;
  today: string;
  items: PlannerItem[];
  outside?: boolean;
  tall?: boolean;
  onOpen: (item: PlannerItem) => void;
  onMove: (itemId: number, date: string) => void;
}) {
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) =>
    event.dataTransfer.types.includes('application/x-toolbox-planner-item');
  return (
    <div
      className={[
        'rp-day',
        props.outside ? 'rp-day--outside' : '',
        props.date === props.today ? 'rp-day--today' : '',
        props.date < props.today ? 'rp-day--past' : '',
        over ? 'rp-day--over' : '',
        props.tall ? 'rp-day--tall' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const id = Number(event.dataTransfer.getData('application/x-toolbox-planner-item'));
        if (id) {
          event.preventDefault();
          props.onMove(id, props.date);
        }
      }}
    >
      <div className="rp-day__number">
        {props.tall ? shortDate(props.date) : Number(props.date.slice(8))}
      </div>
      <div className="rp-day__items">
        {props.items.map((item) => (
          <ItemChip
            key={item.id}
            item={item}
            compact={!props.tall}
            onOpen={() => props.onOpen(item)}
          />
        ))}
      </div>
    </div>
  );
}

export function Calendar(props: {
  view: CalendarView;
  anchor: string;
  today: string;
  items: PlannerItem[];
  onOpen: (item: PlannerItem) => void;
  onMove: (itemId: number, date: string) => void;
}) {
  const byDate = new Map<string, PlannerItem[]>();
  for (const item of [...props.items].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  }
  const month = props.anchor.slice(0, 7);
  const weeks =
    props.view === 'month'
      ? monthGrid(props.anchor)
      : [Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(props.anchor), i))];
  return (
    <div className={`rp-calendar rp-calendar--${props.view}`} aria-label={monthTitle(props.anchor)}>
      {SHORT_DAYS.map((day) => (
        <div key={day} className="rp-calendar__weekday">
          {day}
        </div>
      ))}
      {weeks.flat().map((date) => (
        <DayCell
          key={date}
          date={date}
          today={props.today}
          items={byDate.get(date) ?? []}
          outside={props.view === 'month' && date.slice(0, 7) !== month}
          tall={props.view === 'week'}
          onOpen={props.onOpen}
          onMove={props.onMove}
        />
      ))}
    </div>
  );
}

/** First and last day shown, for the API. */
export function calendarRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  const weeks = monthGrid(anchor);
  return { from: weeks[0]![0]!, to: weeks.at(-1)![6]! };
}
