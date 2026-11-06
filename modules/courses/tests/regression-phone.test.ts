// The Courses' non-regression reference replayed on the PHONE's stack (ADR
// 0044): the same server code on sqlite-wasm and the phone host (mini
// router). The base is built by the JSON import, as on the PC: on the phone
// the import is reserved to the PC (its « avant import » backup needs the
// PC's ctx.db.backup), so the test gives that backup itself. The export goes
// through « Enregistrer sous » (Android's share sheet, here a double that
// records the file). Only the assistant's reading is left out.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadModuleFolder,
  openWasmDatabase,
  PhoneHub,
  phoneRequest,
  UnavailableOnPhoneError,
} from '@hub/sdk/testing';
import { localToday } from '../shared/dates';
import { asV026, REFERENCE, runScenario, withThawByDay, type Snapshot } from './scenario';
import { readFileSync } from 'node:fs';

const courses = async () => (await loadModuleFolder(path.resolve(__dirname, '..'))) as never;

describe('the Courses on the phone (sqlite-wasm + phone host) = the reference', () => {
  let hub: PhoneHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
  });

  it('same meals, list, costs, summary, history, text, batch and export', async () => {
    let saved = '';
    hub = await PhoneHub.start({
      db: await openWasmDatabase(),
      modules: [await courses()],
      host: {
        saveAs: (o) => {
          saved = String(o.data);
          return Promise.resolve(o.defaultName);
        },
        backupDb: (reason) => `test-${reason}`,
      },
      log: () => {},
    });
    expect(hub.modules().map((m) => [m.id, m.status])).toEqual([['courses', 'loaded']]);
    const phone = hub;
    const { snapshot, state } = await runScenario({
      request: (method, url, body) => phoneRequest(phone, method, url, body),
      lastSaved: () => saved,
    });
    const { home, ...rest } = asV026(snapshot) as Snapshot & {
      home: { today: string; meals: { name: string }[] };
    };
    const {
      home: _home,
      assistant: _assistant,
      ...reference
    } = withThawByDay(JSON.parse(readFileSync(REFERENCE, 'utf8')) as Snapshot);
    void _home;
    void _assistant;
    expect(rest).toEqual(reference);
    const todayPlan = (state.plan as { date: string; mealId: string }[]).filter(
      (p) => p.date === localToday(),
    );
    expect(home.meals.map((m) => m.name).sort()).toEqual(
      todayPlan.map((p) => state.meals.find((m) => m.id === p.mealId)!.name).sort(),
    );
  });

  it('in the app the JSON import is refused (the PC keeps it): nothing written', async () => {
    hub = await PhoneHub.start({
      db: await openWasmDatabase(),
      modules: [await courses()],
      log: () => {},
    });
    const text = JSON.stringify({
      format: 'toolbox-courses',
      version: 1,
      ingredients: [{ name: 'Riz', unit: 'g' }],
    });
    const r = await phoneRequest<{ error: string }>(
      hub,
      'POST',
      '/api/modules/courses/import/apply',
      {
        text,
        create: [],
      },
    );
    expect(r.status).toBe(500);
    expect(r.body.error).toContain(new UnavailableOnPhoneError('ctx.db.backup').message);
    const state = await phoneRequest<{ ingredients: unknown[] }>(
      hub,
      'GET',
      '/api/modules/courses/state',
    );
    expect(state.body.ingredients).toEqual([]);
  });
});
