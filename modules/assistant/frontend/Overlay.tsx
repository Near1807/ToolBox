// The assistant in the floating window (always on top, even with ToolBox
// minimised): the indicator (listening / thinking / speaking, with what was
// heard or said) and the written command bar (Bar.tsx).
import { useEffect, useState } from 'react';
import { FloatingPanel, openEventStream, useModule } from '@hub/sdk/frontend';
import type { BarEvent, StateEvent, TurnDto } from '../shared';
import { CommandBar } from './Bar';
import './assistant.css';

const LABELS: Record<StateEvent['state'], string> = {
  idle: '',
  listening: 'J’écoute…',
  transcribing: 'Je transcris…',
  thinking: 'Je réfléchis…',
  speaking: 'Je réponds',
};

/** The last answer stays this long in the floating window. */
const ANSWER_MS = 6_000;

export function Overlay() {
  const module = useModule();
  const url = module.url('/events');
  const [state, setState] = useState<StateEvent | null>(null);
  const [bar, setBar] = useState(false);
  const [barTurn, setBarTurn] = useState<TurnDto | null>(null);
  useEffect(
    () =>
      openEventStream(url, {
        state: (data) => setState(data as StateEvent),
        bar: (data) => {
          setBar((data as BarEvent).open);
          setBarTurn(null);
        },
        // Updates of the bar's own turn (answer, undo).
        turn: (data) => {
          const turn = data as TurnDto;
          if (turn.source === 'bar') setBarTurn(turn);
        },
      }),
    [url],
  );
  // The bar shows its own answer: no indicator next to it.
  if (bar) return <CommandBar turn={barTurn} onTurn={setBarTurn} />;
  if (!state) return null;
  const idle = state.state === 'idle';
  if (idle && !state.text) return null;
  // Listening / thinking / speaking stays; the last answer goes after a few
  // seconds (a question waits), so that it never sits above the mini-timer.
  const question = idle && /\?\s*$/.test(state.text ?? '');
  return (
    <FloatingPanel
      label="Assistant"
      lifetimeMs={idle && !question ? ANSWER_MS : undefined}
      contentKey={`${state.state}|${state.text ?? ''}`}
    >
      <div
        className={`as-hud as-hud--${state.state}${state.state === 'listening' && !state.ready ? ' as-hud--opening' : ''}`}
        role="status"
      >
        <span className="as-hud__dot" aria-hidden />
        <div className="as-hud__text">
          <strong>
            {idle
              ? 'Assistant'
              : state.state === 'listening'
                ? state.ready
                  ? 'Parle, je t’écoute'
                  : 'Micro…'
                : LABELS[state.state]}
            <span className={`as-hud__ai${state.ai ? ' as-hud__ai--on' : ''}`}>
              {state.ai ? 'IA' : 'sans IA'}
            </span>
          </strong>
          {state.state === 'listening' && state.toggle && <span>Appuie à nouveau pour finir</span>}
          {state.text && state.state !== 'listening' && <span>{state.text}</span>}
        </div>
      </div>
    </FloatingPanel>
  );
}
