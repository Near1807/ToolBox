// The Timer in the floating window (over the application in use, ToolBox
// minimised): the mini-timer, phase changes for a few seconds, and at the end
// « Tâche terminée ? » with the same effects as on the page (nothing is ticked
// without the click on « Oui, la cocher »). MODULES.md §5.16.
import { useEffect, useState } from 'react';
import { Button, errorMessage, FloatingPanel, useApi, useModule } from '@hub/sdk/frontend';
import { clock, duration, phaseLabel, totalSeconds } from '../shared/plan';
import type { SessionDto, StateDto, ToastEvent } from '../shared/types';
import { useLiveSession } from './live';

const TOAST_MS = 5_000;
/** How long « Annuler » stays after « Oui, la cocher ». */
const UNDO_MS = 8_000;

export function Overlay() {
  const module = useModule();
  const [toast, setToast] = useState<(ToastEvent & { at: number }) | null>(null);
  const live = useLiveSession(undefined, (event) => setToast({ ...event, at: Date.now() }));
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);
  const { session, state, followUp, floating } = live;
  const ended = session?.status === 'ended';
  // Whether the To-do is there (« Oui, la cocher » needs it): asked at the end only.
  const data = useApi<StateDto>(ended ? module.url(`/state?end=${session.id}`) : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // « Oui, la cocher » done: « Annuler » for a few seconds.
  const [undo, setUndo] = useState<{ title: string } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(id);
  }, [undo]);
  if (!floating) return null;

  const post = async <T,>(path: string, body?: unknown): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await module.api.post<T>(path, body);
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const restart = (s: SessionDto) =>
    void post('/start', { config: s.config, name: s.name, taskId: s.taskId });
  const errorLine = error && <p className="tm-float__error">{error}</p>;

  return (
    <>
      {undo && (
        <FloatingPanel label="Timer : annuler" interactive>
          <div className="tm-float tm-float--undo" role="status">
            <p className="tm-float__question">
              Cochée : <strong>{undo.title}</strong>
            </p>
            <div className="tm-float__actions">
              <Button
                variant="secondary"
                small
                disabled={busy}
                onClick={() =>
                  void post('/answer/undo').then(() => {
                    setUndo(null);
                    // « Tâche cochée… » is no longer true.
                    setToast(null);
                  })
                }
              >
                Annuler
              </Button>
            </div>
            {errorLine}
          </div>
        </FloatingPanel>
      )}
      {toast && !(undo && toast.tone === 'done') && (
        <FloatingPanel label="Timer : changement">
          <div
            className={`tm-hud tm-hud--${toast.tone === 'work' ? 'work' : toast.tone === 'break' ? 'break' : 'end'}`}
            role="status"
          >
            <span className="tm-hud__dot" aria-hidden />
            <span className="tm-hud__label">{toast.label}</span>
          </div>
        </FloatingPanel>
      )}
      {ended && floating.question && (
        <FloatingPanel label="Timer : session terminée" interactive>
          <div className="tm-float" role="dialog" aria-label="Session terminée">
            {session.taskId !== null && data.data?.todo !== false ? (
              <>
                <p className="tm-float__question">
                  Tâche terminée : <strong>{session.taskTitle}</strong> ?
                </p>
                <div className="tm-float__actions">
                  <Button
                    small
                    disabled={busy || !data.data}
                    onClick={() =>
                      void post<{ ticked: boolean }>('/answer', { done: true }).then(
                        (r) => r?.ticked && setUndo({ title: session.taskTitle ?? '' }),
                      )
                    }
                  >
                    Oui, la cocher
                  </Button>
                  <Button
                    variant="secondary"
                    small
                    disabled={busy || !data.data}
                    onClick={() => void post('/answer', { done: false })}
                  >
                    Non
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="tm-float__question">
                  Session terminée · <span className="muted">{session.name}</span>
                </p>
                <div className="tm-float__actions">
                  <Button small disabled={busy} onClick={() => restart(session)}>
                    Relancer (même programme, {duration(totalSeconds(session.phases))})
                  </Button>
                  <Button
                    variant="secondary"
                    small
                    disabled={busy}
                    onClick={() => void post('/dismiss')}
                  >
                    Fermer
                  </Button>
                </div>
              </>
            )}
            {errorLine}
          </div>
        </FloatingPanel>
      )}
      {!session && followUp && floating.question && (
        <FloatingPanel label="Timer : relancer" interactive>
          <div className="tm-float" role="dialog" aria-label="Relancer une session">
            <p className="tm-float__question">
              Pas encore terminée : <strong>{followUp.taskTitle}</strong>
            </p>
            <div className="tm-float__actions">
              <Button small disabled={busy} onClick={() => restart(followUp)}>
                Relancer (même programme, {duration(totalSeconds(followUp.phases))})
              </Button>
              <Button
                variant="secondary"
                small
                disabled={busy}
                onClick={() => void post('/dismiss')}
              >
                Plus tard
              </Button>
            </div>
            {errorLine}
          </div>
        </FloatingPanel>
      )}
      {session && state && !ended && floating.timer && (
        <FloatingPanel label="Timer">
          <div
            className={`tm-hud tm-hud--${state.phase?.kind === 'work' ? 'work' : 'break'}`}
            role="status"
          >
            <span className="tm-hud__dot" aria-hidden />
            <span className="tm-hud__phase">{phaseLabel(session.status, state.phase)}</span>
            <span className="tm-hud__time">{clock(state.remaining)}</span>
          </div>
        </FloatingPanel>
      )}
    </>
  );
}
