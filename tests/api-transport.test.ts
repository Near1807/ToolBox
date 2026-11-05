// The pages' API client (ADR 0044): the default transport is the PC's HTTP,
// exactly as before (session token, JSON, French errors, SSE with a
// single-use ticket); another transport replaces it without the pages
// noticing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  ApiError,
  httpTransport,
  openEventStream,
  setApiTransport,
  type ApiTransport,
} from '@hub/sdk/frontend';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners = new Map<string, (m: { data: string }) => void>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(event: string, handler: (m: { data: string }) => void) {
    this.listeners.set(event, handler);
  }
  close() {
    this.closed = true;
  }
}

describe('API transport', () => {
  afterEach(() => {
    setApiTransport(httpTransport);
    vi.unstubAllGlobals();
  });

  it('HTTP by default: token header, JSON body, French error message', async () => {
    vi.stubGlobal('window', { toolbox: { token: 'secret' } });
    const calls: { path: string; headers: Headers; body: unknown; method?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        calls.push({
          path,
          headers: new Headers(init.headers),
          body: init.body,
          method: init.method,
        });
        return path.endsWith('/bad')
          ? new Response(JSON.stringify({ error: 'Tâche introuvable' }), { status: 404 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    expect(await api.post('/api/modules/todo/tasks', { title: 'A' })).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      path: '/api/modules/todo/tasks',
      method: 'POST',
      body: '{"title":"A"}',
    });
    expect(calls[0]!.headers.get('x-toolbox-token')).toBe('secret');
    expect(calls[0]!.headers.get('content-type')).toBe('application/json');
    const error = await api.get('/api/modules/todo/bad').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, message: 'Tâche introuvable' });
  });

  it('SSE by default: a single-use ticket, then EventSource on the path', async () => {
    vi.stubGlobal('window', { toolbox: { token: 'secret' } });
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ticket: 'abc' }), { status: 200 })),
    );
    const got: unknown[] = [];
    const close = openEventStream('/api/modules/timer/events', { session: (d) => got.push(d) });
    await vi.waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    expect(FakeEventSource.last!.url).toBe('/api/modules/timer/events?ticket=abc');
    FakeEventSource.last!.listeners.get('session')!({ data: '{"status":"running"}' });
    expect(got).toEqual([{ status: 'running' }]);
    close();
    expect(FakeEventSource.last!.closed).toBe(true);
  });

  it('another transport (the phone’s Worker): same paths, same contract', async () => {
    const seen: string[] = [];
    const worker: ApiTransport = {
      request: async (path, init) => {
        seen.push(`${init.method ?? 'GET'} ${path} ${String(init.body ?? '')}`);
        return new Response(JSON.stringify({ via: 'worker' }), { status: 200 });
      },
      openEventStream: (path, handlers) => {
        handlers.session!({ path });
        return () => seen.push('closed');
      },
    };
    setApiTransport(worker);
    expect(await api.patch('/api/modules/todo/tasks/1', { done: true })).toEqual({ via: 'worker' });
    const events: unknown[] = [];
    openEventStream('/api/modules/timer/events', { session: (d) => events.push(d) })();
    expect(seen).toEqual(['PATCH /api/modules/todo/tasks/1 {"done":true}', 'closed']);
    expect(events).toEqual([{ path: '/api/modules/timer/events' }]);
  });
});
