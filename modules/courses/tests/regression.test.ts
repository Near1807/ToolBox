// Non-regression of the recipes' readers on the PC (scenario.ts): the
// reference (fixtures/regression.json) was written by the v0.26.0 code.
//
// To rewrite the reference (only on purpose): TOOLBOX_WRITE_REFERENCE=1.
import path from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHost, createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { localToday } from '../shared/dates';
import { asV026, REFERENCE, runScenario, withThawByDay, type Snapshot } from './scenario';

describe('non-regression of the readers of a recipe (reference: v0.26.0)', () => {
  let hub: TestHub;
  afterEach(async () => hub?.close());

  it('same meals, list, costs, summary, history, text, batch, export and assistant', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'courses-reg-'));
    const saveTo = path.join(out, 'export.json');
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({ selectSaveFile: () => Promise.resolve(saveTo) }),
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    const { snapshot, state } = await runScenario(
      {
        request: (method, url, body) => hub.request(method, url, body),
        lastSaved: () => readFileSync(saveTo, 'utf8'),
      },
      async () => ({
        assistant: {
          listCost: await hub.hub.assistant.run('courses.cost', { what: 'list' }),
          weekCost: await hub.hub.assistant.run('courses.cost', { what: 'week' }),
          weekProtein: await hub.hub.assistant.run('courses.nutrition', {
            nutrient: 'protein',
            day: 'week',
          }),
          shopping: await hub.hub.assistant.run('courses.shopping-list', {}),
        },
      }),
    );
    if (process.env.TOOLBOX_WRITE_REFERENCE === '1')
      writeFileSync(REFERENCE, `${JSON.stringify(snapshot, null, 2)}\n`);
    // The home card lists today's meals: it depends on the day the test runs (the reference
    // was written on a Sunday), so it is checked apart, against the planning of today.
    const { home, ...rest } = asV026(snapshot) as Snapshot & {
      home: { today: string; meals: { name: string }[] };
    };
    const { home: _home, ...reference } = withThawByDay(
      JSON.parse(readFileSync(REFERENCE, 'utf8')) as Snapshot,
    );
    void _home;
    expect(rest).toEqual(reference);
    const todayPlan = (state.plan as { date: string; mealId: string }[]).filter(
      (p) => p.date === localToday(),
    );
    expect(home.meals.map((m) => m.name).sort()).toEqual(
      todayPlan.map((p) => state.meals.find((m) => m.id === p.mealId)!.name).sort(),
    );
  });
});
