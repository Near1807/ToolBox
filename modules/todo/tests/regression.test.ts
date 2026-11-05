// Non-regression of the To-do (step 2 of the phone version, ADR 0044): a
// realistic base built through the API on a frozen clock (Wednesday
// 2026-11-04, 10:00 local time, then moved forward), with the Timer and a
// music library present, then the answers of every route (reads, writes,
// restores, home card), what the service `todo` gives other modules, the
// assistant's reading, the calendar and every stored row. The reference
// (fixtures/regression.json) was written by the v0.29.0 code, before the
// code was made portable.
//
// To rewrite the reference (only on purpose): TOOLBOX_WRITE_REFERENCE=1.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestHub,
  dumpTables,
  loadModuleFolder,
  readReference,
  referenceShape,
  type TestHub,
} from '@hub/sdk/testing';
import path from 'node:path';
import {
  fakeLibrary,
  MODULES,
  NOW,
  REFERENCE,
  runAssistant,
  runScenario,
  type Services,
} from './scenario';

describe('non-regression of the To-do (reference: v0.29.0)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  it('same answers of every route, same service, same stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const probe: { services?: Services } = {};
    hub = await createTestHub({
      loadExamples: false,
      modules: [
        fakeLibrary(probe) as never,
        ...(await Promise.all(
          ['todo', 'timer'].map((id) => loadModuleFolder(path.join(MODULES, id))),
        )),
      ],
    });
    const { steps, service, calendar } = await runScenario({
      request: (method, url, body) => hub.request(method, url, body),
      services: () => probe.services!,
      later: (minutes) => vi.setSystemTime(Date.now() + minutes * 60_000),
    });
    const assistant = await runAssistant((id, params) => hub.hub.assistant.run(id, params));

    const snapshot = referenceShape(
      { steps, service, assistant, calendar, tables: dumpTables(hub.dataDir, 'todo') },
      NOW.getTime(),
    );
    expect(snapshot).toEqual(readReference(REFERENCE, snapshot));
  });
});
