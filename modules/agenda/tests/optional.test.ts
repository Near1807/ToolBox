// « Facultatif » (v0.40.0): an event of the Agenda kept in its place but
// neither in the conflicts nor in the load; Thomas's, never a file's.
process.env.TZ = 'Europe/Brussels';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, dumpTables, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { timedBlocks } from '../frontend/common';
import { dayLoad, placeDay } from '../shared/load';
import type { ImportPreview } from '../shared/importing';
import type { AgendaEventDto, RangeDto } from '../shared/types';

const API = '/api/modules/agenda';
const block = (id: string, start: string, end: string, optional = false) => ({
  id,
  start: `2026-11-18T${start}`,
  end: `2026-11-18T${end}`,
  category: 'Cours',
  optional,
});

describe('conflicts and load (pure)', () => {
  it('an overlap with a « facultatif » is no conflict; two that count are', () => {
    const one = placeDay('2026-11-18', [
      block('cours', '08:15', '10:00', true),
      block('dentiste', '09:00', '09:30'),
    ]);
    expect(one.map((p) => [p.id, p.overlaps, p.lanes])).toEqual([
      ['cours', false, 2],
      ['dentiste', false, 2],
    ]);
    const two = placeDay('2026-11-18', [
      block('cours', '08:15', '10:00'),
      block('dentiste', '09:00', '09:30'),
    ]);
    expect(two.map((p) => p.overlaps)).toEqual([true, true]);
    // Three: the two that count still conflict, the « facultatif » does not.
    const three = placeDay('2026-11-18', [
      block('cours', '08:15', '10:00', true),
      block('dentiste', '09:00', '09:30'),
      block('appel', '09:15', '09:45'),
    ]);
    expect(Object.fromEntries(three.map((p) => [p.id, p.overlaps]))).toEqual({
      cours: false,
      dentiste: true,
      appel: true,
    });
  });
  it('the load and the free time leave a « facultatif » out', () => {
    const own = (id: string, optional: boolean): AgendaEventDto => ({
      id,
      title: id,
      start: '2026-11-18T08:00',
      end: '2026-11-18T10:00',
      allDay: false,
      location: null,
      note: null,
      category: 'Cours',
      weekly: null,
      timerPref: null,
      ...(optional ? { optional: true as const } : {}),
    });
    const data = {
      events: [own('a', true), own('b', false)],
      foreign: [],
      tasks: [],
    } as unknown as RangeDto;
    expect(timedBlocks(data).map((b) => b.id)).toEqual(['b']);
    const range = { startHour: 7, endHour: 23 };
    expect(dayLoad('2026-11-18', timedBlocks(data), [], range).totalMin).toBe(120);
  });
});

describe('« facultatif » through the routes', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });
  const open = async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 15, 10) });
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
  };
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await hub.request<T>(method, `${API}${url}`, body);
    if (r.status !== 200)
      throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const row = (id: string) =>
    (dumpTables(hub.dataDir, 'agenda').agenda__events as Record<string, unknown>[]).find(
      (e) => e.id === id,
    )!;

  it('off by default; one write, its undo; refused when not a yes / no', async () => {
    await open();
    const made = await call<AgendaEventDto>('POST', '/events', {
      title: 'Dentiste',
      start: '2026-11-18T09:00',
      end: '2026-11-18T09:30',
    });
    expect(made.optional).toBeUndefined();
    expect(row(made.id).optional).toBe(0);
    const journal = () => dumpTables(hub.dataDir, 'agenda').agenda__changes!.length;
    const before = journal();
    const on = await call<AgendaEventDto>('PATCH', `/events/${made.id}`, { optional: true });
    expect(on.optional).toBe(true);
    expect(row(made.id).optional).toBe(1);
    expect(journal()).toBe(before + 1);
    const week = await call<RangeDto>('GET', '/range?from=2026-11-16&to=2026-11-22');
    expect(week.events.find((e) => e.id === made.id)!.optional).toBe(true);
    // « Annuler »: the opposite write.
    await call('PATCH', `/events/${made.id}`, { optional: false });
    expect(row(made.id).optional).toBe(0);
    expect(
      (await hub.request('PATCH', `${API}/events/${made.id}`, { optional: 'oui' })).status,
    ).toBe(400);
  });

  it('a re-import never reads, writes nor counts it (« modifié par toi » unchanged)', async () => {
    await open();
    const ics = readFileSync(path.join(__dirname, 'fixtures', 'horaire-ecam.ics'), 'utf8');
    const choice = {
      format: 'ics',
      text: ics,
      name: 'Horaire ECAM',
      mapping: { H: 'Cours', X: 'Examens' },
    };
    const p = await call<ImportPreview>('POST', '/import/preview', choice);
    const done = await call<{ source: { id: string } }>('POST', '/import/apply', {
      ...choice,
      accept: p.add.map((l) => l.key),
    });
    const course = (
      dumpTables(hub.dataDir, 'agenda').agenda__events as Record<string, unknown>[]
    ).find((e) => e.title === 'Thermo')!;
    await call('PATCH', `/events/${String(course.id)}`, { optional: true });
    // The same file: everything the same, nothing written, still « facultatif ».
    const again = await call<ImportPreview>('POST', '/import/preview', {
      format: 'ics',
      text: ics,
      sourceId: done.source.id,
    });
    expect([again.add.length, again.modified.length, again.gone.length]).toEqual([0, 0, 0]);
    // A changed file (its room): « modifié », not « modifié par toi »; applied, still « facultatif ».
    const changed = ics.replace(
      /(RRULE:FREQ=WEEKLY;COUNT=12;BYDAY=TU\r\n(?:[^\r]*\r\n)*?)LOCATION:[^\r]*/,
      '$1LOCATION:Salle 1A12',
    );
    const p2 = await call<ImportPreview>('POST', '/import/preview', {
      format: 'ics',
      text: changed,
      sourceId: done.source.id,
    });
    const mine = p2.modified.find((m) => m.id === course.id)!;
    expect(mine.mine).toBe(false);
    expect(mine.changes.map((c) => c.field)).toEqual(['location']);
    await call('POST', '/import/apply', {
      format: 'ics',
      text: changed,
      sourceId: done.source.id,
      accept: p2.modified.map((m) => m.key),
    });
    expect(row(String(course.id))).toMatchObject({ location: 'Salle 1A12', optional: 1 });
  });
});
