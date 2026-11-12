// Non-regression of the Agenda (v0.34.0): every route of the scenario
// (scenario.ts), the calendar and every stored row, on a frozen clock.
// To rewrite the reference (only on purpose): TOOLBOX_WRITE_REFERENCE=1.
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestHub,
  dumpTables,
  loadModuleFolder,
  readReference,
  referenceShape,
  type TestHub,
} from '@hub/sdk/testing';
import { MODULES, NOW, REFERENCE, runScenario } from './scenario';

describe('non-regression of the Agenda (reference: v0.34.0)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  it('same answers of every route, same calendar, same stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    hub = await createTestHub({
      loadExamples: false,
      modules: await Promise.all(
        ['todo', 'agenda'].map((id) => loadModuleFolder(path.join(MODULES, id))),
      ),
    });
    const { steps, calendar } = await runScenario({
      request: (method, url, body) => hub.request(method, url, body),
      later: (minutes) => vi.setSystemTime(Date.now() + minutes * 60_000),
    });
    const snapshot = referenceShape(
      {
        steps,
        calendar,
        tables: dumpTables(hub.dataDir, 'agenda'),
        todo: dumpTables(hub.dataDir, 'todo'),
      },
      NOW.getTime(),
    );
    expect(snapshot).toEqual(readReference(REFERENCE, snapshot));
  });
});
