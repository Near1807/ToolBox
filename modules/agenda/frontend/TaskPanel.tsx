// A task of the To-do planned in the Agenda (v0.35.0): its day, time and
// length, changed through the To-do (one piece of data, never a copy);
// « Retirer de l'agenda » sends it back to « À caser ». On the phone, this
// is how a task is moved (no drag there).
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, ErrorMessage, errorMessage, Icon, useModule } from '@hub/sdk/frontend';
import { formatDuration, parseDuration } from '@hub/sdk/dates';
import { MIN_BLOCK_MIN } from '../shared/drag';
import { dayLabel, eventWhen, minutesBetween } from '../shared/time';
import type { PlannedTaskDto } from '../shared/types';
import { colorStyle } from './common';
import type { Undo } from './EventPanel';

export function TaskPanel(props: {
  task: PlannedTaskDto;
  today: string;
  onClose: () => void;
  onChanged: (undo?: Undo) => void;
}) {
  const module = useModule();
  const navigate = useNavigate();
  const { task } = props;
  const length = minutesBetween(task.start, task.end);
  const [day, setDay] = useState(task.start.slice(0, 10));
  const [time, setTime] = useState(task.start.slice(11, 16));
  const [duration, setDuration] = useState(formatDuration(length).slice(1));
  const [error, setError] = useState<string | null>(null);
  const url = `/tasks/${task.id}/plan`;
  const before = { plannedAt: task.start, durationMin: length };
  const run = (body: Record<string, unknown>, message: string) => {
    setError(null);
    module.api.put(url, body).then(
      () => props.onChanged({ message, run: () => module.api.put(url, before) }),
      (e: unknown) => setError(errorMessage(e)),
    );
  };
  return (
    <Card
      title={
        <span className="ag-panel__title" style={colorStyle(task.category)}>
          <span className="ag-dot" aria-hidden="true" />{' '}
          <span className={task.done ? 'ag-done' : undefined}>{task.title}</span>
        </span>
      }
      actions={
        <Button small variant="secondary" onClick={props.onClose}>
          Fermer
        </Button>
      }
    >
      <p>
        <strong>{eventWhen(task, props.today)}</strong> · {formatDuration(length)}
      </p>
      <p className="small muted">
        Tâche de la To-do{task.done ? ' · faite' : ''}
        {task.due ? ` · échéance ${dayLabel(task.due, props.today)}` : ''}
      </p>
      {task.afterDue && (
        <p className="small ag-warning">
          <Icon name="warning" /> Prévue après son échéance.
        </p>
      )}
      <form
        className="ag-form__row"
        onSubmit={(e) => {
          e.preventDefault();
          const minutes = parseDuration(duration);
          if (!day || !time) return setError('Indique le jour et l’heure.');
          if (minutes === null || minutes < MIN_BLOCK_MIN)
            return setError(
              `Durée pas comprise (« 1h30 », « 45min », ${MIN_BLOCK_MIN} min au moins).`,
            );
          run(
            { plannedAt: `${day}T${time}`, durationMin: minutes },
            `« ${task.title} » prévue ${dayLabel(day, props.today)} ${time}`,
          );
        }}
      >
        <label className="small">
          Prévu le
          <input
            className="input"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <label className="small">
          à
          <input
            className="input"
            type="time"
            step={900}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label className="small">
          Durée
          <input
            className="input input--short"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <Button small type="submit">
          Enregistrer
        </Button>
      </form>
      <div className="ui-actions">
        <Button
          small
          variant="secondary"
          title="La tâche revient dans « À caser » ; sa durée estimée reste"
          onClick={() =>
            run({ plannedAt: null }, `« ${task.title} » retirée de l’agenda (de nouveau à caser)`)
          }
        >
          Retirer de l’agenda
        </Button>
        <Button small variant="secondary" onClick={() => navigate(task.open)}>
          Ouvrir dans la To-do
        </Button>
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </Card>
  );
}
