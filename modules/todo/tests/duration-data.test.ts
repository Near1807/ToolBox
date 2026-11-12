// The estimated duration of a task, stored (v0.34.0): an added column, empty
// for the tasks that existed before; given by the API, the service and the
// quick add; synchronised like the other fields.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { TodoService } from '../contract';
import type { TaskDto } from '../shared';

const API = '/api/modules/todo';

describe('estimated duration, stored', () => {
  let hub: TestHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
  });

  it('migration: the tasks that existed keep everything, without an estimate', async () => {
    const module = await loadModuleFolder(path.resolve(__dirname, '..'));
    // The To-do as it was before (migrations 1 to 3).
    const before = {
      ...module,
      backend: { ...module.backend!, migrations: module.backend!.migrations!.slice(0, 3) },
    };
    hub = await createTestHub({ loadExamples: false, modules: [before as never] });
    const dataDir = hub.dataDir;
    await hub.request('POST', `${API}/tasks`, { title: 'Ancienne', due: '2026-11-20' });
    await hub.close({ keepData: true });
    hub = await createTestHub({ loadExamples: false, dataDir, modules: [module] });
    const tasks = (await hub.request<{ tasks: TaskDto[] }>('GET', `${API}/tasks`)).body.tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Ancienne', due: '2026-11-20', durationMin: null });
  });

  it('given, changed, cleared; refused when not understood; in the service', async () => {
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
    const task = (
      await hub.request<TaskDto>('POST', `${API}/tasks`, { title: 'Réviser', durationMin: 120 })
    ).body;
    expect(task.durationMin).toBe(120);
    const patched = await hub.request<TaskDto>('PATCH', `${API}/tasks/${task.id}`, {
      durationMin: '1h30',
    });
    expect(patched.body.durationMin).toBe(90);
    expect(
      (await hub.request('PATCH', `${API}/tasks/${task.id}`, { durationMin: '14 heures et demie' }))
        .status,
    ).toBe(400);
    expect(
      (await hub.request<TaskDto>('PATCH', `${API}/tasks/${task.id}`, { durationMin: null })).body
        .durationMin,
    ).toBeNull();
    const made = service!.createTask({ title: 'Préparer', due: 'vendredi', durationMin: 60 });
    expect(made.durationMin).toBe(60);
    expect(service!.getTask(made.id)?.durationMin).toBe(60);
    expect(service!.listOpenTasks().map((t) => [t.title, t.durationMin])).toContainEqual([
      'Réviser',
      null,
    ]);
  });
});
