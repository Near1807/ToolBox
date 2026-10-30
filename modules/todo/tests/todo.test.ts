import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrackInfoProvider } from '../../music-library/contract';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { localToday, addDays } from '../dates';
import type { TaskDto, TasksResponse } from '../shared';

const MODULE_DIR = path.resolve(__dirname, '..');
const API = '/api/modules/todo';

/** A music library with two tracks (only what the To-do uses). */
function fakeLibrary(infos: TrackInfoProvider[]) {
  const tracks = [
    { id: 1, title: 'Boum Boum' },
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
      icon: '🎵',
      provides: { services: ['musicLibrary'] },
    },
    backend: {
      register: (ctx: { services: { provide: (n: string, s: object) => void } }) =>
        ctx.services.provide('musicLibrary', {
          listTracks: () => tracks,
          getTrack: (id: number) => tracks.find((t) => t.id === id) ?? null,
          trackIdOf: (subject: string) => {
            const m = /^music-library:track:(\d+)$/.exec(subject);
            return m ? Number(m[1]) : null;
          },
          registerTrackInfo: (provider: TrackInfoProvider) => {
            infos.push(provider);
            return () => {};
          },
        }),
    },
  };
}

describe('To-do', () => {
  let hub: TestHub;
  const infos: TrackInfoProvider[] = [];
  const today = localToday();

  beforeEach(async () => {
    infos.length = 0;
    hub = await createTestHub({
      modules: [fakeLibrary(infos) as never, await loadModuleFolder(MODULE_DIR)],
    });
  });
  afterEach(async () => {
    await hub.close();
  });

  const add = (body: object) => hub.request<TaskDto>('POST', `${API}/tasks`, body);
  const list = async () => (await hub.request<TasksResponse>('GET', `${API}/tasks`)).body;

  it('creates, edits, ticks and lists tasks, open ones by due date', async () => {
    const later = await add({ title: '  Mettre à jour la bio ', due: 'dans 3 jours' });
    expect(later.status).toBe(200);
    expect(later.body).toMatchObject({
      title: 'Mettre à jour la bio',
      due: addDays(today, 3),
      done: false,
    });
    await add({ title: 'Sans date' });
    const soon = await add({
      title: 'Finir le mix',
      tags: ['#Mix', 'mix', 'studio session'],
      due: 'demain',
      trackId: 1,
    });
    expect(soon.body).toMatchObject({
      tags: ['mix', 'studio-session'],
      track: { id: 1, title: 'Boum Boum' },
    });

    let body = await list();
    expect(body.tasks.map((t) => t.title)).toEqual([
      'Finir le mix',
      'Mettre à jour la bio',
      'Sans date',
    ]);
    expect(body.tags).toEqual([
      { name: 'mix', count: 1 },
      { name: 'studio-session', count: 1 },
    ]);
    expect(body.library).toBe(true);
    expect(body.tracks).toHaveLength(2);

    await hub.request('PATCH', `${API}/tasks/${soon.body.id}`, {
      done: true,
      title: 'Finir le mix final',
    });
    await hub.request('PATCH', `${API}/tasks/${later.body.id}`, { due: null, tags: 'bio' });
    body = await list();
    expect(body.tasks.at(-1)).toMatchObject({ title: 'Finir le mix final', done: true });
    expect(body.tasks.find((t) => t.id === later.body.id)).toMatchObject({
      due: null,
      tags: ['bio'],
    });
  });

  it('refuses bad input with clear messages', async () => {
    expect((await add({ title: '' })).body).toEqual({
      error: 'Le titre de la tâche est obligatoire',
    });
    expect((await add({ title: 'x', due: 'un jour' })).body).toMatchObject({
      error: expect.stringMatching(/pas comprise/),
    });
    expect((await add({ title: 'x', trackId: 99 })).status).toBe(400);
    // Ids are UUIDs (« Prêt pour la synchro »): a number is not one.
    expect((await hub.request('PATCH', `${API}/tasks/999`, { done: true })).status).toBe(400);
    const unknown = '0b0e8a3c-1d2f-4a5b-8c6d-7e8f9a0b1c2d';
    expect((await hub.request('PATCH', `${API}/tasks/${unknown}`, { done: true })).status).toBe(404);
  });

  it('deletes and restores a task (« Annuler »)', async () => {
    const task = await add({ title: 'À supprimer', tags: ['x'], due: 'demain' });
    expect((await hub.request('DELETE', `${API}/tasks/${task.body.id}`)).status).toBe(200);
    expect((await list()).tasks).toHaveLength(0);
    const restored = await hub.request<TaskDto>('POST', `${API}/tasks/${task.body.id}/restore`);
    expect(restored.body).toMatchObject({ id: task.body.id, title: 'À supprimer', tags: ['x'] });
    expect((await hub.request('POST', `${API}/tasks/${task.body.id}/restore`)).status).toBe(404);
  });

  it('shows what is due today on the home widget and on the track page', async () => {
    await add({ title: 'En retard', due: addDays(today, -2), trackId: 1 });
    await add({ title: 'Aujourd’hui', due: 'aujourd’hui' });
    await add({ title: 'Plus tard', due: 'dans 10 jours', trackId: 1 });
    const { body } = await hub.request<{ open: number; due: TaskDto[] }>('GET', `${API}/today`);
    expect(body.open).toBe(3);
    expect(body.due.map((t) => t.title)).toEqual(['En retard', 'Aujourd’hui']);
    const info = infos.find((i) => i.moduleId === 'todo')!;
    expect(info.get(1)).toMatch(/^2 à faire : En retard \(.+\) · Plus tard \(.+\)$/);
    expect(info.get(2)).toBeNull();
  });

  describe('assistant actions', () => {
    const run = (id: string, params: object, confirmed = false) =>
      hub.hub.assistant.run(`todo.${id}`, params, { confirmed });

    it('is read-only until Thomas turns the rights on', async () => {
      expect(await run('add-task', { title: 'x' })).toMatchObject({
        status: 'forbidden',
        right: { id: 'todo.edit-tasks' },
      });
      expect(await run('list-tasks', {})).toMatchObject({ status: 'done' });
      hub.hub.assistant.setRight('todo.edit-tasks', true);
      expect(await run('add-task', { title: 'x' })).toMatchObject({ status: 'done' });
      // Deleting has its own switch.
      expect(await run('delete-task', { task: 'x' }, true)).toMatchObject({ status: 'forbidden' });
      const rights = hub.hub.assistant.rights().map((r) => [r.id, r.granted, r.actions]);
      expect(rights).toEqual([
        ['todo.edit-tasks', true, ['todo.add-task', 'todo.complete-task']],
        ['todo.delete-tasks', false, ['todo.delete-task']],
      ]);
    });

    describe('with the rights on', () => {
      beforeEach(() => {
        hub.hub.assistant.setRight('todo.edit-tasks', true);
        hub.hub.assistant.setRight('todo.delete-tasks', true);
      });

      it('adds a task with tags, a natural due date and a track, then undoes it', async () => {
        const outcome = await run('add-task', {
          title: 'finir le mix',
          tags: ['mix'],
          due: 'demain',
          track: 'boumboum',
        });
        expect(outcome).toMatchObject({
          status: 'done',
          message: expect.stringMatching(
            /^J’ai ajouté « finir le mix » avec le tag mix pour demain, sur le morceau Boum Boum\.$/,
          ),
          data: { newTags: ['mix'] },
        });
        expect((await list()).tasks).toHaveLength(1);
        await hub.hub.assistant.undo((outcome as { undoId: string }).undoId);
        expect((await list()).tasks).toHaveLength(0);
      });

      it('asks instead of guessing an unclear date or track', async () => {
        expect(await run('add-task', { title: 'x', due: 'un de ces jours' })).toMatchObject({
          status: 'error',
          message: 'Je n’ai pas compris l’échéance « un de ces jours ». Pour quand ?',
        });
        expect(await run('add-task', { title: 'x', track: 'zèbre' })).toMatchObject({
          status: 'error',
          message: 'Je ne trouve pas le morceau « zèbre ».',
        });
        expect((await list()).tasks).toHaveLength(0);
      });

      it('lists by filter and tag, ticks, and deletes only after confirmation', async () => {
        await add({ title: 'Appeler le studio', due: addDays(today, -1), tags: ['studio'] });
        await add({ title: 'Finir le mix', due: 'aujourd’hui', tags: ['mix'] });
        await add({ title: 'Écrire la bio', due: 'dans 20 jours' });

        expect(await run('list-tasks', { filter: 'today' })).toMatchObject({
          message: '2 tâches pour aujourd’hui : Appeler le studio (en retard) et Finir le mix.',
        });
        expect(await run('list-tasks', { filter: 'overdue' })).toMatchObject({
          data: { count: 1 },
        });
        expect(await run('list-tasks', { tag: 'mix' })).toMatchObject({ data: { count: 1 } });

        const ticked = await run('complete-task', { task: 'le mix' });
        expect(ticked).toMatchObject({
          status: 'done',
          message: 'C’est coché : « Finir le mix ».',
        });
        expect(await run('list-tasks', { filter: 'done' })).toMatchObject({ data: { count: 1 } });
        await hub.hub.assistant.undo((ticked as { undoId: string }).undoId);
        expect(await run('list-tasks', { filter: 'done' })).toMatchObject({ data: { count: 0 } });

        const asked = await run('delete-task', { task: 'bio' });
        expect(asked).toEqual({
          status: 'confirm',
          id: 'todo.delete-task',
          question: 'Je supprime la tâche « Écrire la bio » ?',
        });
        expect((await list()).tasks).toHaveLength(3);
        const removed = await run('delete-task', { task: 'bio' }, true);
        expect(removed).toMatchObject({
          status: 'done',
          message: 'J’ai supprimé la tâche « Écrire la bio ».',
        });
        expect((await list()).tasks).toHaveLength(2);
        await hub.hub.assistant.undo((removed as { undoId: string }).undoId);
        expect((await list()).tasks.map((t) => t.title)).toContain('Écrire la bio');
      });

      it('reports an ambiguous task', async () => {
        await add({ title: 'Mix de Aube' });
        await add({ title: 'Mix de Nuit' });
        expect(await run('complete-task', { task: 'mix' })).toMatchObject({
          status: 'error',
          message:
            'Plusieurs tâches correspondent : « Mix de Aube » et « Mix de Nuit ». Laquelle ?',
        });
      });
    });
  });
});

describe('To-do without the library', () => {
  it('works, and says it cannot link a track', async () => {
    const hub = await createTestHub({ modules: [await loadModuleFolder(MODULE_DIR)] });
    hub.hub.assistant.setRight('todo.edit-tasks', true);
    try {
      const { body } = await hub.request<TasksResponse>('GET', `${API}/tasks`);
      expect(body).toMatchObject({ library: false, tracks: [] });
      expect(
        await hub.hub.assistant.run('todo.add-task', { title: 'x', track: 'aube' }),
      ).toMatchObject({
        status: 'error',
        message: expect.stringMatching(/Bibliothèque n’est pas disponible/),
      });
    } finally {
      await hub.close();
    }
  });
});
