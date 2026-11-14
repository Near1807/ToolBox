// The « Ajouter » bar (v0.36.0, ADR 0046), shared by the PC shell and the
// phone's: one input with a preview, the destinations the PRESENT modules
// declare (`quickAdd`: Tâche, Rendez-vous, Idée…), the first one by
// default, Tab (or a click) to change. Entrée adds, through the module's
// own API; Échap closes; nothing is added before. Then a discreet
// confirmation with « Annuler » and « Ouvrir ». It knows no module.
import { useEffect, useRef, useState } from 'react';
import { localToday } from './dates';
import {
  Button,
  errorMessage,
  moduleApi,
  useQuickAddDestinations,
  type QuickAddResult,
} from './frontend';
import { Icon } from './icons';

export interface QuickAddDone extends QuickAddResult {
  label: string;
}

export function QuickAddDialog(props: {
  onClose: () => void;
  /** After an addition: the shell shows it (« Annuler », « Ouvrir »). */
  onAdded: (done: QuickAddDone) => void;
}) {
  const destinations = useQuickAddDestinations();
  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const today = localToday();
  const dest = destinations[Math.min(index, destinations.length - 1)];
  const preview = dest && text.trim() ? dest.preview(text, today) : null;
  useEffect(() => input.current?.focus(), [index]);

  if (!dest)
    return (
      <div className="quick-add" role="dialog" aria-label="Ajouter">
        <p className="small muted">Aucun outil ne propose d’ajout rapide.</p>
        <Button small variant="secondary" onClick={props.onClose}>
          Fermer
        </Button>
      </div>
    );

  const submit = async () => {
    if (!text.trim() || busy || !preview?.ok) return;
    setBusy(true);
    setError(null);
    try {
      const result = await dest.add(text.trim(), { api: moduleApi(dest.moduleId), today });
      props.onAdded({ ...result, label: dest.label });
      props.onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="quick-add"
      role="dialog"
      aria-label="Ajouter"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          props.onClose();
        }
      }}
    >
      <div className="quick-add__targets" role="tablist" aria-label="Ajouter à">
        {destinations.map((d, i) => (
          <button
            key={d.moduleId}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={`quick-add__target${i === index ? ' quick-add__target--on' : ''}`}
            onClick={() => setIndex(i)}
          >
            <Icon name={d.icon} /> {d.label}
          </button>
        ))}
      </div>
      <input
        ref={input}
        className="input quick-add__input"
        value={text}
        placeholder={dest.placeholder}
        aria-label={`Ajouter : ${dest.label}`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && destinations.length > 1) {
            e.preventDefault();
            const n = destinations.length;
            setIndex((i) => (i + (e.shiftKey ? n - 1 : 1)) % n);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <p
        className={`small quick-add__preview${preview && !preview.ok ? ' error' : ' muted'}`}
        role="status"
      >
        {preview
          ? preview.text
          : `Tab : ${destinations.map((d) => d.label).join(' / ')} · Entrée : ajouter · Échap : fermer`}
      </p>
      {error && <p className="small error">{error}</p>}
    </div>
  );
}

/** How long the confirmation stays (its « Annuler » with it). */
const DONE_MS = 8000;

/**
 * The bar and its confirmation, mounted once by a shell: `open` (the « + »
 * button, Ctrl+N on the PC), `navigate` for « Ouvrir ».
 */
export function QuickAddHost(props: {
  open: boolean;
  onClose: () => void;
  navigate: (route: string) => void;
}) {
  const [done, setDone] = useState<QuickAddDone | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(null), DONE_MS);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <>
      {props.open && (
        <div className="quick-add-layer" onPointerDown={props.onClose}>
          <div onPointerDown={(e) => e.stopPropagation()}>
            <QuickAddDialog
              onClose={props.onClose}
              onAdded={(d) => {
                setUndoError(null);
                setDone(d);
              }}
            />
          </div>
        </div>
      )}
      {done && (
        <div className="quick-add-toast" role="status">
          <span>{done.message}</span>
          {done.undo && (
            <button
              type="button"
              className="quick-add-toast__action"
              onClick={() => {
                const undo = done.undo!;
                setDone(null);
                undo().catch((e: unknown) => setUndoError(errorMessage(e)));
              }}
            >
              Annuler
            </button>
          )}
          {done.open && (
            <button
              type="button"
              className="quick-add-toast__action"
              onClick={() => {
                props.navigate(done.open!);
                setDone(null);
              }}
            >
              Ouvrir
            </button>
          )}
          <button
            type="button"
            className="quick-add-toast__close"
            aria-label="Fermer"
            onClick={() => setDone(null)}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {undoError && (
        <div className="quick-add-toast quick-add-toast--error" role="alert">
          {undoError}
          <button
            type="button"
            className="quick-add-toast__close"
            onClick={() => setUndoError(null)}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
    </>
  );
}
