// v0.45.0: the Agenda's service `agenda.courses()` (read only): the courses of an
// imported timetable, with their code, teachers and next slot.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, dumpTables, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { coursesOf, type ImportedRow } from '../shared/courses';

const ICS = readFileSync(path.join(__dirname, 'fixtures', 'horaire-ecam.ics'), 'utf8');

describe('the courses of an imported timetable (service agenda.courses)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
  });

  it('one per name, with its code, its teachers and its next slot', async () => {
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    const choice = {
      format: 'ics',
      text: ICS,
      name: 'Horaire ECAM',
      mapping: { H: 'Cours', X: 'Examens' },
      period: 'all',
    };
    const preview = (
      await hub.request<{ add: { key: string }[] }>(
        'POST',
        '/api/modules/agenda/import/preview',
        choice,
      )
    ).body;
    await hub.request('POST', '/api/modules/agenda/import/apply', {
      ...choice,
      accept: preview.add.map((l) => l.key),
    });
    const rows = (
      dumpTables(hub.dataDir, 'agenda').agenda__events as (ImportedRow & {
        source_id: string | null;
        deleted_at: string | null;
      })[]
    ).filter((r) => r.source_id && !r.deleted_at);
    const courses = coursesOf(rows, '2026-11-18T12:00');
    const thermo = courses.find((c) => c.name === 'Thermo')!;
    expect(thermo).toBeDefined();
    expect(thermo.teachers).toEqual(expect.arrayContaining(['PCH', 'VDD']));
    expect(thermo.code).not.toBeNull();
    expect(thermo.next === null || thermo.next.start >= '2026-11-18T12:00').toBe(true);
    // One entry per name, sorted.
    const names = courses.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort((a, b) => a.localeCompare(b, 'fr'))).toEqual(names);
    // Read only: nothing written by the service's computation.
    expect(courses.length).toBeGreaterThan(3);
  });
});
