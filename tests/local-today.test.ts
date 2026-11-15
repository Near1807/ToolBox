// « Today » as Thomas sees it (v0.36.2, audit v0.36.1 B1): the computer's
// local day, not the UTC one. In Brussels, between midnight and 01:00 (02:00
// in summer), the UTC day is still yesterday. Checked at 00:00 and 01:00,
// Brussels time, in winter (UTC+1) and in summer (UTC+2): the SDK's
// localToday, the name offered for a backup export, the Boîte à idées export
// (its file name, « exportées le », « créée le »). The tests run in UTC
// elsewhere (vitest.config.ts): this file sets Brussels for itself.
process.env.TZ = 'Europe/Brussels';

import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localToday } from '@hub/sdk/dates';
import { createTestHost, createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';

const MODULES = path.resolve(import.meta.dirname, '../modules');
// [label, the instant, the local day Thomas sees, the day the old code (UTC) gave]
const MOMENTS: [string, string, string, string][] = [
  ['winter, 00:00', '2026-01-11T23:00:00Z', '2026-01-12', '2026-01-11'],
  ['winter, 01:00', '2026-01-12T00:00:00Z', '2026-01-12', '2026-01-12'],
  ['summer, 00:00', '2026-07-12T22:00:00Z', '2026-07-13', '2026-07-12'],
  ['summer, 01:00', '2026-07-12T23:00:00Z', '2026-07-13', '2026-07-12'],
];

describe('today in Brussels, not in UTC', () => {
  let hub: TestHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
    vi.useRealTimers();
  });

  it('the time zone of this file is Brussels', () => {
    expect(new Date('2026-01-11T23:00:00Z').getHours()).toBe(0);
    expect(new Date('2026-07-12T22:00:00Z').getHours()).toBe(0);
  });

  for (const [label, instant, day, utcDay] of MOMENTS) {
    it(`localToday, ${label}`, () => {
      expect(localToday(new Date(instant))).toBe(day);
      // What the old code gave (the day before, except at 01:00 in winter).
      expect(new Date(instant).toISOString().slice(0, 10)).toBe(utcDay);
    });

    it(`backup export and Boîte à idées export, ${label}`, async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(instant) });
      const out = mkdtempSync(path.join(os.tmpdir(), 'local-today-'));
      const offered: string[] = [];
      hub = await createTestHub({
        loadExamples: false,
        host: createTestHost({
          selectSaveFile: (o) => {
            offered.push(path.basename(o.defaultPath ?? ''));
            return Promise.resolve(offered.length === 1 ? null : path.join(out, 'ideas.md'));
          },
        }),
        modules: [await loadModuleFolder(path.join(MODULES, 'ideas'))],
      });
      // The backup: only the name offered matters (cancelled here).
      expect((await hub.request('POST', '/api/core/backups/export')).body).toEqual({
        cancelled: true,
      });
      expect(offered[0]).toBe(`ToolBox-sauvegarde-${day}.zip`);
      // An idea noted now, then exported.
      expect(
        (await hub.request('POST', '/api/modules/ideas/ideas', { title: 'Pont' })).status,
      ).toBe(200);
      expect((await hub.request('POST', '/api/modules/ideas/export', {})).status).toBe(200);
      expect(offered[1]).toBe(`Boîte à idées - ${day}.md`);
      const text = readFileSync(path.join(out, 'ideas.md'), 'utf8');
      expect(text).toContain(`exportées le ${day}.`);
      expect(text).toContain(`créée le ${day}`);
    });
  }
});
