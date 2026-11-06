// Non-regression of the Timer (step 2 of the phone version, ADR 0044): on a
// frozen clock (Wednesday 2026-11-04, 10:00 local time) moved forward by
// hand, with the To-do present: presets, a simple timer, a pomodoro linked to
// a task through its phases (pause, resume, extend, skip, the end, « Tâche
// terminée ? », « Oui », « Annuler », « Non »), a stopped incremental
// pomodoro; the state at each step, the notifications and the floating
// window, what the service `timer` gives the To-do, the assistant's reading,
// the calendar and every stored row. The reference (fixtures/regression.json)
// was written by the v0.29.0 code, before the code was made portable.
//
// To rewrite the reference (only on purpose): TOOLBOX_WRITE_REFERENCE=1.
import path from 'node:path';
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
import { MODULES, NOW, probeModule, REFERENCE, runScenario, type Services } from './scenario';

describe('non-regression of the Timer (reference: v0.29.0)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  it('same states, phases, answers, service and stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const later = (seconds: number) => vi.setSystemTime(Date.now() + seconds * 1000);
    const probe: { services?: Services } = {};
    const notes: string[] = [];
    const overlay: boolean[] = [];
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({
        notify: (n) => notes.push(`${n.title} — ${n.body ?? ''}`),
        setOverlayVisible: (visible) => overlay.push(visible),
      }),
      modules: [
        probeModule(probe) as never,
        ...(await Promise.all(
          ['todo', 'timer'].map((id) => loadModuleFolder(path.join(MODULES, id))),
        )),
      ],
    });
    const { steps, service, calendar } = await runScenario({
      request: (method, url, body) => hub.request(method, url, body),
      services: () => probe.services!,
      later,
    });
    const assistant = {
      status: await hub.hub.assistant.run('timer.timer-status', {}),
      start: await hub.hub.assistant.run('timer.start-timer', { minutes: 5 }),
    };

    const snapshot = referenceShape(
      {
        steps,
        service,
        notes,
        overlay,
        assistant,
        calendar,
        tables: dumpTables(hub.dataDir, 'timer'),
      },
      NOW.getTime(),
    );
    expect(snapshot).toEqual(readReference(REFERENCE, snapshot));
  });
});
