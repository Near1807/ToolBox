// Tasks planned in the week (v0.35.0): one piece of data, the To-do's. The
// Agenda shows it and changes it through the service, never a copy: every
// change on one side shows on the other.
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { RangeDto } from '../shared/types';

const MODULES = path.resolve(__dirname, '..', '..');
const API = '/api/modules/agenda';
const TODO = '/api/modules/todo';
const NOW = new Date(2026, 10, 12, 10, 0, 0); // Thursday 12 November 2026

describe('tasks planned in the Agenda', () => {
  let hub: TestHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
    vi.useRealTimers();
  });
  const open = async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    hub = await createTestHub({
      loadExamples: false,
      modules: await Promise.all(
        ['todo', 'agenda'].map((id) => loadModuleFolder(path.join(MODULES, id))),
      ),
    });
  };
  const week = async () =>
    (await hub!.request<RangeDto>('GET', `${API}/range?from=2026-11-16&to=2026-11-22`)).body;
  const task = async (id: string) =>
    (await hub!.request<{ tasks: { id: string }[] }>('GET', `${TODO}/tasks`)).body.tasks.find(
      (t) => t.id === id,
    ) as Record<string, unknown>;

  it('a drop from « À caser » plans the task; moved, stretched, taken out — the To-do follows', async () => {
    await open();
    const made = (
      await hub!.request<{ id: string }>('POST', `${TODO}/tasks`, {
        title: 'Réviser stats',
        due: '2026-11-20',
      })
    ).body;
    expect((await week()).toPlace.map((t) => t.id)).toContain(made.id);
    // Dropped on Wednesday 14:00 (no estimate: 30 min).
    await hub!.request('PUT', `${API}/tasks/${made.id}/plan`, { plannedAt: '2026-11-18T14:00' });
    let w = await week();
    expect(w.toPlace.map((t) => t.id)).not.toContain(made.id);
    expect(w.tasks).toEqual([
      expect.objectContaining({
        id: made.id,
        title: 'Réviser stats',
        start: '2026-11-18T14:00',
        end: '2026-11-18T14:30',
        category: 'Tâches',
        done: false,
        afterDue: false,
      }),
    ]);
    expect(await task(made.id)).toMatchObject({ plannedAt: '2026-11-18T14:00', durationMin: 30 });
    // Moved to Thursday 9:15, then stretched to 2 h: the task's estimate.
    await hub!.request('PUT', `${API}/tasks/${made.id}/plan`, { plannedAt: '2026-11-19T09:15' });
    await hub!.request('PUT', `${API}/tasks/${made.id}/plan`, { durationMin: 120 });
    expect(await task(made.id)).toMatchObject({ plannedAt: '2026-11-19T09:15', durationMin: 120 });
    expect((await week()).tasks[0]).toMatchObject({
      start: '2026-11-19T09:15',
      end: '2026-11-19T11:15',
    });
    // 15 minutes at least; a bad time refused.
    expect(
      (await hub!.request('PUT', `${API}/tasks/${made.id}/plan`, { durationMin: 10 })).status,
    ).toBe(400);
    expect(
      (await hub!.request('PUT', `${API}/tasks/${made.id}/plan`, { plannedAt: 'jeudi' })).status,
    ).toBe(400);
    // After its due date: flagged, not refused.
    await hub!.request('PUT', `${API}/tasks/${made.id}/plan`, { plannedAt: '2026-11-21T10:00' });
    expect((await week()).tasks[0]).toMatchObject({ afterDue: true });
    // « Retirer de l'agenda »: back in « À caser », its estimate kept.
    await hub!.request('PUT', `${API}/tasks/${made.id}/plan`, { plannedAt: null });
    w = await week();
    expect(w.tasks).toEqual([]);
    expect(w.toPlace.find((t) => t.id === made.id)).toMatchObject({ estimateMin: 120 });
  });

  it('changed in the To-do: the Agenda shows it; ticked: crossed out, still there', async () => {
    await open();
    const made = (
      await hub!.request<{ id: string }>('POST', `${TODO}/tasks`, {
        title: 'Appeler Paul',
        plannedAt: '2026-11-17T14:00',
      })
    ).body;
    expect((await week()).tasks[0]).toMatchObject({
      start: '2026-11-17T14:00',
      end: '2026-11-17T14:30',
    });
    await hub!.request('PATCH', `${TODO}/tasks/${made.id}`, {
      plannedAt: '2026-11-17T16:00',
      durationMin: 45,
    });
    expect((await week()).tasks[0]).toMatchObject({
      start: '2026-11-17T16:00',
      end: '2026-11-17T16:45',
    });
    await hub!.request('PATCH', `${TODO}/tasks/${made.id}`, { done: true });
    expect((await week()).tasks[0]).toMatchObject({ done: true });
    // Not a foreign event, not twice.
    const w = await week();
    expect(w.foreign.filter((e) => e.moduleId === 'todo')).toEqual([]);
    // The bar: a « ~ » phrase with an hour is a planned task of the To-do.
    await hub!.request('POST', `${API}/quick`, { text: 'réviser ~2h mercredi 14h' });
    expect((await week()).tasks.map((t) => [t.title, t.start, t.end])).toContainEqual([
      'réviser',
      '2026-11-18T14:00',
      '2026-11-18T16:00',
    ]);
  });

  it('without the To-do: no task, and planning is refused', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.join(MODULES, 'agenda'))],
    });
    expect((await week()).tasks).toEqual([]);
    expect(
      (
        await hub.request('PUT', `${API}/tasks/0b0ce31f-04fc-430e-98c8-9e502a0101c2/plan`, {
          plannedAt: '2026-11-18T14:00',
        })
      ).status,
    ).toBe(409);
  });
});
