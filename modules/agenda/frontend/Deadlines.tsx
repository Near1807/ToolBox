// v0.42.0 (Expérimental): the « deadline » shape drawn. A moment, not a block:
// with a time, a thick line across its day at that time, labelled (icon,
// title, time), above the blocks without hiding them (the line lets the
// clicks through, only its label is clickable); without a time, a band in
// « Journée ». Late and not done: stays red; done: dimmed and struck through.
// The « Deadlines » row on top of the week: the ones not done, late ones
// included, up to 7 days after the week shown; hidden like a switch.
import { useState } from 'react';
import { Icon } from '@hub/sdk/frontend';
import { isLate, localNow, untilText } from '../shared/deadline';
import type { AgendaEventDto } from '../shared/types';
import { colorStyle, type Item } from './common';
import type { BindMenu } from './Menus';

const ROW_KEY = 'toolbox.agenda.deadlinesRow';

/** The « Deadlines » row shown or hidden (this device only, like the switches). */
export function useDeadlinesRow() {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(ROW_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setShown((s) => {
      try {
        localStorage.setItem(ROW_KEY, s ? 'off' : 'on');
      } catch {
        // Not kept: shown again next time.
      }
      return !s;
    });
  return { shown, toggle };
}

/** Its classes: late (still red), done (dimmed, struck through). */
export function deadlineClass(e: AgendaEventDto, now = localNow()): string {
  return `ag-deadline${e.done ? ' ag-deadline--done' : isLate(e.start, now) ? ' ag-deadline--late' : ''}`;
}

/** « Rendu rapport · 23:59 », « Rendu rapport · faite ». */
export const deadlineLabel = (e: AgendaEventDto) =>
  `${e.title}${e.start.length > 10 ? ` · ${e.start.slice(11)}` : ''}`;

/** What is said of it (the tooltip, the sheet, the preview). */
export const deadlineState = (e: AgendaEventDto, now = localNow()) =>
  e.done ? 'faite' : untilText(e.start, now);

/** With a time: the line across the day column, at `top` px. */
export function DeadlineLine(props: {
  item: Item & { source: 'own' };
  top: number;
  onOpen: (item: Item) => void;
  bind?: object;
}) {
  const e = props.item.event;
  return (
    <div
      className={`${deadlineClass(e)} ag-deadline--line`}
      style={{ ...colorStyle(e.category), top: props.top }}
    >
      <button
        type="button"
        className="ag-deadline__label"
        title={`Deadline : ${deadlineLabel(e)} · ${deadlineState(e)}`}
        onClick={() => props.onOpen(props.item)}
        {...props.bind}
      >
        <Icon name="circle-alert" /> <span className="ag-deadline__title">{e.title}</span>{' '}
        <span className="ag-deadline__time">{e.start.slice(11)}</span>
      </button>
    </div>
  );
}

/** Without a time: the band in « Journée ». */
export function DeadlineBand(props: {
  item: Item & { source: 'own' };
  onOpen: (item: Item) => void;
  style?: React.CSSProperties;
  bind?: object;
}) {
  const e = props.item.event;
  return (
    <button
      type="button"
      className={`ag-band ${deadlineClass(e)} ag-deadline--band`}
      style={{ ...colorStyle(e.category), ...props.style }}
      title={`Deadline : ${e.title} · ${deadlineState(e)}`}
      onClick={() => props.onOpen(props.item)}
      {...props.bind}
    >
      <Icon name="circle-alert" /> {e.title}
    </button>
  );
}

/** The row on top of the week: what is due soon, with the time left; a click opens it. */
export function DeadlinesRow(props: {
  deadlines: AgendaEventDto[];
  shown: boolean;
  onToggle: () => void;
  onOpen: (event: AgendaEventDto) => void;
  /** v0.42.0: the right-click / long-press menu. */
  menu?: BindMenu;
}) {
  if (!props.deadlines.length) return null;
  const now = localNow();
  return (
    <div className="ag-deadlines" role="group" aria-label="Deadlines à venir">
      <button
        type="button"
        role="switch"
        aria-checked={props.shown}
        className={`ag-layer${props.shown ? ' ag-layer--on' : ' ag-layer--off'}`}
        style={colorStyle('Deadline')}
        title={props.shown ? 'Masquer la ligne des deadlines' : 'Afficher la ligne des deadlines'}
        onClick={props.onToggle}
      >
        <span className="ag-switch" aria-hidden="true" />
        Deadlines ({props.deadlines.length})
      </button>
      {props.shown &&
        props.deadlines.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`${deadlineClass(d, now)} ag-deadline--chip`}
            style={colorStyle(d.category)}
            onClick={() => props.onOpen(d)}
            {...props.menu?.({ kind: 'item', item: { source: 'own', event: d } })}
          >
            <Icon name="circle-alert" /> <strong>{d.title}</strong>{' '}
            <span className="small">{untilText(d.start, now)}</span>
          </button>
        ))}
    </div>
  );
}
