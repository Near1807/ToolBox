// The Timer's notifications on the phone (ADR 0044): the Worker may sleep in
// the background, so the phase ends are SCHEDULED IN ADVANCE with Android
// (plugin Local Notifications, exact alarms when allowed): at start, resume
// and « +5 min » (a new list), cancelled at pause and stop (an empty list).
// The texts are the server's (modules/timer/shared/notices.ts). When the app
// is on screen, its own sound plays (the Timer's Background): the imminent
// notification is then cancelled just before it is due, so it does not ring
// twice. Nothing else is scheduled; the user's setting « notify » is obeyed.
import { LocalNotifications } from '@capacitor/local-notifications';
import { api, openEventStream } from '@hub/sdk/frontend';
import { upcomingNotices } from '../../../modules/timer/shared/notices';
import type { LiveDto } from '../../../modules/timer/shared/types';

const CHANNEL = 'timer';
/** Our notification ids: 7000, 7001… (one per phase end still to come). */
const FIRST_ID = 7000;
const MAX = 200;

export interface Planned {
  id: number;
  title: string;
  body: string;
  at: number;
}

/** What to schedule now (pure, tested): nothing when notifications are off. */
export function planNotifications(live: LiveDto | null, now: number, enabled: boolean): Planned[] {
  if (!enabled) return [];
  return upcomingNotices(live?.session ?? null, now)
    .slice(0, MAX)
    .map((n, i) => ({ id: FIRST_ID + i, title: n.title, body: n.body, at: n.at }));
}

let scheduled: Planned[] = [];
let signature = '';
let foregroundTimers: ReturnType<typeof setTimeout>[] = [];

async function notifyEnabled(): Promise<boolean> {
  try {
    const sections =
      await api.get<{ scope: string; fields: { field: { key: string }; value: unknown }[] }[]>(
        '/api/core/settings',
      );
    const field = sections
      .find((s) => s.scope === 'timer')
      ?.fields.find((f) => f.field.key === 'notify');
    return field?.value !== false;
  } catch {
    return true;
  }
}

async function apply(next: Planned[]) {
  const sig = JSON.stringify(next.map((n) => [n.id, n.at, n.title, n.body]));
  if (sig === signature) return;
  signature = sig;
  for (const t of foregroundTimers) clearTimeout(t);
  foregroundTimers = [];
  if (scheduled.length)
    await LocalNotifications.cancel({ notifications: scheduled.map((n) => ({ id: n.id })) });
  scheduled = next;
  if (!next.length) return;
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') return; // The Timer page asks, with a sentence.
  await LocalNotifications.schedule({
    notifications: next.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      channelId: CHANNEL,
      schedule: { at: new Date(n.at), allowWhileIdle: true },
    })),
  });
  // On screen, the app's own sound plays: the notification is withdrawn just before.
  for (const n of next) {
    const wait = n.at - Date.now() - 1500;
    if (wait <= 0) continue;
    foregroundTimers.push(
      setTimeout(() => {
        if (document.visibilityState === 'visible' && Date.now() < n.at)
          void LocalNotifications.cancel({ notifications: [{ id: n.id }] });
      }, wait),
    );
  }
}

/** Follows the Timer's session for the whole life of the app (started once). */
export function startTimerNotifications(): void {
  void LocalNotifications.createChannel({
    id: CHANNEL,
    name: 'Timer',
    description: 'Fin des phases et des sessions du Timer',
    importance: 5,
    visibility: 1,
    vibration: true,
  }).catch(() => undefined);
  let live: LiveDto | null = null;
  const refresh = async () => {
    const enabled = await notifyEnabled();
    await apply(planNotifications(live, Date.now(), enabled)).catch(() => undefined);
  };
  openEventStream('/api/modules/timer/events', {
    session: (data) => {
      live = data as LiveDto;
      void refresh();
    },
  });
  // Back on screen: the list is made again from the real time (and the setting).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      signature = '';
      void refresh();
    }
  });
}
