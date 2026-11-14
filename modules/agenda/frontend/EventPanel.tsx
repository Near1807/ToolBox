// The detail of an Agenda event (a click on it): read, change, delete (a
// tombstone, after a confirmation, « Annuler » brings it back). For an
// occurrence of the week type: cancel or move this one only, or bring it
// back as usual; the entry itself is changed in « Semaine type ».
import { useState } from 'react';
import { Button, Card, ErrorMessage, errorMessage, useModule } from '@hub/sdk/frontend';
import { OWN_CATEGORIES } from '../shared/categories';
import { addMinutes, eventWhen, minutesBetween } from '../shared/time';
import type { AgendaEventDto } from '../shared/types';
import { colorStyle } from './common';

export interface Undo {
  message: string;
  run: () => Promise<unknown>;
}

/** The form of an event (also used to create one without the bar). */
export function EventForm(props: {
  initial: Partial<AgendaEventDto>;
  submitLabel: string;
  onSubmit: (fields: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const i = props.initial;
  const [title, setTitle] = useState(i.title ?? '');
  const [allDay, setAllDay] = useState(i.allDay ?? false);
  const [startDay, setStartDay] = useState((i.start ?? '').slice(0, 10));
  const [startTime, setStartTime] = useState((i.start ?? '').slice(11) || '09:00');
  const [endDay, setEndDay] = useState((i.end ?? '').slice(0, 10));
  const [endTime, setEndTime] = useState((i.end ?? '').slice(11) || '10:00');
  const [location, setLocation] = useState(i.location ?? '');
  const [note, setNote] = useState(i.note ?? '');
  const [category, setCategory] = useState(i.category ?? OWN_CATEGORIES[0]);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="ag-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fields = {
          title,
          allDay,
          start: allDay ? startDay : `${startDay}T${startTime}`,
          end: allDay ? endDay || startDay : `${endDay || startDay}T${endTime}`,
          location,
          note,
          category,
        };
        props.onSubmit(fields).catch((err: unknown) => setError(errorMessage(err)));
      }}
    >
      <label>
        Titre
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label className="ag-check">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />{' '}
        Toute la journée
      </label>
      <div className="ag-form__row">
        <label>
          {allDay ? 'Premier jour' : 'Début'}
          <input
            className="input"
            type="date"
            value={startDay}
            onChange={(e) => setStartDay(e.target.value)}
            required
          />
        </label>
        {!allDay && (
          <label>
            Heure
            <input
              className="input"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
            />
          </label>
        )}
      </div>
      <div className="ag-form__row">
        <label>
          {allDay ? 'Dernier jour' : 'Fin'}
          <input
            className="input"
            type="date"
            value={endDay}
            onChange={(e) => setEndDay(e.target.value)}
          />
        </label>
        {!allDay && (
          <label>
            Heure
            <input
              className="input"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
            />
          </label>
        )}
      </div>
      <div className="ag-form__row">
        <label>
          Lieu
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label>
          Catégorie
          <input
            className="input"
            list="ag-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id="ag-categories">
            {OWN_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
      </div>
      <label>
        Note
        <textarea
          className="input"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="ui-actions">
        <Button type="submit">{props.submitLabel}</Button>
        <Button type="button" variant="secondary" onClick={props.onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

export function EventPanel(props: {
  /** v0.36.0: the Agenda's own buttons (« Lancer un timer »). */
  children?: React.ReactNode;
  event: AgendaEventDto;
  today: string;
  onClose: () => void;
  onChanged: (undo?: Undo) => void;
  onWeekType: () => void;
}) {
  const module = useModule();
  const { event } = props;
  const [moveTo, setMoveTo] = useState(event.start);
  const [error, setError] = useState<string | null>(null);
  const run = (task: () => Promise<unknown>, undo?: Undo) => {
    setError(null);
    task().then(
      () => props.onChanged(undo),
      (e: unknown) => setError(errorMessage(e)),
    );
  };
  const occurrence = event.weekly;
  const occurrenceUrl = occurrence ? `/weekly/${occurrence.id}/occurrences/${occurrence.date}` : '';
  return (
    <Card
      title={
        <span className="ag-panel__title" style={colorStyle(event.category)}>
          <span className="ag-dot" aria-hidden="true" /> {event.title}
        </span>
      }
      actions={
        <Button small variant="secondary" onClick={props.onClose}>
          Fermer
        </Button>
      }
    >
      {!occurrence ? (
        // v0.36.0: every field editable in place; « Annuler » writes the previous values back.
        <>
          <EventForm
            initial={event}
            submitLabel="Enregistrer"
            onCancel={props.onClose}
            onSubmit={async (fields) => {
              await module.api.patch(`/events/${event.id}`, fields);
              props.onChanged({
                message: `« ${String(fields.title)} » enregistré`,
                run: () =>
                  module.api.patch(`/events/${event.id}`, {
                    title: event.title,
                    allDay: event.allDay,
                    start: event.start,
                    end: event.end,
                    location: event.location ?? '',
                    note: event.note ?? '',
                    category: event.category,
                  }),
              });
            }}
          />
          <div className="ui-actions ag-panel__more">
            {!event.allDay && (
              <Button
                small
                variant="secondary"
                title="Le même, une semaine plus tard"
                onClick={() =>
                  run(() =>
                    module.api.post('/events', {
                      title: event.title,
                      start: addMinutes(event.start, 7 * 24 * 60),
                      end: addMinutes(event.end, 7 * 24 * 60),
                      location: event.location,
                      note: event.note,
                      category: event.category,
                    }),
                  )
                }
              >
                Dupliquer la semaine suivante
              </Button>
            )}
            <Button
              small
              variant="danger"
              onClick={() =>
                window.confirm(`Supprimer « ${event.title} » de l’agenda ?`) &&
                run(() => module.api.delete(`/events/${event.id}`), {
                  message: `« ${event.title} » supprimé`,
                  run: () => module.api.post(`/events/${event.id}/restore`),
                })
              }
            >
              Supprimer
            </Button>
            {props.children}
          </div>
        </>
      ) : (
        <>
          <p>
            <strong>{eventWhen(event, props.today)}</strong>
            {!event.allDay && ` · ${minutesBetween(event.start, event.end)} min`}
          </p>
          <p className="small muted">
            {event.category}
            {event.location ? ` · ${event.location}` : ''}
            {occurrence ? ` · semaine type${occurrence.moved ? ' (déplacée)' : ''}` : ''}
          </p>
          {event.note && <p>{event.note}</p>}
          <>
            <div className="ui-actions">
              <Button
                small
                variant="secondary"
                onClick={() =>
                  window.confirm(`Annuler « ${event.title} » de cette semaine seulement ?`) &&
                  run(() => module.api.put(occurrenceUrl, { action: 'cancel' }), {
                    message: `« ${event.title} » annulé pour cette fois`,
                    run: () => module.api.put(occurrenceUrl, { action: 'reset' }),
                  })
                }
              >
                Annuler cette fois-ci
              </Button>
              {occurrence.moved && (
                <Button
                  small
                  variant="secondary"
                  onClick={() => run(() => module.api.put(occurrenceUrl, { action: 'reset' }))}
                >
                  Remettre à l’heure habituelle
                </Button>
              )}
              <Button small variant="secondary" onClick={props.onWeekType}>
                Modifier la semaine type
              </Button>
              {props.children}
            </div>
            <div className="ag-form__row">
              <label className="small">
                Déplacer cette fois-ci à
                <input
                  className="input"
                  type="datetime-local"
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                />
              </label>
              <Button
                small
                onClick={() =>
                  run(() =>
                    module.api.put(occurrenceUrl, {
                      action: 'move',
                      start: moveTo,
                      durationMin: minutesBetween(event.start, event.end),
                    }),
                  )
                }
              >
                Déplacer
              </Button>
            </div>
          </>
        </>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </Card>
  );
}
