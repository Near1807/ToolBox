// Create in an empty slot (v0.36.0): a small input anchored where you
// clicked (or dragged), with the day and the time already there. Two clear
// choices: « Tâche » (a task of the To-do, planned at that moment, for the
// length of the slot) or « Rendez-vous » (an event of the Agenda). Entrée =
// « Tâche » (« Rendez-vous » without the To-do); Échap cancels; nothing is
// created before.
import { useState } from 'react';
import { Button, ErrorMessage, errorMessage } from '@hub/sdk/frontend';
import type { Span } from '../shared/drag';
import { dayLabel } from '../shared/time';

export type SlotKind = 'task' | 'event';

export function CreateSlot(props: {
  span: Span;
  today: string;
  /** The To-do is there: « Tâche » is offered (and is the default). */
  todo: boolean;
  onSubmit: (kind: SlotKind, title: string) => Promise<void>;
  onCancel: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fallback: SlotKind = props.todo ? 'task' : 'event';
  const when = `${dayLabel(props.span.start.slice(0, 10), props.today)} ${props.span.start.slice(11)}–${props.span.end.slice(11)}`;
  const submit = (kind: SlotKind) => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    props.onSubmit(kind, title.trim()).catch((e: unknown) => {
      setError(errorMessage(e));
      setBusy(false);
    });
  };
  return (
    <div
      className={`ag-create ${props.className ?? ''}`}
      style={props.style}
      role="dialog"
      aria-label="Créer ici"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        className="input ag-create__input"
        autoFocus
        value={title}
        placeholder="Titre"
        aria-label="Titre"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit(fallback);
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            props.onCancel();
          }
        }}
      />
      <p className="small muted ag-create__preview">
        {title.trim()
          ? `${fallback === 'task' ? 'Tâche' : 'Rendez-vous'} « ${title.trim()} » · ${when}`
          : when}
      </p>
      <div className="ui-actions">
        {props.todo && (
          <Button small disabled={!title.trim() || busy} onClick={() => submit('task')}>
            Tâche
          </Button>
        )}
        <Button
          small
          variant={props.todo ? 'secondary' : 'primary'}
          disabled={!title.trim() || busy}
          onClick={() => submit('event')}
        >
          Rendez-vous
        </Button>
        <Button small variant="secondary" onClick={props.onCancel} aria-label="Annuler (Échap)">
          ✕
        </Button>
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}
