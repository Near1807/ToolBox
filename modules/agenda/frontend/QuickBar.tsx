// The bar on top: French, one line, a preview before validating
// (« Sera ajouté : Dentiste · jeu. 19 nov. 14:00–15:00 »). An event, an entry
// of the week type, or a task of the To-do (« à caser »).
import { useMemo, useState } from 'react';
import { Button, ErrorMessage, errorMessage, onPhone, useModule } from '@hub/sdk/frontend';
import { parseQuick, previewText } from '../shared/parse';

export interface Added {
  kind: 'event' | 'weekly' | 'task';
  id: string;
  title: string;
  /** A task planned at a time (v0.35.0): « YYYY-MM-DDTHH:mm ». */
  plannedAt?: string | null;
}

export function QuickBar(props: { today: string; todo: boolean; onAdded: (added: Added) => void }) {
  const module = useModule();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseQuick(text, props.today), [text, props.today]);
  const blocked =
    parsed.kind === 'empty' || parsed.kind === 'error' || (parsed.kind === 'task' && !props.todo);
  const submit = async () => {
    if (blocked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await module.api.post<{
        kind: Added['kind'];
        event?: { id: string; title: string };
        weekly?: { id: string; title: string };
        task?: { id: string; title: string; plannedAt?: string | null };
      }>('/quick', { text });
      const made = r.event ?? r.weekly ?? r.task!;
      props.onAdded({
        kind: r.kind,
        id: made.id,
        title: made.title,
        plannedAt: r.task?.plannedAt ?? null,
      });
      setText('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="ag-quick"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="ag-quick__row">
        <input
          className="input ag-quick__input"
          value={text}
          autoFocus={!onPhone()}
          placeholder="dentiste jeudi 14h 1h · week-end scout 13-15 février · préparer la réunion ~1h avant vendredi"
          aria-label="Ajouter à l’agenda"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        <Button type="submit" disabled={blocked || busy}>
          Ajouter
        </Button>
      </div>
      {text.trim() && (
        <p
          className={`small ag-quick__preview${parsed.kind === 'error' ? ' error' : ''}`}
          aria-live="polite"
        >
          {parsed.kind === 'task' && !props.todo
            ? 'Une chose à caser devient une tâche de la To-do, qui n’est pas là. Ajoute une heure ou une date pour en faire un événement.'
            : previewText(parsed, props.today)}
        </p>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </form>
  );
}
