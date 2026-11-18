// Create in an empty slot (v0.36.0): a small input anchored where you
// clicked (or dragged), with the day and the time already there. Two clear
// choices: « Tâche » (a task of the To-do, planned at that moment, for the
// length of the slot) or « Rendez-vous » (an event of the Agenda). v0.43.0:
// « Rendez-vous » is the main button and Entrée's, To-do or not; « Tâche »
// only by its own click. Échap cancels; nothing is created before.
import { useState } from 'react';
import { Button, ErrorMessage, errorMessage } from '@hub/sdk/frontend';
import type { Span } from '../shared/drag';
import { dayLabel } from '../shared/time';
import { DEFAULT_CATEGORY } from '../shared/categories';
import { CategorySelect } from './Categories';

export type SlotKind = 'task' | 'event';

export function CreateSlot(props: {
  span: Span;
  today: string;
  /** The To-do is there: « Tâche » is offered (and is the default). */
  todo: boolean;
  /** v0.42.0: the category of a « Rendez-vous » (a task stays the To-do's). */
  onSubmit: (kind: SlotKind, title: string, category: string) => Promise<void>;
  onCancel: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v0.43.0: « Rendez-vous » is the main choice and Entrée's; « Tâche » only by its own click.
  const fallback = 'event' as SlotKind;
  const when = `${dayLabel(props.span.start.slice(0, 10), props.today)} ${props.span.start.slice(11)}–${props.span.end.slice(11)}`;
  const submit = (kind: SlotKind) => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    props.onSubmit(kind, title.trim(), category).catch((e: unknown) => {
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
      <label className="small ag-create__category">
        Catégorie du rendez-vous{' '}
        <CategorySelect className="input input--small" value={category} onChange={setCategory} />
      </label>
      <div className="ui-actions">
        <Button small disabled={!title.trim() || busy} onClick={() => submit('event')}>
          Rendez-vous
        </Button>
        {props.todo && (
          <Button
            small
            variant="secondary"
            disabled={!title.trim() || busy}
            onClick={() => submit('task')}
          >
            Tâche
          </Button>
        )}
        <Button small variant="secondary" onClick={props.onCancel} aria-label="Annuler (Échap)">
          ✕
        </Button>
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}
