// Non-regression of the Sport module (step 2 of the phone version, ADR 0044):
// a realistic base built through the API on a frozen clock (Wednesday
// 2026-11-04, 10:00 local time), then the answers of every route (reads,
// writes, restores, exports, home card), the assistant's reading, the
// calendar and every stored row. The reference (fixtures/regression.json)
// was written by the v0.29.0 code, before the code was made portable: the
// same base must give exactly the same answers and the same data.
//
// To rewrite the reference (only on purpose): TOOLBOX_WRITE_REFERENCE=1.
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestHost,
  createTestHub,
  dumpTables,
  loadModuleFolder,
  readReference,
  referenceShape,
  type TestHub,
} from '@hub/sdk/testing';
import { NOW, REFERENCE, runScenario } from './scenario';

describe('non-regression of Sport (reference: v0.29.0)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  it('same answers of every route, same exports, same stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const out = mkdtempSync(path.join(os.tmpdir(), 'sport-reg-'));
    const saves: { name: string; data?: string }[] = [];
    let n = 0;
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({
        selectSaveFile: (o) => {
          saves.push({ name: path.basename(o.defaultPath ?? '') });
          return Promise.resolve(path.join(out, `export-${++n}`));
        },
      }),
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    const { steps, calendar } = await runScenario({
      request: (method, url, body) => hub.request(method, url, body),
    });
    for (const [i, s] of saves.entries())
      s.data = readFileSync(path.join(out, `export-${i + 1}`), 'utf8');
    // The assistant's reading and the calendar.
    const assistant = {
      session: await hub.hub.assistant.run('sport.today-session', {}),
      exercises: await hub.hub.assistant.run('sport.today-exercises', {}),
      week: await hub.hub.assistant.run('sport.week-summary', {}),
      done: await hub.hub.assistant.run('sport.session-done', {}),
    };

    const snapshot = referenceShape(
      {
        steps,
        saves,
        assistant,
        calendar,
        tables: dumpTables(hub.dataDir, 'sport'),
      },
      NOW.getTime(),
    );
    expect(snapshot).toEqual(readReference(REFERENCE, snapshot));
  });
});
