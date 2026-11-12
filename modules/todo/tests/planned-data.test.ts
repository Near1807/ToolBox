// The planned start of a task, stored (v0.35.0): an added column, empty for
// the tasks that existed; 30 min when placed without an estimate; « Retirer
// de l'agenda »; in the service (for the Agenda) and in the calendar (an
// event when planned, an item to fit in otherwise).
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { TodoService } from '../contract';
import type { TaskDto } from '../shared';

const API = '/api/modules/todo';

describe('planned start, stored', () => {
  let hub: TestHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
  });

  it('migration 4 → 5: the tasks keep everything, not planned', async () => {
    const module = await loadModuleFolder(path.resolve(__dirname, '..'));
    const before = {
      ...module,
      backend: { ...module.backend!, migrations: module.backend!.migrations!.slice(0, 4) },
    };
    hub = await createTestHub({ loadExamples: false, modules: [before as never] });
    const dataDir = hub.dataDir;
    await hub.request('POST', `${API}/tasks`, {
      title: 'Ancienne',
      due: '2026-11-20',
      durationMin: 45,
    });
    await hub.close({ keepData: true });
    hub = await createTestHub({ loadExamples: false, dataDir, modules: [module] });
    const tasks = (await hub.request<{ tasks: TaskDto[] }>('GET', `${API}/tasks`)).body.tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Ancienne',
      due: '2026-11-20',
      durationMin: 45,
      plannedAt: null,
    });
  });

  it('placed, moved, taken out; 30 min by default; refused when invalid', async () => {
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    const made = (
      await hub.request<TaskDto>('POST', `${API}/tasks`, {
        title: 'Appeler Paul',
        plannedAt: '2026-11-12T14:00',
      })
    ).body;
    // Placed without an estimate: 30 min, and the estimate takes it.
    expect(made).toMatchObject({ plannedAt: '2026-11-12T14:00', durationMin: 30 });
    const other = (await hub.request<TaskDto>('POST', `${API}/tasks`, { title: 'Réviser' })).body;
    expect(other).toMatchObject({ plannedAt: null, durationMin: null });
    const placed = await hub.request<TaskDto>('PATCH', `${API}/tasks/${other.id}`, {
      plannedAt: '2026-11-18T14:00',
    });
    expect(placed.body).toMatchObject({ plannedAt: '2026-11-18T14:00', durationMin: 30 });
    // An estimate given with it is kept.
    const both = await hub.request<TaskDto>('PATCH', `${API}/tasks/${other.id}`, {
      plannedAt: '2026-11-19T09:00',
      durationMin: 120,
    });
    expect(both.body).toMatchObject({ plannedAt: '2026-11-19T09:00', durationMin: 120 });
    // « Retirer de l'agenda »: the time goes, the estimate stays.
    const out = await hub.request<TaskDto>('PATCH', `${API}/tasks/${other.id}`, {
      plannedAt: null,
    });
    expect(out.body).toMatchObject({ plannedAt: null, durationMin: 120 });
    for (const bad of ['2026-11-18', '2026-13-01T10:00', '2026-11-18T25:00', 'mercredi 14h'])
      expect(
        (await hub.request('PATCH', `${API}/tasks/${other.id}`, { plannedAt: bad })).status,
      ).toBe(400);
  });

  it('the calendar: planned = an event (with its item id), else an item to fit in; ticked = « fait »; after its due date flagged', async () => {
    let service: TodoService | null = null;
    const probe = {
      folder: 'probe',
      manifest: {
        id: 'probe',
        name: 'Probe',
        description: 'x',
        version: '1.0.0',
        section: 'Outils',
        icon: 'x',
        dependsOn: { services: ['todo'] },
      },
      backend: {
        register: (ctx: { services: { get: (n: string) => unknown } }) => {
          service = ctx.services.get('todo') as TodoService;
        },
      },
    };
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.resolve(__dirname, '..')), probe as never],
    });
    const a = service!.createTask({ title: 'Réviser', durationMin: 120 });
    const b = service!.createTask({ title: 'Rendre le devoir', due: '2026-11-13' });
    // The Agenda plans them (a drop), through the service.
    expect(service!.planTask(a.id, { plannedAt: '2026-11-18T14:00' })).toMatchObject({
      plannedAt: '2026-11-18T14:00',
      durationMin: 120,
    });
    expect(service!.planTask(b.id, { plannedAt: '2026-11-16T10:00' })).toMatchObject({
      durationMin: 30,
    });
    const view = (from: string, to: string) =>
      hub!.request<{
        events: {
          id: string;
          itemId?: string;
          start: string;
          durationMin: number;
          status?: string;
        }[];
      }>('GET', `/api/core/calendar?from=${from}&to=${to}`);
    const week = (await view('2026-11-16', '2026-11-22')).body;
    expect(week.events.filter((e) => e.itemId)).toEqual([
      expect.objectContaining({
        itemId: b.id,
        start: '2026-11-16T10:00',
        durationMin: 30,
        status: 'après l’échéance',
      }),
      expect.objectContaining({ itemId: a.id, start: '2026-11-18T14:00', durationMin: 120 }),
    ]);
    // Ticked: still there, « fait ».
    service!.completeTask(a.id);
    const after = (await view('2026-11-18', '2026-11-18')).body;
    expect(after.events.find((e) => e.itemId === a.id)?.status).toBe('fait');
    // Taken out: an item again, no event.
    service!.planTask(b.id, { plannedAt: null });
    const out = (await view('2026-11-16', '2026-11-16')).body;
    expect(out.events.find((e) => e.itemId === b.id)).toBeUndefined();
    expect(service!.getTask(b.id)).toMatchObject({ plannedAt: null, durationMin: 30 });
  });
});
