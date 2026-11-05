// The phone's mini router answers the To-do's routes exactly like Fastify on
// the PC: same statuses, same bodies, same errors (HttpError, unknown route,
// trailing slash, bad or empty JSON, invalid id, query arrays, a crash).
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, loadModuleFolder, referenceShape, type TestHub } from '@hub/sdk/testing';
import { PhoneHub } from '../../packages/phone/host';
import { openWasmDatabase } from '@hub/sdk/testing';

const TODO = path.resolve(__dirname, '../../modules/todo');
const NOW = new Date(2026, 10, 4, 10, 0, 0);

/** A raw request: method, url, body text, content type. */
type Raw = [string, string, string | null, string | null];

const REQUESTS: (Raw | ((ids: string[]) => Raw))[] = [
  ['GET', '/api/modules/todo/tasks', null, null],
  [
    'POST',
    '/api/modules/todo/tasks',
    '{"title":"Acheter des cordes","due":"demain","tags":["Studio"]}',
    'application/json',
  ],
  ['POST', '/api/modules/todo/tasks', '{"title":"Deux"}', 'application/json; charset=utf-8'],
  ['POST', '/api/modules/todo/tasks', '{"title":""}', 'application/json'],
  ['POST', '/api/modules/todo/tasks', '{"title":"x","due":"un jour"}', 'application/json'],
  ['POST', '/api/modules/todo/tasks', '{bad', 'application/json'],
  ['POST', '/api/modules/todo/tasks', '', 'application/json'],
  (ids) => ['PATCH', `/api/modules/todo/tasks/${ids[0]}`, '{"done":true}', 'application/json'],
  (ids) => ['DELETE', `/api/modules/todo/tasks/${ids[1]}`, null, null],
  (ids) => ['POST', `/api/modules/todo/tasks/${ids[1]}/restore`, '{}', 'application/json'],
  (ids) => ['POST', `/api/modules/todo/tasks/${ids[1]}/restore`, '{}', 'application/json'],
  ['PATCH', '/api/modules/todo/tasks/pas-un-uuid', '{"done":true}', 'application/json'],
  [
    'PATCH',
    '/api/modules/todo/tasks/00000000-0000-4000-8000-000000000000',
    '{"done":true}',
    'application/json',
  ],
  ['GET', '/api/modules/todo/tasks/', null, null],
  ['GET', '/api/modules/todo/nope', null, null],
  ['PUT', '/api/modules/todo/tasks', '{}', 'application/json'],
  ['GET', '/api/modules/todo/tasks?x=1&x=2&y=%C3%A9+t', null, null],
  ['GET', '/api/modules/todo/today', null, null],
  ['GET', '/api/core/calendar', null, null],
  ['GET', '/api/core/calendar?from=2026-11-01&to=2026-11-30', null, null],
  ['GET', '/api/modules/nope/x', null, null],
];

async function play(send: (r: Raw) => Promise<{ status: number; text: string }>) {
  const out: unknown[] = [];
  const ids: string[] = [];
  for (const entry of REQUESTS) {
    const raw = typeof entry === 'function' ? entry(ids) : entry;
    const r = await send(raw);
    let body: unknown = r.text;
    try {
      body = r.text ? JSON.parse(r.text) : null;
    } catch {
      // raw text
    }
    const id = (body as { id?: string } | null)?.id;
    if (raw[0] === 'POST' && raw[1].endsWith('/tasks') && r.status === 200 && id) ids.push(id);
    out.push([raw[0], raw[1].replace(/[0-9a-f-]{36}/, ':id'), r.status, body]);
  }
  // The journal's stamps go on increasing from one hub to the next in this test:
  // times are compared by the replay of the reference (regression-phone.test.ts).
  return JSON.parse(
    JSON.stringify(referenceShape(out, NOW.getTime())).replace(/"\+\d+ms"/g, '"TIME"'),
  ) as unknown;
}

describe('phone mini router = Fastify (To-do routes)', () => {
  let pc: TestHub | null = null;
  let phone: PhoneHub | null = null;
  afterEach(async () => {
    await pc?.close();
    await phone?.close();
    vi.useRealTimers();
  });

  it('same statuses and bodies, errors included', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    pc = await createTestHub({ loadExamples: false, modules: [await loadModuleFolder(TODO)] });
    const fromPc = await play(async ([method, url, body, type]) => {
      const r = await pc!.app.inject({
        method: method as 'GET',
        url,
        headers: {
          host: '127.0.0.1:4321',
          'x-toolbox-token': 'test-token',
          ...(type ? { 'content-type': type } : {}),
        },
        ...(body === null ? {} : { payload: body }),
      });
      return { status: r.statusCode, text: r.body };
    });
    vi.setSystemTime(NOW);
    phone = await PhoneHub.start({
      db: await openWasmDatabase(),
      modules: [(await loadModuleFolder(TODO)) as never],
      log: () => {},
    });
    const fromPhone = await play(([method, url, body, contentType]) =>
      phone!.handle({ method, url, body, contentType }),
    );
    expect(fromPhone).toEqual(fromPc);
  });

  it('a route that crashes: 500 « Erreur dans « Module » : … », like the PC', async () => {
    const crash = {
      manifest: {
        id: 'crash',
        name: 'Crash',
        description: 'test',
        version: '1.0.0',
        section: 'Outils',
        icon: 'bug',
      },
      backend: {
        register: (ctx: { routes: { get: (p: string, h: () => unknown) => void } }) =>
          ctx.routes.get('/boom', () => {
            throw new Error('panne');
          }),
      },
    };
    pc = await createTestHub({
      loadExamples: false,
      modules: [{ folder: 'crash', ...crash } as never],
    });
    const fromPc = await pc.request('GET', '/api/modules/crash/boom');
    phone = await PhoneHub.start({
      db: await openWasmDatabase(),
      modules: [crash as never],
      log: () => {},
    });
    const r = await phone.handle({ method: 'GET', url: '/api/modules/crash/boom' });
    expect([r.status, JSON.parse(r.text)]).toEqual([fromPc.status, fromPc.body]);
  });
});
