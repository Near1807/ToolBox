// A task of the To-do, seen from the Agenda (v0.36.0): the To-do's own full
// sheet (lent: « todo.taskEditor », ADR 0046) — every field, « Fait »,
// « Retirer de l'agenda », « Supprimer », « Ouvrir dans la To-do ». The task
// stays the To-do's: the sheet writes only through the To-do's API. Opened
// from a block (week, day, month) or a task « à caser »; PC and phone.
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button, Card, ErrorMessage, errorMessage, Lent, useModule } from '@hub/sdk/frontend';
import { convertTaskToEvent } from './Convert';
import { CategorySelect } from './Categories';
import { categoryInfo, colorStyle } from './common';
import { foldName } from '../shared/category-id';
import { TASKS_CATEGORY } from '../shared/load';
import type { TaskEditorProps } from '../../todo/contract';
import type { Undo } from './EventPanel';
import { SheetClose } from './Dock';

export interface OpenTask {
  id: string;
  title: string;
  category: string;
}

export function TaskPanel(props: {
  task: OpenTask;
  onClose: () => void;
  onChanged: (notice: Undo | { message: string; run: null }) => void;
  /** Buttons of the Agenda (« Lancer un timer »). */
  children?: ReactNode;
  /** v0.43.0: after « Convertir en rendez-vous » (its « Annuler »); the sheet closes. */
  onConverted?: (undo: Undo) => void;
}) {
  const module = useModule();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card
      title={
        <span className="ag-panel__title" style={colorStyle(props.task.category)}>
          <span className="ag-dot" aria-hidden="true" /> {props.task.title}
        </span>
      }
      actions={<SheetClose onClose={props.onClose} />}
    >
      {/* v0.43.0: its category in the Agenda (kept by the Agenda; the To-do does not change). */}
      <label className="small ag-task-category">
        Catégorie dans l’Agenda{' '}
        <CategorySelect
          className="input input--small"
          value={props.task.category}
          onChange={(name) => {
            setError(null);
            const none = foldName(name) === foldName(TASKS_CATEGORY);
            const url = `/tasks/${props.task.id}/category`;
            module.api
              .put<{ before: string | null }>(
                url,
                none
                  ? { categoryId: null }
                  : { categoryId: categoryInfo(name)?.id, category: name },
              )
              .then(
                (r) =>
                  props.onChanged({
                    message: `« ${props.task.title} » dans « ${name} »`,
                    run: () => module.api.put(url, { categoryId: r.before }),
                  }),
                (e: unknown) => setError(errorMessage(e)),
              );
          }}
        />
      </label>
      <Lent<TaskEditorProps>
        name="todo.taskEditor"
        props={{
          taskId: props.task.id,
          onChanged: (change) =>
            props.onChanged(
              change.undo
                ? { message: change.message, run: change.undo }
                : { message: change.message, run: null },
            ),
          children: props.children,
        }}
        fallback={<p className="small muted">La To-do n’est pas là : rien à modifier ici.</p>}
      />
      {props.onConverted && (
        <div className="ui-actions ag-panel__more">
          <Button
            small
            variant="secondary"
            title="Un rendez-vous de l’Agenda à la même heure (ou sur la journée de son échéance) ; « Annuler » remet la tâche"
            onClick={() => {
              setError(null);
              convertTaskToEvent(module.api, props.task).then(props.onConverted, (e: unknown) =>
                setError(errorMessage(e)),
              );
            }}
          >
            Convertir en rendez-vous
          </Button>
        </div>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </Card>
  );
}
