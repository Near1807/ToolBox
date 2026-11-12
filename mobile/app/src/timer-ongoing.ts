// The Timer's ongoing notification on the phone (ADR 0044, v0.33.0), the
// page's side: it follows the Timer's session (its event stream) and gives
// the WHOLE plan to the native plugin (android/…/TimerOngoingPlugin.java) at
// start, pause, resume and « +5 min », or removes it (stop, end, session
// stopped by the other device). The plugin then moves from phase to phase by
// itself (the Worker sleeps in the background). Texts: the server's
// (modules/timer/shared/notices.ts).
// Its buttons (« Pause » / « Reprendre », « Arrêter ») OPEN the app, which
// does the action through the Timer's server: the server is the only truth,
// and it runs only while the app is open (no change made by Android alone).
// Setting « Afficher le timer en cours dans les notifications »: on by default.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { api, openEventStream } from '@hub/sdk/frontend';
import { ongoingPlan, type OngoingPlan } from '../../../modules/timer/shared/notices';
import type { LiveDto } from '../../../modules/timer/shared/types';

interface Opened {
  route?: string;
  action?: string | null;
}

const Native = registerPlugin<{
  show(o: { plan: OngoingPlan }): Promise<void>;
  clear(): Promise<void>;
  pending(): Promise<Opened>;
  addListener(event: 'open', handler: (e: Opened) => void): Promise<PluginListenerHandle>;
}>('TimerOngoing');

const SETTING = 'toolbox.timer.ongoing';

/** « Afficher le timer en cours dans les notifications » (this phone; on by default). */
export function ongoingEnabled(): boolean {
  try {
    return localStorage.getItem(SETTING) !== '0';
  } catch {
    return true;
  }
}

let refresh: (() => void) | null = null;

export function setOngoingEnabled(on: boolean): void {
  try {
    localStorage.setItem(SETTING, on ? '1' : '0');
  } catch {
    // Not kept: the default stays.
  }
  refresh?.();
}

/** What the plugin must show now (pure, tested): null removes the notification. */
export function ongoingFor(
  live: LiveDto | null,
  now: number,
  enabled: boolean,
): OngoingPlan | null {
  return enabled ? ongoingPlan(live?.session ?? null, now) : null;
}

const ACTIONS = new Set(['pause', 'resume', 'stop']);

/** The app opened from the notification: the Timer, and its button's action. */
async function opened(e: Opened) {
  if (e.route) window.location.hash = `#${e.route}`;
  if (e.action && ACTIONS.has(e.action))
    await api.post(`/api/modules/timer/${e.action}`).catch(() => undefined);
}

/** Follows the Timer's session for the whole life of the app (started once). */
export function startTimerOngoing(): void {
  let live: LiveDto | null = null;
  let signature = '';
  const apply = () => {
    const plan = ongoingFor(live, Date.now(), ongoingEnabled());
    // The same plan (same phases, same ends): nothing to give again.
    const sig = plan
      ? JSON.stringify([
          plan.sessionId,
          plan.status,
          plan.steps,
          plan.status === 'paused' ? plan.remaining : 0,
        ])
      : '';
    if (sig === signature) return;
    signature = sig;
    void (plan ? Native.show({ plan }) : Native.clear()).catch(() => undefined);
  };
  refresh = () => {
    signature = '-';
    apply();
  };
  openEventStream('/api/modules/timer/events', {
    session: (data) => {
      live = data as LiveDto;
      apply();
    },
  });
  void Native.addListener('open', (e) => void opened(e)).catch(() => undefined);
  void Native.pending()
    .then(opened)
    .catch(() => undefined);
}
