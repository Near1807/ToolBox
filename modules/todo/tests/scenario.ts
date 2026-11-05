// The scenario of the To-do's non-regression reference (regression.test.ts),
// shared by the PC (better-sqlite3, Fastify) and the phone (sqlite-wasm, its
// mini router: regression-phone.test.ts) — the same requests, in the same
// order, on the same frozen clock.
import path from 'node:path';
import type { TodoService } from '../contract';
import type { TaskDto } from '../shared';

export const MODULES = path.resolve(__dirname, '..', '..');
export const REFERENCE = path.join(__dirname, 'fixtures', 'regression.json');
export const NOW = new Date(2026, 10, 4, 10, 0, 0);
const API = '/api/modules/todo';

export type Services = { optional: <T>(name: string) => T | null };
/** A fake module: a music library with two tracks, and a hand on the services of the others. */
export function fakeLibrary(probe: { services?: Services }) {
  const tracks = [
    { id: 1, title: 'Nuit blanche' },
    { id: 2, title: 'Aube' },
  ];
  return {
    folder: 'music-library',
    manifest: {
      id: 'music-library',
      name: 'Bibliothèque',
      description: 'fake',
      version: '1.0.0',
      section: 'Musique',
      icon: 'music',
      provides: { services: ['musicLibrary'] },
      dependsOn: { optionalServices: ['todo', 'timer'] },
    },
    backend: {
      register: (ctx: { services: Services & { provide: (n: string, s: object) => void } }) => {
        probe.services = ctx.services;
        ctx.services.provide('musicLibrary', {
          listTracks: () => tracks,
          getTrack: (id: number) => tracks.find((t) => t.id === id) ?? null,
          trackIdOf: (subject: string) => {
            const m = /^music-library:track:(\d+)$/.exec(subject);
            return m ? Number(m[1]) : null;
          },
          registerTrackInfo: () => () => {},
        });
      },
    },
  };
}

export interface ScenarioEnv {
  request<T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }>;
  /** The services as another module sees them (the fake library's ctx.services). */
  services(): Services;
  /** Moves the frozen clock forward. */
  later(minutes: number): void;
}

/** Every request of the reference, then what the service `todo` gives other modules. */
export async function runScenario(env: ScenarioEnv) {
  const steps: [string, unknown][] = [];
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await env.request<T>(method, `${API}${url}`, body);
    steps.push([`${method} ${url}`, { status: r.status, body: r.body }]);
    return r.body;
  };

  await call('GET', '/tasks');
  await call('GET', '/today');
  const mix = await call<TaskDto>('POST', '/tasks', {
    title: '  Finir le mix ',
    tags: ['#Mix', 'mix', 'studio session'],
    due: 'demain',
    trackId: 1,
  });
  env.later(3);
  const bio = await call<TaskDto>('POST', '/tasks', {
    title: 'Mettre à jour la bio',
    due: 'vendredi',
  });
  env.later(1);
  const late = await call<TaskDto>('POST', '/tasks', {
    title: 'Payer la facture',
    due: '2026-11-02',
    tags: ['admin'],
  });
  env.later(1);
  await call('POST', '/tasks', { title: 'Sans date', tags: ['idée'] });
  await call('POST', '/tasks', { title: 'Aujourd’hui', due: 'aujourd’hui' });
  await call('POST', '/tasks', { title: 'Dans trois jours', due: 'dans 3 jours', trackId: 2 });
  await call('POST', '/tasks', { title: 'Morceau absent', trackId: 99 });
  await call('POST', '/tasks', { title: '' }); // refused
  await call('POST', '/tasks', { title: 'Date impossible', due: 'quand je veux' });
  env.later(10);
  // Edits: ticked, unticked, re-ticked; due moved and removed; tags; track.
  await call('PATCH', `/tasks/${late.id}`, { done: true });
  env.later(2);
  await call('PATCH', `/tasks/${bio.id}`, { done: true });
  await call('PATCH', `/tasks/${bio.id}`, { done: false });
  await call('PATCH', `/tasks/${mix.id}`, { due: 'lundi prochain', tags: ['mix', 'urgent'] });
  await call('PATCH', `/tasks/${mix.id}`, { title: 'Finir le mix de « Nuit »', trackId: 2 });
  await call('PATCH', `/tasks/${bio.id}`, { due: null });
  // Deleted then restored; deleted for good; restore of something that is there.
  await call('DELETE', `/tasks/${bio.id}`);
  await call('POST', `/tasks/${bio.id}/restore`);
  await call('POST', `/tasks/${bio.id}/restore`);
  await call('DELETE', `/tasks/${late.id}`);
  await call('PATCH', '/tasks/00000000-0000-4000-8000-000000000000', { done: true });
  // What the service `todo` gives the other modules (Timer, Boîte à idées).
  env.later(5);
  const todo = env.services().optional<TodoService>('todo')!;
  const service = {
    open: todo.listOpenTasks(),
    one: todo.getTask(mix.id),
    deleted: todo.getTask(late.id),
    missing: todo.getTask('00000000-0000-4000-8000-000000000000'),
    completed: todo.completeTask(mix.id),
    uncompleted: todo.uncompleteTask(mix.id),
    created: todo.createTask({
      title: 'Depuis une idée',
      tags: ['Idée', 'mix'],
      due: 'samedi',
      trackId: 1,
    }),
    createdNoLibrary: todo.createTask({ title: 'Sans morceau', trackId: 42 }),
  };
  // Reads.
  env.later(60);
  await call('GET', '/tasks');
  await call('GET', '/today');
  const calendar = await env.request('GET', '/api/core/calendar?from=2026-11-01&to=2026-11-15');
  return { steps, service, calendar: calendar.body };
}

/** The assistant's reading of the reference (the PC only: on the phone it is without effect). */
export async function runAssistant(run: (id: string, params: object) => Promise<unknown>) {
  return {
    list: await run('todo.list-tasks', {}),
    today: await run('todo.list-tasks', { filter: 'today' }),
    tags: await run('todo.list-tags', {}),
    done: await run('todo.list-tasks', { filter: 'done' }),
    tag: await run('todo.list-tasks', { filter: 'all', tag: 'mix' }),
    add: await run('todo.add-task', { title: 'Interdit' }),
  };
}
