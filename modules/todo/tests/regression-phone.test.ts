// The To-do's non-regression reference replayed on the PHONE's stack (ADR
// 0044): the same server code, the sqlite-wasm database (the engine of the
// app, in memory under Node) and the phone host with its mini router instead
// of better-sqlite3 and Fastify. Same answers, same service, same calendar,
// same stored rows as the reference written by the PC. Only the assistant's
// reading is left out: on the phone the assistant is without effect.
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dumpWasmTables,
  loadModuleFolder,
  openWasmDatabase,
  PhoneHub,
  phoneRequest,
  readReference,
  referenceShape,
} from '@hub/sdk/testing';
import { fakeLibrary, MODULES, NOW, REFERENCE, runScenario, type Services } from './scenario';

describe('the To-do on the phone (sqlite-wasm + phone host) = the reference', () => {
  let hub: PhoneHub | null = null;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  it('same answers of every route, same service, same stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const probe: { services?: Services } = {};
    const db = await openWasmDatabase();
    hub = await PhoneHub.start({
      db,
      modules: [
        fakeLibrary(probe) as never,
        ...((await Promise.all(
          ['todo', 'timer'].map((id) => loadModuleFolder(path.join(MODULES, id))),
        )) as never[]),
      ],
      log: () => {},
    });
    expect(hub.modules().map((m) => [m.id, m.status])).toEqual([
      ['music-library', 'loaded'],
      ['todo', 'loaded'],
      ['timer', 'loaded'],
    ]);
    const phone = hub;
    const { steps, service, calendar } = await runScenario({
      request: (method, url, body) => phoneRequest(phone, method, url, body),
      services: () => probe.services!,
      later: (minutes) => vi.setSystemTime(Date.now() + minutes * 60_000),
    });
    const snapshot = referenceShape(
      { steps, service, calendar, tables: dumpWasmTables(db, 'todo') },
      NOW.getTime(),
    );
    const { assistant: _assistant, ...reference } = readReference(REFERENCE, undefined) as Record<
      string,
      unknown
    >;
    void _assistant;
    expect(snapshot).toEqual(reference);
  });
});
