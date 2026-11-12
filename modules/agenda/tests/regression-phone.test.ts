// The Agenda's non-regression reference replayed on the PHONE's stack
// (ADR 0044): the same server code on sqlite-wasm and the phone host.
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
import { MODULES, NOW, REFERENCE, runScenario } from './scenario';

describe('the Agenda on the phone (sqlite-wasm + phone host) = the reference', () => {
  let hub: PhoneHub | null = null;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  it('same answers of every route, same calendar, same stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const db = await openWasmDatabase();
    hub = await PhoneHub.start({
      db,
      modules: (await Promise.all(
        ['todo', 'agenda'].map((id) => loadModuleFolder(path.join(MODULES, id))),
      )) as never[],
      log: () => {},
    });
    expect(hub.modules().map((m) => [m.id, m.status])).toEqual([
      ['todo', 'loaded'],
      ['agenda', 'loaded'],
    ]);
    const phone = hub;
    const { steps, calendar } = await runScenario({
      request: (method, url, body) => phoneRequest(phone, method, url, body),
      later: (minutes) => vi.setSystemTime(Date.now() + minutes * 60_000),
    });
    const snapshot = referenceShape(
      { steps, calendar, tables: dumpWasmTables(db, 'agenda'), todo: dumpWasmTables(db, 'todo') },
      NOW.getTime(),
    );
    expect(snapshot).toEqual(readReference(REFERENCE, undefined));
  });
});
