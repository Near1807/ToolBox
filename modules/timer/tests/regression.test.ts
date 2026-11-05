// Non-regression of the Timer (step 2 of the phone version, ADR 0044): on a
// frozen clock (Wednesday 2026-11-04, 10:00 local time) moved forward by
// hand, with the To-do present: presets, a simple timer, a pomodoro linked to
// a task through its phases (pause, resume, extend, skip, the end, « Tâche
// terminée ? », « Oui », « Annuler », « Non »), a stopped incremental
// pomodoro; the state at each step, the notifications and the floating
// window, what the service `timer` gives the To-do, the assistant's reading,
// the calendar and every stored row. The reference (fixtures/regression.json)
// was written by the v0.29.0 code, before the code was made portable.
//
// To rewrite the reference (only on purpose): TOOLBOX_WRITE_REFERENCE=1.
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestHost,
  createTestHub,
  dumpTables,
  loadModuleFolder,
  readReference,
  referenceShape,
  type TestHub,
} from '@hub/sdk/testing';
import type { TimerService } from '../contract';

const MODULES = path.resolve(__dirname, '..', '..');
const API = '/api/modules/timer';
const REFERENCE = path.join(__dirname, 'fixtures', 'regression.json');
const NOW = new Date(2026, 10, 4, 10, 0, 0);

type Services = { optional: <T>(name: string) => T | null };
/** A fake module with a hand on the services of the others. */
function probeModule(probe: { services?: Services }) {
  return {
    folder: 'probe',
    manifest: {
      id: 'probe',
      name: 'Sonde',
      description: 'fake',
      version: '1.0.0',
      section: 'Outils',
      icon: 'search',
      dependsOn: { optionalServices: ['timer', 'todo'] },
    },
    backend: {
      register: (ctx: { services: Services }) => {
        probe.services = ctx.services;
      },
    },
  };
}

describe('non-regression of the Timer (reference: v0.29.0)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  it('same states, phases, answers, service and stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const later = (seconds: number) => vi.setSystemTime(Date.now() + seconds * 1000);
    const probe: { services?: Services } = {};
    const notes: string[] = [];
    const overlay: boolean[] = [];
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({
        notify: (n) => notes.push(`${n.title} — ${n.body ?? ''}`),
        setOverlayVisible: (visible) => overlay.push(visible),
      }),
      modules: [
        probeModule(probe) as never,
        ...(await Promise.all(
          ['todo', 'timer'].map((id) => loadModuleFolder(path.join(MODULES, id))),
        )),
      ],
    });
    const steps: [string, unknown][] = [];
    const call = async <T>(method: string, url: string, body?: unknown) => {
      const r = await hub.request<T>(method, `${API}${url}`, body);
      steps.push([`${method} ${url}`, { status: r.status, body: r.body }]);
      return r.body;
    };
    const state = () => call('GET', '/state');
    const timer = () => probe.services!.optional<TimerService>('timer')!;
    const service: [string, unknown][] = [];
    const look = (label: string) =>
      service.push([label, { current: timer().current(), timeByTask: timer().timeByTask() }]);

    const task = (
      await hub.request<{ id: string }>('POST', '/api/modules/todo/tasks', {
        title: 'Écrire le texte',
        tags: ['écriture'],
      })
    ).body;
    await state();
    look('empty');
    // Presets: two kept, one refused, one deleted.
    const pomo = await call<{ id: string }>('POST', '/presets', {
      name: 'Pomodoro classique',
      config: {
        mode: 'pomodoro',
        workMin: 25,
        breakMin: 5,
        cycles: 4,
        longBreakMin: 15,
        longBreakEvery: 4,
      },
    });
    await call('POST', '/presets', {
      name: 'Montée',
      config: {
        mode: 'incremental',
        startMin: 10,
        stepPct: 50,
        maxMin: 40,
        breakMin: 5,
        totalMin: 120,
      },
    });
    await call('POST', '/presets', { name: 'Vide', config: { mode: 'pomodoro', workMin: 25 } });
    await call('POST', '/presets', { name: '', config: { mode: 'simple', workMin: 5 } });
    const gone = await call<{ id: string }>('POST', '/presets', {
      name: 'À jeter',
      config: { mode: 'simple', workMin: 3 },
    });
    await call('DELETE', `/presets/${gone.id}`);
    void pomo;

    // A simple timer of 10 min, paused, resumed, to the end, then dismissed.
    await call('POST', '/start', { config: { mode: 'simple', workMin: 10 }, name: 'Lecture' });
    await call('POST', '/start', { config: { mode: 'simple', workMin: 10 } }); // already one: refused
    later(240);
    await call('POST', '/pause');
    later(120);
    await state();
    await call('POST', '/resume');
    later(360);
    await state();
    await call('POST', '/dismiss');

    // A pomodoro on the task: extended, the break skipped, to the end.
    later(60);
    await call('POST', '/start', {
      config: { mode: 'pomodoro', workMin: 20, breakMin: 5, cycles: 2 },
      taskId: task.id,
    });
    later(600);
    look('pomodoro running');
    await call('POST', '/extend', { minutes: 5 });
    await call('POST', '/extend', { minutes: 0 }); // refused
    later(900);
    await state(); // in the break
    look('pomodoro break');
    await call('POST', '/skip');
    later(1200);
    await state(); // ended: « Tâche terminée ? »
    await call('POST', '/answer', { done: true });
    await hub.request('GET', '/api/modules/todo/tasks').then((r) => steps.push(['todo', r.body]));
    await call('POST', '/answer/undo');
    await call('POST', '/answer/undo'); // nothing left
    await call('POST', '/answer', { done: false });
    await state(); // « Relancer » offered
    look('after the pomodoro');

    // An incremental pomodoro stopped during its second work period.
    later(300);
    await call('POST', '/start', {
      config: { mode: 'incremental', startMin: 10, stepMin: 5, maxMin: 30, breakMin: 2, cycles: 3 },
      name: 'Montée',
    });
    later(60 * 14);
    await state();
    await call('POST', '/stop');
    await call('POST', '/pause'); // nothing running: refused
    later(30);
    await state();
    look('end');

    const assistant = {
      status: await hub.hub.assistant.run('timer.timer-status', {}),
      start: await hub.hub.assistant.run('timer.start-timer', { minutes: 5 }),
    };
    const calendar = await hub.request('GET', '/api/core/calendar?from=2026-11-01&to=2026-11-08');

    const snapshot = referenceShape(
      {
        steps,
        service,
        notes,
        overlay,
        assistant,
        calendar: calendar.body,
        tables: dumpTables(hub.dataDir, 'timer'),
      },
      NOW.getTime(),
    );
    expect(snapshot).toEqual(readReference(REFERENCE, snapshot));
  });
});
