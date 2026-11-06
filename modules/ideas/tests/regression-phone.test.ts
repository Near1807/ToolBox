// The Boîte à idées' non-regression reference replayed on the PHONE's stack
// (ADR 0044): the same server code on sqlite-wasm and the phone host (mini
// router), with the To-do present (« Transformer en tâche »). The exports go
// through the phone's « Enregistrer sous » (Android's share sheet, here a
// double that records the file): same names, same contents as the PC. Only
// the assistant's reading is left out: on the phone it is without effect.
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
import { fakeLibrary, MODULES, NOW, REFERENCE, runScenario } from './scenario';

describe('the Boîte à idées on the phone (sqlite-wasm + phone host) = the reference', () => {
  let hub: PhoneHub | null = null;
  afterEach(async () => {
    await hub?.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('same answers of every route, same exports, same stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    const saves: { name: string; data?: string }[] = [];
    const db = await openWasmDatabase();
    hub = await PhoneHub.start({
      db,
      modules: [
        fakeLibrary() as never,
        ...((await Promise.all(
          ['todo', 'ideas'].map((id) => loadModuleFolder(path.join(MODULES, id))),
        )) as never[]),
      ],
      host: {
        saveAs: (o) => {
          saves.push({ name: o.defaultName, data: String(o.data) });
          return Promise.resolve(`export-${saves.length}`);
        },
      },
      log: () => {},
    });
    expect(hub.modules().map((m) => [m.id, m.status])).toEqual([
      ['music-library', 'loaded'],
      ['todo', 'loaded'],
      ['ideas', 'loaded'],
    ]);
    const phone = hub;
    const steps = await runScenario({
      request: (method, url, body) => phoneRequest(phone, method, url, body),
      later: (minutes) => vi.setSystemTime(Date.now() + minutes * 60_000),
    });
    const snapshot = referenceShape(
      { steps, saves, tables: dumpWasmTables(db, 'ideas') },
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
