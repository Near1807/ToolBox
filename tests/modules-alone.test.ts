// Optional services are really optional (ADR 0024, docs/MODULES.md §4): each
// module of the phone loads ALONE, without any of the modules whose services
// it may use, on the PC and on the phone's stack, and every read route of its
// page answers 200 (and the PC's calendar too). The modules are loaded by their folder,
// never imported (the core knows no module).
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestHub,
  loadModuleFolder,
  openWasmDatabase,
  PhoneHub,
  phoneRequest,
  type TestHub,
} from '@hub/sdk/testing';

const MODULES = path.resolve(import.meta.dirname, '../modules');
// The read routes of each page (no parameter in the path), with the query a
// page sends: all answer 200 on an empty base, the module alone.
const ROUTES: Record<string, string[]> = {
  todo: ['/tasks', '/today'],
  ideas: ['/ideas', '/random', '/home'],
  sport: ['/week', '/month', '/exercises', '/home'],
  timer: ['/state', '/notice'],
  courses: ['/state', '/batch', '/list/text', '/lists/history', '/summary', '/home'],
  agenda: ['/range?from=2026-11-09&to=2026-11-15', '/today'],
};
const CALENDAR = '/api/core/calendar?from=2026-11-09&to=2026-11-15';

describe('each module of the phone, alone (optional services absent)', () => {
  let pc: TestHub | null = null;
  let phone: PhoneHub | null = null;
  afterEach(async () => {
    await pc?.close();
    await phone?.close();
    pc = null;
    phone = null;
  });

  for (const id of Object.keys(ROUTES)) {
    it(`${id} on the PC`, async () => {
      pc = await createTestHub({
        modules: [await loadModuleFolder(path.join(MODULES, id))],
        loadExamples: false,
      });
      const infos = (await pc.request<{ id: string; status: string }[]>('GET', '/api/core/modules'))
        .body;
      expect(infos.map((m) => [m.id, m.status])).toEqual([[id, 'loaded']]);
      for (const route of ROUTES[id]!) {
        const { status } = await pc.request('GET', `/api/modules/${id}${route}`);
        expect(status, route).toBe(200);
      }
      expect((await pc.request('GET', CALENDAR)).status).toBe(200);
    });

    it(`${id} on the phone`, async () => {
      phone = await PhoneHub.start({
        db: await openWasmDatabase(),
        modules: [(await loadModuleFolder(path.join(MODULES, id))) as never],
        log: () => {},
      });
      expect(phone.modules().map((m) => [m.id, m.status])).toEqual([[id, 'loaded']]);
      const hub = phone;
      for (const route of ROUTES[id]!) {
        const { status } = await phoneRequest(hub, 'GET', `/api/modules/${id}${route}`);
        expect(status, route).toBe(200);
      }
    });
  }
});
