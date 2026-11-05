// The SDK's API client over the phone's Worker transport: the pages call the
// same paths and get the same answers and the same errors (ApiError with the
// module's French message) as over HTTP on the PC.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { api, ApiError, httpTransport, setApiTransport } from '@hub/sdk/frontend';
import { loadModuleFolder, openWasmDatabase, PhoneHub } from '@hub/sdk/testing';
import { WorkerClient, workerTransport, type WorkerEnvelope } from '../../packages/phone/transport';

describe('Worker transport', () => {
  afterEach(() => setApiTransport(httpTransport));

  it('same paths, same answers, same errors; streams said unavailable', async () => {
    const hub = await PhoneHub.start({
      db: await openWasmDatabase(),
      modules: [(await loadModuleFolder(path.resolve(__dirname, '../../modules/todo'))) as never],
      log: () => {},
    });
    // The Worker's side: answers each call with the hub (as mobile/app/src/worker.ts).
    const { port1, port2 } = new MessageChannel();
    port2.addEventListener('message', (event: MessageEvent<WorkerEnvelope>) => {
      const { id, call } = event.data;
      if (call.kind !== 'request') return port2.postMessage({ id, ok: false, error: 'non' });
      void hub.handle(call.request).then((result) => port2.postMessage({ id, ok: true, result }));
    });
    port1.start();
    port2.start();
    setApiTransport(workerTransport(new WorkerClient(port1 as never)));

    const task = await api.post<{ id: string; title: string; due: string | null }>(
      '/api/modules/todo/tasks',
      { title: 'Depuis la page', due: '2026-12-01' },
    );
    expect([task.title, task.due]).toEqual(['Depuis la page', '2026-12-01']);
    const list = await api.get<{ tasks: { id: string }[] }>('/api/modules/todo/tasks');
    expect(list.tasks.map((t) => t.id)).toEqual([task.id]);
    await api.delete(`/api/modules/todo/tasks/${task.id}`);
    const error = await api.post('/api/modules/todo/tasks', { title: '' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: 'Le titre de la tâche est obligatoire' });
    const missing = await api.get('/api/modules/todo/nope').catch((e: unknown) => e);
    expect(missing).toMatchObject({ status: 404 });
    const { openEventStream } = await import('@hub/sdk/frontend');
    expect(() => openEventStream('/api/modules/timer/events', {})).toThrow(
      /pas disponibles sur le téléphone/,
    );
    port1.close();
    port2.close();
  });
});
