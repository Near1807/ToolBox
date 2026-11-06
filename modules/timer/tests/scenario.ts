// The scenario of the Timer's non-regression reference (regression.test.ts),
// shared by the PC (better-sqlite3, Fastify) and the phone (sqlite-wasm, its
// mini router: regression-phone.test.ts) — the same requests, in the same
// order, on the same frozen clock.
import path from 'node:path';
import type { TimerService } from '../contract';

export const MODULES = path.resolve(__dirname, '..', '..');
export const REFERENCE = path.join(__dirname, 'fixtures', 'regression.json');
export const NOW = new Date(2026, 10, 4, 10, 0, 0);
const API = '/api/modules/timer';

export type Services = { optional: <T>(name: string) => T | null };
/** A fake module with a hand on the services of the others. */
export function probeModule(probe: { services?: Services }) {
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

export interface ScenarioEnv {
  request<T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }>;
  /** The services as another module sees them (the probe's ctx.services). */
  services(): Services;
  /** Moves the frozen clock forward (seconds). */
  later(seconds: number): void;
}

/** Every request of the reference, and what the service `timer` gives on the way. */
export async function runScenario(env: ScenarioEnv) {
  const steps: [string, unknown][] = [];
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await env.request<T>(method, `${API}${url}`, body);
    steps.push([`${method} ${url}`, { status: r.status, body: r.body }]);
    return r.body;
  };
  const state = () => call('GET', '/state');
  const timer = () => env.services().optional<TimerService>('timer')!;
  const service: [string, unknown][] = [];
  const look = (label: string) =>
    service.push([label, { current: timer().current(), timeByTask: timer().timeByTask() }]);

  const task = (
    await env.request<{ id: string }>('POST', '/api/modules/todo/tasks', {
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
  env.later(240);
  await call('POST', '/pause');
  env.later(120);
  await state();
  await call('POST', '/resume');
  env.later(360);
  await state();
  await call('POST', '/dismiss');

  // A pomodoro on the task: extended, the break skipped, to the end.
  env.later(60);
  await call('POST', '/start', {
    config: { mode: 'pomodoro', workMin: 20, breakMin: 5, cycles: 2 },
    taskId: task.id,
  });
  env.later(600);
  look('pomodoro running');
  await call('POST', '/extend', { minutes: 5 });
  await call('POST', '/extend', { minutes: 0 }); // refused
  env.later(900);
  await state(); // in the break
  look('pomodoro break');
  await call('POST', '/skip');
  env.later(1200);
  await state(); // ended: « Tâche terminée ? »
  await call('POST', '/answer', { done: true });
  await env.request('GET', '/api/modules/todo/tasks').then((r) => steps.push(['todo', r.body]));
  await call('POST', '/answer/undo');
  await call('POST', '/answer/undo'); // nothing left
  await call('POST', '/answer', { done: false });
  await state(); // « Relancer » offered
  look('after the pomodoro');

  // An incremental pomodoro stopped during its second work period.
  env.later(300);
  await call('POST', '/start', {
    config: { mode: 'incremental', startMin: 10, stepMin: 5, maxMin: 30, breakMin: 2, cycles: 3 },
    name: 'Montée',
  });
  env.later(60 * 14);
  await state();
  await call('POST', '/stop');
  await call('POST', '/pause'); // nothing running: refused
  env.later(30);
  await state();
  look('end');

  const calendar = await env.request('GET', '/api/core/calendar?from=2026-11-01&to=2026-11-08');
  return { steps, service, calendar: calendar.body };
}
