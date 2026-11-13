// A task of the To-do, seen from the Agenda (v0.36.0): the To-do's own full
// sheet (lent: « todo.taskEditor », ADR 0046) — every field, « Fait »,
// « Retirer de l'agenda », « Supprimer », « Ouvrir dans la To-do ». The task
// stays the To-do's: the sheet writes only through the To-do's API. Opened
// from a block (week, day, month) or a task « à caser »; PC and phone.
import type { ReactNode } from 'react';
import { Button, Card, Lent } from '@hub/sdk/frontend';
import type { TaskEditorProps } from '../../todo/contract';
import { colorStyle } from './common';
import type { Undo } from './EventPanel';

export interface OpenTask {
  id: string;
  title: string;
  category: string;
}

export function TaskPanel(props: {
  task: OpenTask;
  onClose: () => void;
  onChanged: (undo?: Undo) => void;
  /** Buttons of the Agenda (« Lancer un timer »). */
  children?: ReactNode;
}) {
  return (
    <Card
      title={
        <span className="ag-panel__title" style={colorStyle(props.task.category)}>
          <span className="ag-dot" aria-hidden="true" /> {props.task.title}
        </span>
      }
      actions={
        <Button small variant="secondary" onClick={props.onClose}>
          Fermer
        </Button>
      }
    >
      <Lent<TaskEditorProps>
        name="todo.taskEditor"
        props={{
          taskId: props.task.id,
          onChanged: (change) =>
            props.onChanged(
              change.undo ? { message: change.message, run: change.undo } : undefined,
            ),
          children: props.children,
        }}
        fallback={<p className="small muted">La To-do n’est pas là : rien à modifier ici.</p>}
      />
    </Card>
  );
}
