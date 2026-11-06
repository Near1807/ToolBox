// The SDK's API client over the phone's Worker transport: the pages call the
// same paths and get the same answers and the same errors (ApiError with the
// module's French message) as over HTTP on the PC. Event streams come back as
// messages (the Timer's « session »), and the Worker's host calls (« Enregistrer
// sous ») are answered by the page.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { api, ApiError, httpTransport, setApiTransport } from '@hub/sdk/frontend';
import { loadModuleFolder, openWasmDatabase, PhoneHub } from '@hub/sdk/testing';
import {
  PageLink,
  WorkerClient,
  workerTransport,
  type WorkerEnvelope,
} from '../../packages/phone/transport';

describe('Worker transport', () => {
  afterEach(() => setApiTransport(httpTransport));

  it('same paths, same answers, same errors; event streams; host calls', async () => {
    const hub = await PhoneHub.start({
      db: await openWasmDatabase(),
      modules: (await Promise.all(
        ['todo', 'timer'].map((id) =>
          loadModuleFolder(path.resolve(__dirname, '../../modules', id)),
        ),
      )) as never[],
      log: () => {},
    });
    // The Worker's side: answers each call with the hub (as mobile/app/src/worker.ts).
    const { port1, port2 } = new MessageChannel();
    const streams = new Map<number, () => void>();
    port2.addEventListener('message', (event: MessageEvent<WorkerEnvelope>) => {
      if (!('call' in event.data)) return; // An answer to a host call.
      const { id, call } = event.data;
      if (call.kind === 'stream-open') {
        const close = hub.openStream(call.url, (name, data) =>
          port2.postMessage({ stream: { id: call.stream, event: name, data } }),
        );
        streams.set(call.stream, close!);
        return port2.postMessage({ id, ok: true, result: { ok: true } });
      }
      if (call.kind === 'stream-close') {
        streams.get(call.stream)?.();
        return port2.postMessage({ id, ok: true, result: { ok: true } });
      }
      if (call.kind !== 'request') return port2.postMessage({ id, ok: false, error: 'non' });
      void hub.handle(call.request).then((result) => port2.postMessage({ id, ok: true, result }));
    });
    const page = new PageLink(port2 as never);
    port1.start();
    port2.start();
    const client = new WorkerClient(port1 as never);
    client.serveHost((call) =>
      Promise.resolve(call.kind === 'saveAs' ? `partagé : ${call.defaultName}` : null),
    );
    setApiTransport(workerTransport(client));

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
    // The Timer's stream: its state at once, then each change; nothing after closing.
    const { openEventStream } = await import('@hub/sdk/frontend');
    const seen: (string | null)[] = [];
    const wait = () => new Promise((r) => setTimeout(r, 30));
    const close = openEventStream('/api/modules/timer/events', {
      session: (data) =>
        seen.push((data as { session: { status: string } | null }).session?.status ?? null),
    });
    await wait();
    await api.post('/api/modules/timer/start', { config: { mode: 'simple', workMin: 10 } });
    await wait();
    expect(seen).toEqual([null, 'running']);
    close();
    await wait();
    await api.post('/api/modules/timer/pause');
    await wait();
    expect(seen).toEqual([null, 'running']);
    // A host call of the Worker, answered by the page.
    expect(await page.call({ kind: 'saveAs', title: 'T', defaultName: 'a.md', data: 'x' })).toBe(
      'partagé : a.md',
    );
    port1.close();
    port2.close();
  });
});
