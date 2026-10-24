// The written command bar, in the floating window over the application in use
// (ToolBox stays hidden): Entrée sends, Échap closes. Same path as the voice
// without the transcription; the answer is shown here (« Tâche ajoutée : … »
// with « Annuler »), a confirmation or a « Tu voulais dire … ? » is answered
// here. It closes by itself a few seconds after a finished answer.
import { useEffect, useRef, useState } from 'react';
import { Button, errorMessage, FloatingPanel, useModule } from '@hub/sdk/frontend';
import type { TurnDto } from '../shared';

/** A finished answer stays this long before the bar closes by itself. */
const CLOSE_AFTER_MS = 6_000;

export function CommandBar(props: { turn: TurnDto | null; onTurn: (turn: TurnDto) => void }) {
  const module = useModule();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turn = props.turn;
  const close = () => void module.api.post('/bar/close').catch(() => {});

  // The window gets the keyboard a moment after it shows: focus the field then.
  useEffect(() => {
    const focus = () => input.current?.focus();
    focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);
  // A finished answer (nothing to confirm): the bar closes by itself, unless typing again.
  const finished = Boolean(turn && !busy && !turn.pending && text === '');
  useEffect(() => {
    if (!finished) return;
    const id = setTimeout(close, CLOSE_AFTER_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, turn?.id]);

  const run = async (request: () => Promise<{ turn: TurnDto | null }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await request();
      if (result.turn) props.onTurn(result.turn);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };
  const send = () => {
    const value = text.trim();
    if (!value || busy) return;
    setText('');
    void run(() => module.api.post<{ turn: TurnDto }>('/bar/send', { text: value }));
  };
  const answer = (body: { yes?: boolean; choice?: number }) =>
    turn && void run(() => module.api.post<{ turn: TurnDto }>(`/turns/${turn.id}/answer`, body));
  const undo = (index: number) =>
    turn &&
    void module.api
      .post(`/turns/${turn.id}/actions/${index}/undo`)
      .then(() =>
        props.onTurn({
          ...turn,
          actions: turn.actions.map((a, i) => (i === index ? { ...a, undone: true } : a)),
        }),
      )
      .catch((err: unknown) => setError(errorMessage(err)));

  return (
    <FloatingPanel label="Barre de commande de l’assistant" focus>
      <div className="as-bar">
        <input
          ref={input}
          className="input as-bar__input"
          value={text}
          placeholder="Écris une commande…  (Entrée envoie, Échap ferme)"
          aria-label="Commande écrite"
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              send();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
        />
        {busy && <p className="as-bar__line muted">…</p>}
        {turn && !busy && (
          <div className="as-bar__answer" role="status">
            {turn.reply && <p className="as-bar__line">{turn.reply}</p>}
            {turn.pending?.kind === 'confirm' && (
              <div className="as-bar__actions">
                <Button small onClick={() => answer({ yes: true })}>
                  Oui
                </Button>
                <Button variant="secondary" small onClick={() => answer({ yes: false })}>
                  Non
                </Button>
              </div>
            )}
            {turn.pending?.kind === 'choose' && turn.pending.options && (
              <div className="as-bar__actions">
                {turn.pending.options.map((option, i) => (
                  <Button
                    key={option}
                    variant="secondary"
                    small
                    onClick={() => answer({ choice: i })}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            )}
            {turn.actions.map(
              (a, i) =>
                a.undoId && (
                  <div key={i} className="as-bar__actions">
                    {a.undone ? (
                      <span className="small muted">Annulé : {a.message}</span>
                    ) : (
                      <Button variant="secondary" small onClick={() => undo(i)}>
                        Annuler
                      </Button>
                    )}
                  </div>
                ),
            )}
          </div>
        )}
        {error && <p className="as-bar__line error">{error}</p>}
      </div>
    </FloatingPanel>
  );
}
