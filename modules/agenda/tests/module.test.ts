// The Agenda with the other modules: what they date (read through the
// calendar, never written), the To-do's tasks to fit in (never twice),
// the bar that adds a task, and without the To-do.
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { ModuleContext } from '@hub/sdk/core';
import type { RangeDto } from '../shared/types';

const MODULES = path.resolve(__dirname, '..', '..');
const API = '/api/modules/agenda';
const NOW = new Date(2026, 10, 12, 10, 0, 0);

/** A module that dates things (like Sport or the Planning), read only. */
const club = {
  folder: 'club',
  manifest: {
    id: 'club',
    name: 'Club',
    description: 'x',
    version: '1.0.0',
    section: 'Vie perso',
    icon: 'x',
  },
  backend: {
    register: (ctx: ModuleContext) =>
      ctx.calendar.provide({
        category: 'Sport',
        events: () => [
          {
            id: 's1',
            title: 'Natation',
            start: '2026-11-17T18:00',
            durationMin: 60,
            open: '/m/club?s=1',
          },
          {
            id: 'c1',
            title: 'Tournoi',
            start: '2026-11-21',
            endDate: '2026-11-22',
            durationMin: 0,
            open: '/m/club',
          },
        ],
      }),
  },
};

describe('the Agenda and the other modules', () => {
  let hub: TestHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
    vi.useRealTimers();
  });
  const open = async (ids: string[]) => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    hub = await createTestHub({
      loadExamples: false,
      modules: [
        ...(await Promise.all(ids.map((id) => loadModuleFolder(path.join(MODULES, id))))),
        club as never,
      ],
    });
    return hub;
  };
  const week = () => hub!.request<RangeDto>('GET', `${API}/range?from=2026-11-16&to=2026-11-22`);

  it('shows what the others dated, with their category and a link; tasks once, « à caser »', async () => {
    await open(['todo', 'agenda']);
    await hub!.request('POST', '/api/modules/todo/tasks', {
      title: 'Rapport',
      due: '2026-11-18',
      durationMin: 90,
    });
    await hub!.request('POST', `${API}/quick`, { text: 'dentiste mardi 14h' });
    const w = (await week()).body;
    expect(w.foreign).toEqual([
      expect.objectContaining({
        id: 'club:s1',
        moduleId: 'club',
        title: 'Natation',
        start: '2026-11-17T18:00',
        end: '2026-11-17T19:00',
        allDay: false,
        category: 'Sport',
        open: '/m/club?s=1',
      }),
      expect.objectContaining({
        title: 'Tournoi',
        start: '2026-11-21',
        end: '2026-11-22',
        allDay: true,
      }),
    ]);
    // The task is not an event in the grid: only « à caser ».
    expect(w.foreign.some((e) => e.moduleId === 'todo')).toBe(false);
    expect(w.toPlace).toEqual([
      expect.objectContaining({
        title: 'Rapport',
        due: '2026-11-18',
        estimateMin: 90,
        open: '/m/todo',
      }),
    ]);
    expect(w.todo).toBe(true);
    expect(w.categories).toEqual(['Rendez-vous', 'Sport']);
    expect(w.events.map((e) => e.title)).toEqual(['Dentiste']);
  });

  it('a thing to fit in becomes a task of the To-do (never a second list)', async () => {
    await open(['todo', 'agenda']);
    const r = await hub!.request<{ kind: string; task: { id: string } }>('POST', `${API}/quick`, {
      text: 'réviser chimie ~2h jeudi',
    });
    expect(r.body.kind).toBe('task');
    const tasks = (
      await hub!.request<{
        tasks: { title: string; durationMin: number | null; due: string | null }[];
      }>('GET', '/api/modules/todo/tasks')
    ).body.tasks;
    expect(tasks).toEqual([
      expect.objectContaining({ title: 'réviser chimie', durationMin: 120, due: '2026-11-19' }),
    ]);
    expect(
      (await hub!.request<RangeDto>('GET', `${API}/range?from=2026-11-16&to=2026-11-22`)).body
        .events,
    ).toEqual([]);
  });

  it('without the To-do: no « à caser », a thing to fit in is refused with a clear message', async () => {
    await open(['agenda']);
    const w = (await week()).body;
    expect(w).toMatchObject({ todo: false, toPlace: [] });
    const r = await hub!.request<{ error: string }>('POST', `${API}/quick`, { text: 'ranger ~1h' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/To-do n’est pas là/);
    // Events still work.
    expect((await hub!.request('POST', `${API}/quick`, { text: 'cours lundi 10h' })).status).toBe(
      200,
    );
  });

  it('asking the calendar never writes anything (the other modules are only read)', async () => {
    await open(['todo', 'agenda']);
    await week();
    const changes = hub!.hub.handle.db
      .prepare('SELECT COUNT(*) AS n FROM agenda__changes')
      .get() as { n: number };
    expect(changes.n).toBe(0);
  });
});
