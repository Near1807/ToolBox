// Acting in place from the Agenda (v0.36.0): tick a task, create in an empty
// slot (a task of the To-do or an event), undo — always through the To-do's
// service, never a copy: the To-do sees the same thing.
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { RangeDto } from '../shared/types';
import { slotSpan } from '../shared/drag';
import { freeGaps } from '../shared/load';

const MODULES = path.resolve(__dirname, '..', '..');
const API = '/api/modules/agenda';
const TODO = '/api/modules/todo';
const NOW = new Date(2026, 10, 12, 10, 0, 0);

describe('acting in place from the Agenda', () => {
  let hub: TestHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
    vi.useRealTimers();
  });
  const open = async (ids = ['todo', 'agenda']) => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    hub = await createTestHub({
      loadExamples: false,
      modules: await Promise.all(ids.map((id) => loadModuleFolder(path.join(MODULES, id)))),
    });
  };
  const week = async () =>
    (await hub!.request<RangeDto>('GET', `${API}/range?from=2026-11-16&to=2026-11-22`)).body;
  const inTodo = async (id: string) =>
    (
      await hub!.request<{ tasks: Record<string, unknown>[] }>('GET', `${TODO}/tasks`)
    ).body.tasks.find((t) => t.id === id);

  it('ticks a task from its block; « Annuler » unticks; the To-do shows the same', async () => {
    await open();
    const made = (
      await hub!.request<{ id: string }>('POST', `${TODO}/tasks`, {
        title: 'Réviser',
        plannedAt: '2026-11-18T14:00',
      })
    ).body;
    await hub!.request('PUT', `${API}/tasks/${made.id}/done`, { done: true });
    expect(await inTodo(made.id)).toMatchObject({ done: true });
    expect((await week()).tasks[0]).toMatchObject({ id: made.id, done: true });
    await hub!.request('PUT', `${API}/tasks/${made.id}/done`, { done: false });
    expect(await inTodo(made.id)).toMatchObject({ done: false });
    // And the other way: ticked in the To-do, crossed out in the Agenda.
    await hub!.request('PATCH', `${TODO}/tasks/${made.id}`, { done: true });
    expect((await week()).tasks[0]).toMatchObject({ done: true });
  });

  it('creates in an empty slot: « Tâche » (the To-do, planned, the slot length) or « Rendez-vous »; « Annuler » removes it', async () => {
    await open();
    const task = (
      await hub!.request<{ id: string; title: string }>('POST', `${API}/tasks`, {
        title: 'Appeler la banque',
        plannedAt: '2026-11-17T09:15',
        durationMin: 45,
      })
    ).body;
    expect(await inTodo(task.id)).toMatchObject({
      title: 'Appeler la banque',
      plannedAt: '2026-11-17T09:15',
      durationMin: 45,
      done: false,
    });
    expect((await week()).tasks.map((t) => [t.title, t.start, t.end])).toEqual([
      ['Appeler la banque', '2026-11-17T09:15', '2026-11-17T10:00'],
    ]);
    // « Annuler »: a tombstone in the To-do, gone from both.
    await hub!.request('DELETE', `${API}/tasks/${task.id}`);
    expect(await inTodo(task.id)).toBeUndefined();
    expect((await week()).tasks).toEqual([]);
    // Refused: no title, a bad time, less than 15 minutes.
    for (const body of [
      { title: '', plannedAt: '2026-11-17T09:15', durationMin: 30 },
      { title: 'x', plannedAt: 'mardi', durationMin: 30 },
      { title: 'x', plannedAt: '2026-11-17T09:15', durationMin: 10 },
    ])
      expect((await hub!.request('POST', `${API}/tasks`, body)).status).toBe(400);
    // « Rendez-vous »: an event of the Agenda.
    const event = (
      await hub!.request<{ id: string }>('POST', `${API}/events`, {
        title: 'Dentiste',
        start: '2026-11-19T14:00',
        end: '2026-11-19T14:30',
      })
    ).body;
    expect((await week()).events.map((e) => e.id)).toContain(event.id);
  });

  it('without the To-do: no « Tâche » (refused), events still work', async () => {
    await open(['agenda']);
    expect(
      (
        await hub!.request('POST', `${API}/tasks`, {
          title: 'x',
          plannedAt: '2026-11-17T09:15',
          durationMin: 30,
        })
      ).status,
    ).toBe(409);
  });
});

describe('slots (pure)', () => {
  it('a click: 30 min from the quarter before; a drag: the quarters covered, 15 min at least', () => {
    expect(slotSpan('2026-11-18', 14 * 60 + 20, null)).toEqual({
      start: '2026-11-18T14:15',
      end: '2026-11-18T14:45',
    });
    expect(slotSpan('2026-11-18', 14 * 60 + 20, 15 * 60 + 40)).toEqual({
      start: '2026-11-18T14:15',
      end: '2026-11-18T15:45',
    });
    // Upwards, and a tiny drag.
    expect(slotSpan('2026-11-18', 15 * 60 + 40, 14 * 60 + 20).start).toBe('2026-11-18T14:15');
    expect(slotSpan('2026-11-18', 14 * 60 + 1, 14 * 60 + 3)).toEqual({
      start: '2026-11-18T14:00',
      end: '2026-11-18T14:15',
    });
  });

  it('the free slots of a day (30 min at least, blocks merged)', () => {
    const b = (id: string, start: string, end: string) => ({ id, start, end, category: 'x' });
    expect(
      freeGaps(
        '2026-11-18',
        [
          b('a', '2026-11-18T09:00', '2026-11-18T10:00'),
          b('b', '2026-11-18T09:30', '2026-11-18T11:00'),
          b('c', '2026-11-18T11:15', '2026-11-18T12:00'),
        ],
        { startHour: 7, endHour: 23 },
      ),
    ).toEqual([
      { from: 7 * 60, to: 9 * 60 },
      { from: 12 * 60, to: 23 * 60 },
    ]);
  });
});
