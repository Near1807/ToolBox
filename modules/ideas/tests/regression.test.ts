// Non-regression of the Boîte à idées (step 2 of the phone version, ADR
// 0044): a realistic base built through the API on a frozen clock
// (Wednesday 2026-11-04, 10:00 local time, then moved forward), with the
// To-do and a music library present, then the answers of every route (reads
// with search, tags and sorts, writes, archives, restores, tags renamed,
// merged and coloured, « Transformer en tâche », the export, the home card,
// an idea at random), the assistant's reading and every stored row. The
// reference (fixtures/regression.json) was written by the v0.29.0 code,
// before the code was made portable.
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
import { fakeLibrary, MODULES, NOW, REFERENCE, runScenario } from './scenario';

describe('non-regression of the Boîte à idées (reference: v0.29.0)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('same answers of every route, same export, same stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    const later = (minutes: number) => vi.setSystemTime(Date.now() + minutes * 60_000);
    const out = mkdtempSync(path.join(os.tmpdir(), 'ideas-reg-'));
    const saves: { name: string; data?: string }[] = [];
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({
        selectSaveFile: (o) => {
          saves.push({ name: path.basename(o.defaultPath ?? '') });
          return Promise.resolve(path.join(out, `export-${saves.length}`));
        },
      }),
      modules: [
        fakeLibrary() as never,
        ...(await Promise.all(
          ['todo', 'ideas'].map((id) => loadModuleFolder(path.join(MODULES, id))),
        )),
      ],
    });
    const steps = await runScenario({
      request: (method, url, body) => hub.request(method, url, body),
      later,
    });
    for (const [i, s] of saves.entries())
      s.data = readFileSync(path.join(out, `export-${i + 1}`), 'utf8');
    const assistant = {
      list: await hub.hub.assistant.run('ideas.list-ideas', {}),
      tag: await hub.hub.assistant.run('ideas.list-ideas', { tag: 'visuel' }),
      random: await hub.hub.assistant.run('ideas.random-idea', {}),
      add: await hub.hub.assistant.run('ideas.add-idea', { text: 'Interdit' }),
    };

    const snapshot = referenceShape(
      { steps, saves, assistant, tables: dumpTables(hub.dataDir, 'ideas') },
      NOW.getTime(),
    );
    expect(snapshot).toEqual(readReference(REFERENCE, snapshot));
  });
});
