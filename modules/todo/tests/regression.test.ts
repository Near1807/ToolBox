// Non-regression of the To-do (step 2 of the phone version, ADR 0044): a
// realistic base built through the API on a frozen clock (Wednesday
// 2026-11-04, 10:00 local time, then moved forward), with the Timer and a
// music library present, then the answers of every route (reads, writes,
// restores, home card), what the service `todo` gives other modules, the
// assistant's reading, the calendar and every stored row. The reference
// (fixtures/regression.json) was written by the v0.29.0 code, before the
// code was made portable.
//
// To rewrite the reference (only on purpose): TOOLBOX_WRITE_REFERENCE=1.
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestHub,
  dumpTables,
  loadModuleFolder,
  readReference,
  referenceShape,
  type TestHub,
} from '@hub/sdk/testing';
import type { TodoService } from '../contract';
import type { TaskDto } from '../shared';

const MODULES = path.resolve(__dirname, '..', '..');
const API = '/api/modules/todo';
const REFERENCE = path.join(__dirname, 'fixtures', 'regression.json');
const NOW = new Date(2026, 10, 4, 10, 0, 0);

type Services = { optional: <T>(name: string) => T | null };
/** A fake module: a music library with two tracks, and a hand on the services of the others. */
function fakeLibrary(probe: { services?: Services }) {
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

describe('non-regression of the To-do (reference: v0.29.0)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  it('same answers of every route, same service, same stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const later = (minutes: number) => vi.setSystemTime(Date.now() + minutes * 60_000);
    const probe: { services?: Services } = {};
    hub = await createTestHub({
      loadExamples: false,
      modules: [
        fakeLibrary(probe) as never,
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

    await call('GET', '/tasks');
    await call('GET', '/today');
    const mix = await call<TaskDto>('POST', '/tasks', {
      title: '  Finir le mix ',
      tags: ['#Mix', 'mix', 'studio session'],
      due: 'demain',
      trackId: 1,
    });
    later(3);
    const bio = await call<TaskDto>('POST', '/tasks', {
      title: 'Mettre à jour la bio',
      due: 'vendredi',
    });
    later(1);
    const late = await call<TaskDto>('POST', '/tasks', {
      title: 'Payer la facture',
      due: '2026-11-02',
      tags: ['admin'],
    });
    later(1);
    await call('POST', '/tasks', { title: 'Sans date', tags: ['idée'] });
    await call('POST', '/tasks', { title: 'Aujourd’hui', due: 'aujourd’hui' });
    await call('POST', '/tasks', { title: 'Dans trois jours', due: 'dans 3 jours', trackId: 2 });
    await call('POST', '/tasks', { title: 'Morceau absent', trackId: 99 });
    await call('POST', '/tasks', { title: '' }); // refused
    await call('POST', '/tasks', { title: 'Date impossible', due: 'quand je veux' });
    later(10);
    // Edits: ticked, unticked, re-ticked; due moved and removed; tags; track.
    await call('PATCH', `/tasks/${late.id}`, { done: true });
    later(2);
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
    later(5);
    const todo = probe.services!.optional<TodoService>('todo')!;
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
    later(60);
    await call('GET', '/tasks');
    await call('GET', '/today');
    const assistant = {
      list: await hub.hub.assistant.run('todo.list-tasks', {}),
      today: await hub.hub.assistant.run('todo.list-tasks', { filter: 'today' }),
      tags: await hub.hub.assistant.run('todo.list-tags', {}),
      done: await hub.hub.assistant.run('todo.list-tasks', { filter: 'done' }),
      tag: await hub.hub.assistant.run('todo.list-tasks', { filter: 'all', tag: 'mix' }),
      add: await hub.hub.assistant.run('todo.add-task', { title: 'Interdit' }),
    };
    const calendar = await hub.request('GET', '/api/core/calendar?from=2026-11-01&to=2026-11-15');

    const snapshot = referenceShape(
      {
        steps,
        service,
        assistant,
        calendar: calendar.body,
        tables: dumpTables(hub.dataDir, 'todo'),
      },
      NOW.getTime(),
    );
    expect(snapshot).toEqual(readReference(REFERENCE, snapshot));
  });
});
