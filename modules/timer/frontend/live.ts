// The session in progress, live: received from the backend (server-sent
// events) and counted down on screen from the real time, never from a counter.
import { useEffect, useRef, useState } from 'react';
import { openEventStream, useModule } from '@hub/sdk/frontend';
import { stateAt, type PhaseState } from '../shared/plan';
import type {
  FloatingDto,
  LiveDto,
  SessionDto,
  ToastEvent,
  TransitionEvent,
} from '../shared/types';

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
export function useLiveSession(
  onTransition?: (event: TransitionEvent) => void,
  onToast?: (event: ToastEvent) => void,
): {
  session: SessionDto | null;
  state: PhaseState | null;
  /** After « Non » : the session to restart, until « Plus tard ». */
  followUp: SessionDto | null;
  floating: FloatingDto | null;
  connected: boolean;
  now: number;
} {
  const module = useModule();
  const url = module.url('/events');
  const [live, setLive] = useState<LiveDto | null>(null);
  const session = live?.session ?? null;
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The latest handler, read when an event arrives (the stream is opened once).
  const handler = useRef(onTransition);
  const toastHandler = useRef(onToast);
  useEffect(() => {
    handler.current = onTransition;
    toastHandler.current = onToast;
  });
  useEffect(
    () =>
      openEventStream(url, {
        session: (data) => {
          setConnected(true);
          setLive(data as LiveDto);
          setNow(Date.now());
        },
        transition: (data) => handler.current?.(data as TransitionEvent),
        toast: (data) => toastHandler.current?.(data as ToastEvent),
      }),
    [url],
  );
  useEffect(() => {
    if (session?.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [session?.status]);
  const state = session ? stateAt(session.phases, elapsedNow(session, now)) : null;
  return {
    session,
    state,
    followUp: live?.followUp ?? null,
    floating: live?.floating ?? null,
    connected,
    now,
  };
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
