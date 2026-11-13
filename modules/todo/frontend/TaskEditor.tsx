// The full sheet of a task, lent to the other modules (v0.36.0, ADR 0046,
// « todo.taskEditor »; props typed in ../contract.ts): every field, the same
// form and checks as the To-do (TaskFields), « Fait », « Retirer de
// l'agenda », « Supprimer » (confirmation, then « Annuler »), « Ouvrir dans
// la To-do ». It runs in the To-do's context: it writes only through the
// To-do's own API. Each change gives the borrower a message and its undo.
import { Link } from 'react-router';
import {
  Button,
  confirmDelete,
  ErrorMessage,
  errorMessage,
  Icon,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import { formatDuration, formatPlanned } from '@hub/sdk/dates';
import type { TaskEditorProps } from '../contract';
import type { TaskDto, TasksResponse } from '../shared';
import { TaskFields } from './TaskFields';
import { useState } from 'react';

/** The values a save may change, as they are now (written back by « Annuler »). */
const snapshot = (t: TaskDto) => ({
  title: t.title,
  tags: t.tags,
  due: t.due,
  trackId: t.track?.id ?? null,
  durationMin: t.durationMin,
  plannedAt: t.plannedAt,
});

export function TaskEditor(props: TaskEditorProps) {
  const module = useModule();
  const { data, error, reload } = useApi<TasksResponse>(module.url('/tasks'));
  const [actionError, setActionError] = useState<string | null>(null);
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!data) return <p className="small muted">Chargement…</p>;
  const task = data.tasks.find((t) => t.id === props.taskId);
  if (!task) return <p className="small muted">Cette tâche n’existe plus dans la To-do.</p>;
  const url = `/tasks/${task.id}`;
  const before = snapshot(task);

  const act = async (
    run: () => Promise<unknown>,
    message: string,
    undo?: () => Promise<unknown>,
  ) => {
    setActionError(null);
    try {
      await run();
      reload();
      props.onChanged?.({ message, undo });
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  return (
    <div className="td-sheet">
      <label className="td-sheet__done">
        <input
          type="checkbox"
          checked={task.done}
          onChange={(e) => {
            const done = e.target.checked;
            void act(
              () => module.api.patch(url, { done }),
              done ? `« ${task.title} » cochée` : `« ${task.title} » de nouveau à faire`,
              () => module.api.patch(url, { done: !done }),
            );
          }}
        />{' '}
        Faite
      </label>
      <p className="small muted td-sheet__meta">
        {task.plannedAt ? `Prévue ${formatPlanned(task.plannedAt, data.today)}` : 'Pas prévue'}
        {task.durationMin ? ` · ${formatDuration(task.durationMin)}` : ''}
      </p>
      <TaskFields
        key={`${task.title}|${task.due}|${task.plannedAt}|${task.durationMin}|${task.tags.join()}|${task.track?.id}`}
        task={task}
        data={data}
        withTitle
        onSave={(patch) =>
          act(
            () => module.api.patch(url, patch),
            `« ${String(patch.title ?? task.title)} » enregistrée`,
            () => module.api.patch(url, before),
          )
        }
        onUnplan={() =>
          void act(
            () => module.api.patch(url, { plannedAt: null }),
            `« ${task.title} » retirée de l’agenda (de nouveau à caser)`,
            () =>
              module.api.patch(url, {
                plannedAt: before.plannedAt,
                durationMin: before.durationMin,
              }),
          )
        }
        extra={
          <>
            <Button
              small
              variant="danger"
              onClick={() => {
                if (!confirmDelete(`la tâche « ${task.title} »`)) return;
                void act(
                  () => module.api.delete(url),
                  `« ${task.title} » supprimée`,
                  () => module.api.post(`${url}/restore`),
                );
              }}
            >
              Supprimer
            </Button>
            <Link className="button button--secondary button--small" to="/m/todo">
              <Icon name="list-checks" /> Ouvrir dans la To-do
            </Link>
          </>
        }
      />
      {props.children && <div className="ui-actions td-sheet__more">{props.children}</div>}
      {actionError && <ErrorMessage>{actionError}</ErrorMessage>}
    </div>
  );
}
