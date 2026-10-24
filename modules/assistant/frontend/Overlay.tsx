// The floating indicator (always on top, even with ToolBox minimised):
// listening / thinking / speaking, with what was heard or said.
import { useEffect, useState } from 'react';
import { openEventStream, useModule } from '@hub/sdk/frontend';
import type { StateEvent } from '../shared';
import './assistant.css';

const LABELS: Record<StateEvent['state'], string> = {
  idle: '',
  listening: 'J’écoute…',
  transcribing: 'Je transcris…',
  thinking: 'Je réfléchis…',
  speaking: 'Je réponds',
};

export function Overlay() {
  const module = useModule();
  const url = module.url('/events');
  const [state, setState] = useState<StateEvent | null>(null);
  useEffect(() => openEventStream(url, { state: (data) => setState(data as StateEvent) }), [url]);
  if (!state) return null;
  const idle = state.state === 'idle';
  if (idle && !state.text) return null;
  return (
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
  );
}
