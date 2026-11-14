// The fields of a task (v0.36.0: one form, used by the To-do's list and by
// the sheet it lends to the other modules, « todo.taskEditor »): title
// (optional here), tags, due date, estimate, planned day and time, track.
// Same rules and checks everywhere: never a copy.
import { useState, type ReactNode } from 'react';
import { Button, ErrorMessage } from '@hub/sdk/frontend';
import {
  DEFAULT_PLANNED_MIN,
  formatDuration,
  parseDue,
  parseDuration,
  shortDate,
  slashDate,
} from '@hub/sdk/dates';
import { cleanTags, type TaskDto, type TasksResponse } from '../shared';

export function TaskFields(props: {
  task: TaskDto;
  data: Pick<TasksResponse, 'today' | 'library' | 'tracks'>;
  /** Show the title field (the lent sheet; the list edits it in place). */
  withTitle?: boolean;
  submitLabel?: string;
  onSave: (patch: Record<string, unknown>) => Promise<void> | void;
  onCancel?: () => void;
  /** « Retirer de l'agenda » (shown when the task is planned). */
  onUnplan?: () => void;
  /** More buttons next to « Enregistrer ». */
  extra?: ReactNode;
}) {
  const { task, data } = props;
  const [title, setTitle] = useState(task.title);
  const [tags, setTags] = useState(task.tags.join(', '));
  const [due, setDue] = useState(task.due ? slashDate(task.due) : '');
  const [trackId, setTrackId] = useState(task.track ? String(task.track.id) : '');
  const [duration, setDuration] = useState(
    task.durationMin ? formatDuration(task.durationMin).slice(1) : '',
  );
  const [plannedDay, setPlannedDay] = useState(task.plannedAt?.slice(0, 10) ?? '');
  const [plannedTime, setPlannedTime] = useState(task.plannedAt?.slice(11, 16) ?? '');
  const [error, setError] = useState<string | null>(null);
  const dueValue = due.trim() ? parseDue(due, data.today) : null;
  const durationValue = duration.trim() ? parseDuration(duration) : null;
  return (
    <form
      className="td-details"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (props.withTitle && !title.trim()) return setError('Le titre est obligatoire.');
        if (due.trim() && !dueValue) return setError(`Échéance pas comprise : « ${due} »`);
        if (duration.trim() && !durationValue)
          return setError(`Durée estimée pas comprise : « ${duration} »`);
        if (Boolean(plannedDay) !== Boolean(plannedTime))
          return setError('Pour prévoir la tâche, indique le jour et l’heure.');
        void props.onSave({
          ...(props.withTitle ? { title } : {}),
          tags: cleanTags(tags.split(',')),
          due: dueValue,
          trackId: trackId ? Number(trackId) : null,
          durationMin: durationValue,
          plannedAt: plannedDay && plannedTime ? `${plannedDay}T${plannedTime}` : null,
        });
      }}
    >
      {props.withTitle && (
        <label className="small td-details__title">
          Titre
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
      )}
      <label className="small">
        Tags
        <input
          className="input"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="mix, studio"
        />
      </label>
      <label className="small">
        Échéance
        <input
          className="input"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          placeholder="vendredi, le 12/11…"
        />
        <span className={dueValue || !due.trim() ? 'muted' : 'error'}>
          {due.trim()
            ? dueValue
              ? `→ ${shortDate(dueValue, data.today)}`
              : 'pas comprise'
            : 'aucune'}
        </span>
      </label>
      <label className="small">
        Durée estimée
        <input
          className="input"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          placeholder="2h, 30min, 1h30…"
        />
        <span className={durationValue || !duration.trim() ? 'muted' : 'error'}>
          {duration.trim()
            ? durationValue
              ? `→ ${formatDuration(durationValue)}`
              : 'pas comprise'
            : 'aucune'}
        </span>
      </label>
      <div className="td-details__planned">
        <label className="small">
          Prévu le
          <input
            className="input"
            type="date"
            value={plannedDay}
            onChange={(e) => setPlannedDay(e.target.value)}
          />
        </label>
        <label className="small">
          à
          <input
            className="input"
            type="time"
            step={900}
            value={plannedTime}
            onChange={(e) => setPlannedTime(e.target.value)}
          />
        </label>
        {task.plannedAt && props.onUnplan && (
          <Button
            small
            variant="secondary"
            title="Efface l’heure prévue : la tâche revient dans « À caser » de l’Agenda"
            onClick={props.onUnplan}
          >
            Retirer de l’agenda
          </Button>
        )}
        <span className="muted small">
          {plannedDay && plannedTime && !duration.trim()
            ? `durée : ${formatDuration(DEFAULT_PLANNED_MIN)} par défaut`
            : ''}
        </span>
      </div>
      {data.library && (
        <label className="small">
          Morceau
          <select className="input" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
            <option value="">Aucun</option>
            {data.tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="td-details__actions">
        <Button type="submit" small>
          {props.submitLabel ?? 'Enregistrer'}
        </Button>
        {props.onCancel && (
          <Button variant="secondary" small onClick={props.onCancel}>
            Annuler
          </Button>
        )}
        {props.extra}
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </form>
  );
}
