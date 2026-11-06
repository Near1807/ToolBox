// The Timer's non-regression reference replayed on the PHONE's stack (ADR
// 0044): the same server code on sqlite-wasm and the phone host (mini
// router), with the To-do present. What the server asks of the notifications
// and of the floating window is recorded through the phone host (in the app
// both are without effect: the notifications are scheduled in advance by the
// page, there is no floating window) and equal to the PC's. Only the
// assistant's reading is left out: on the phone it is without effect.
// Also: the event stream (« session », « transition ») reaches the page like
// the PC's SSE.
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dumpWasmTables,
  loadModuleFolder,
  openWasmDatabase,
  PhoneHub,
  phoneRequest,
  readReference,
  referenceShape,
} from '@hub/sdk/testing';
import { MODULES, NOW, probeModule, REFERENCE, runScenario, type Services } from './scenario';
import { upcomingNotices } from '../shared/notices';
import type { LiveDto } from '../shared/types';

const start = async (host: Parameters<typeof PhoneHub.start>[0]['host'], probe = {}) =>
  PhoneHub.start({
    db: await openWasmDatabase(),
    modules: [
      probeModule(probe) as never,
      ...((await Promise.all(
        ['todo', 'timer'].map((id) => loadModuleFolder(path.join(MODULES, id))),
      )) as never[]),
    ],
    host,
    log: () => {},
  });

describe('the Timer on the phone (sqlite-wasm + phone host) = the reference', () => {
  let hub: PhoneHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
    vi.useRealTimers();
  });

  it('same states, phases, answers, notifications, service and stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const probe: { services?: Services } = {};
    const notes: string[] = [];
    const overlay: boolean[] = [];
    const db = await openWasmDatabase();
    hub = await PhoneHub.start({
      db,
      modules: [
        probeModule(probe) as never,
        ...((await Promise.all(
          ['todo', 'timer'].map((id) => loadModuleFolder(path.join(MODULES, id))),
        )) as never[]),
      ],
      host: {
        notify: (n) => notes.push(`${n.title} — ${n.body ?? ''}`),
        setOverlay: (visible) => overlay.push(visible),
      },
      log: () => {},
    });
    expect(hub.modules().map((m) => [m.id, m.status])).toEqual([
      ['probe', 'loaded'],
      ['todo', 'loaded'],
      ['timer', 'loaded'],
    ]);
    const phone = hub;
    const { steps, service, calendar } = await runScenario({
      request: (method, url, body) => phoneRequest(phone, method, url, body),
      services: () => probe.services!,
      later: (seconds) => vi.setSystemTime(Date.now() + seconds * 1000),
    });
    const snapshot = referenceShape(
      { steps, service, notes, overlay, calendar, tables: dumpWasmTables(db, 'timer') },
      NOW.getTime(),
    );
    const { assistant: _assistant, ...reference } = readReference(REFERENCE, undefined) as Record<
      string,
      unknown
    >;
    void _assistant;
    expect(snapshot).toEqual(reference);
  });

  it('the event stream: the state at once, then each change; closed on demand', async () => {
    hub = await start({});
    const events: [string, unknown][] = [];
    const close = hub.openStream('/api/modules/timer/events', (event, data) =>
      events.push([event, data]),
    );
    expect(close).toBeTypeOf('function');
    expect(events).toEqual([['session', expect.objectContaining({ session: null })]]);
    await phoneRequest(hub, 'POST', '/api/modules/timer/start', {
      config: { mode: 'pomodoro', workMin: 25, breakMin: 5, cycles: 2 },
    });
    const live = events.at(-1)![1] as LiveDto;
    expect(events.at(-1)![0]).toBe('session');
    expect(live.session?.status).toBe('running');
    close!();
    const count = events.length;
    await phoneRequest(hub, 'POST', '/api/modules/timer/pause');
    expect(events.length).toBe(count); // closed: nothing more
    expect(hub.openStream('/api/modules/timer/nope', () => {})).toBeNull();
  });

  it('notifications scheduled in advance: same texts as the server, at each phase end', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const notes: string[] = [];
    hub = await start({ notify: (n) => notes.push(`${n.title} — ${n.body}`) });
    const task = (
      await phoneRequest<{ id: string }>(hub, 'POST', '/api/modules/todo/tasks', { title: 'Lire' })
    ).body;
    await phoneRequest(hub, 'POST', '/api/modules/timer/start', {
      config: { mode: 'pomodoro', workMin: 20, breakMin: 5, cycles: 2 },
      taskId: task.id,
    });
    const live = (await phoneRequest<LiveDto>(hub, 'GET', '/api/modules/timer/state')).body;
    const planned = upcomingNotices(live.session, Date.now());
    const t0 = NOW.getTime();
    expect(planned.map((n) => [(n.at - t0) / 60_000, n.title])).toEqual([
      [20, 'Pause — 5 min'],
      [25, 'Au travail — 20 min'],
      [45, 'Session terminée'],
    ]);
    // The server, woken at each of those times, says the same thing.
    for (const n of planned) {
      vi.setSystemTime(n.at + 100);
      await phoneRequest(hub, 'GET', '/api/modules/timer/state');
    }
    expect(notes).toEqual(planned.map((n) => `${n.title} — ${n.body}`));
    // Paused: nothing to schedule; resumed: the rest, moved by the pause.
    expect(upcomingNotices({ ...live.session!, status: 'paused' }, Date.now())).toEqual([]);
  });
});
