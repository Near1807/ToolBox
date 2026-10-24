// The session in progress, live: received from the backend (server-sent
// events) and counted down on screen from the real time, never from a counter.
import { useEffect, useRef, useState } from 'react';
import { openEventStream, useModule } from '@hub/sdk/frontend';
import { stateAt, type PhaseState } from '../shared/plan';
import type { SessionDto, TransitionEvent } from '../shared/types';

/** Active seconds elapsed now (the backend's value plus the time since it was sent). */
export function elapsedNow(session: SessionDto, now = Date.now()): number {
  return (
    session.elapsed +
    (session.status === 'running' ? Math.max(0, (now - Date.parse(session.at)) / 1000) : 0)
  );
}

/**
 * The session and where it stands, refreshed several times a second.
 * `onTransition` is called when a phase starts or the session ends.
 */
export function useLiveSession(onTransition?: (event: TransitionEvent) => void): {
  session: SessionDto | null;
  state: PhaseState | null;
  connected: boolean;
  now: number;
} {
  const module = useModule();
  const url = module.url('/events');
  const [session, setSession] = useState<SessionDto | null>(null);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The latest handler, read when an event arrives (the stream is opened once).
  const handler = useRef(onTransition);
  useEffect(() => {
    handler.current = onTransition;
  });
  useEffect(
    () =>
      openEventStream(url, {
        session: (data) => {
          setConnected(true);
          setSession((data as { session: SessionDto | null }).session);
          setNow(Date.now());
        },
        transition: (data) => handler.current?.(data as TransitionEvent),
      }),
    [url],
  );
  useEffect(() => {
    if (session?.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [session?.status]);
  const state = session ? stateAt(session.phases, elapsedNow(session, now)) : null;
  return { session, state, connected, now };
}

/** The current time, refreshed every `ms` (for estimated end times). */
export function useClock(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
