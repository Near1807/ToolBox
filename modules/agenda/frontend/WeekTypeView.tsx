// The week type: what comes back every week (lessons, trainings, fixed
// meetings), on its day, at its time, in its period. Changed here for all
// the weeks; one occurrence is cancelled or moved from the week view.
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorMessage, errorMessage, useModule } from '@hub/sdk/frontend';
import { OWN_CATEGORIES } from '../shared/categories';
import { dayLabel, timeOf, WEEKDAYS } from '../shared/time';
import type { WeeklyDto } from '../shared/types';
import { colorStyle } from './common';
import type { Undo } from './EventPanel';

function WeeklyForm(props: {
  initial?: WeeklyDto;
  onSubmit: (fields: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
}) {
  const i = props.initial;
  const [title, setTitle] = useState(i?.title ?? '');
  const [day, setDay] = useState(i?.weekday ?? 0);
  const [time, setTime] = useState(i?.time ?? '18:00');
  const [duration, setDuration] = useState(String(i?.durationMin ?? 60));
  const [category, setCategory] = useState(i?.category ?? 'Cours');
  const [location, setLocation] = useState(i?.location ?? '');
  const [from, setFrom] = useState(i?.from ?? '');
  const [until, setUntil] = useState(i?.until ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="ag-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        props
          .onSubmit({
            title,
            weekday: day,
            time,
            durationMin: Number(duration),
            category,
            location,
            from: from || null,
            until: until || null,
          })
          .then(
            () => {
              if (!i) setTitle('');
            },
            (err: unknown) => setError(errorMessage(err)),
          );
      }}
    >
      <div className="ag-form__row">
        <label>
          Titre
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label>
          Jour
          <select className="input" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {WEEKDAYS.map((w, n) => (
              <option key={w} value={n}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label>
          Heure
          <input
            className="input"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </label>
        <label>
          Durée (min)
          <input
            className="input input--short"
            type="number"
            min={5}
            max={1440}
            step={5}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
      </div>
      <div className="ag-form__row">
        <label>
          Catégorie
          <input
            className="input"
            list="ag-week-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id="ag-week-categories">
            {OWN_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          Lieu
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label>
          À partir du
          <input
            className="input"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Jusqu’au
          <input
            className="input"
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="ui-actions">
        <Button type="submit">{i ? 'Enregistrer' : 'Ajouter à la semaine type'}</Button>
        {props.onCancel && (
          <Button type="button" variant="secondary" onClick={props.onCancel}>
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
}

export function WeekTypeView(props: {
  weekly: WeeklyDto[];
  today: string;
  onChanged: (undo?: Undo) => void;
}) {
  const module = useModule();
  const [editing, setEditing] = useState<string | null>(null);
  const end = (w: WeeklyDto) => {
    const m = Number(w.time.slice(0, 2)) * 60 + Number(w.time.slice(3)) + w.durationMin;
    return timeOf(m % (24 * 60));
  };
  return (
    <>
      <Card title="Ajouter">
        <WeeklyForm
          onSubmit={async (fields) => {
            await module.api.post('/weekly', fields);
            props.onChanged();
          }}
        />
        <p className="small muted">
          Ou dans la barre : « badminton tous les jeudis 19h 2h », « réunion chaque mardi 20h ».
        </p>
      </Card>
      {props.weekly.length === 0 ? (
        <EmptyState title="La semaine type est vide.">
          Les cours, entraînements et réunions fixes reviennent ici chaque semaine.
        </EmptyState>
      ) : (
        WEEKDAYS.map((name, n) => {
          const list = props.weekly.filter((w) => w.weekday === n);
          if (list.length === 0) return null;
          return (
            <Card key={name} title={name.charAt(0).toUpperCase() + name.slice(1)}>
              <ul className="ag-weekly">
                {list.map((w) =>
                  editing === w.id ? (
                    <li key={w.id}>
                      <WeeklyForm
                        initial={w}
                        onCancel={() => setEditing(null)}
                        onSubmit={async (fields) => {
                          await module.api.patch(`/weekly/${w.id}`, fields);
                          setEditing(null);
                          props.onChanged();
                        }}
                      />
                    </li>
                  ) : (
                    <li key={w.id} className="ag-weekly__item" style={colorStyle(w.category)}>
                      <span className="ag-dot" aria-hidden="true" />
                      <strong>
                        {w.time}–{end(w)}
                      </strong>{' '}
                      {w.title}
                      <span className="small muted">
                        {' '}
                        · {w.category}
                        {w.location ? ` · ${w.location}` : ''}
                        {w.from ? ` · à partir du ${dayLabel(w.from, props.today)}` : ''}
                        {w.until ? ` · jusqu’au ${dayLabel(w.until, props.today)}` : ''}
                      </span>
                      <span className="ui-actions">
                        <Button small variant="secondary" onClick={() => setEditing(w.id)}>
                          Modifier
                        </Button>
                        <Button
                          small
                          variant="danger"
                          onClick={() =>
                            window.confirm(
                              `Retirer « ${w.title} » de la semaine type (toutes les semaines) ?`,
                            ) &&
                            module.api.delete(`/weekly/${w.id}`).then(
                              () =>
                                props.onChanged({
                                  message: `« ${w.title} » retiré de la semaine type`,
                                  run: () => module.api.post(`/weekly/${w.id}/restore`),
                                }),
                              (e: unknown) => window.alert(errorMessage(e)),
                            )
                          }
                        >
                          Retirer
                        </Button>
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </Card>
          );
        })
      )}
    </>
  );
}
