// Importing a calendar into a source (v0.37.0, Expérimental): the preview
// writes nothing; the import adds, updates, never duplicates; what the user
// changed is flagged and unchecked; what is gone is deleted only when checked
// (a tombstone, restorable); the import can be undone; the source's mapping
// and its deletion. Local time: Brussels (set here), today 15 November 2026.
process.env.TZ = 'Europe/Brussels';

import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, dumpTables, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { itemsOf, timedBlocks } from '../frontend/common';
import { isOn } from '../shared/categories';
import type { ImportPreview } from '../shared/importing';
import type { AgendaSourceDto, RangeDto } from '../shared/types';

const MODULES = path.resolve(__dirname, '..', '..');
const API = '/api/modules/agenda';
const NOW = new Date(2026, 10, 15, 10, 0, 0);
const ICS = readFileSync(path.join(__dirname, 'fixtures', 'horaire-ecam.ics'), 'utf8');
const MAPPING = { H: 'Cours', X: 'Examens' };

type Preview = ImportPreview & { sourceId: string | null };
interface Applied {
  importId: string | null;
  backup: string | null;
  source: AgendaSourceDto;
  added: number;
  updated: number;
  removed: number;
  same: number;
}

describe('importing a calendar (ICS)', () => {
  let hub: TestHub;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.join(MODULES, 'agenda'))],
    });
  });
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await hub.request<T>(method, `${API}${url}`, body);
    if (r.status !== 200)
      throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  type Row = Record<string, string | number | null>;
  const rows = () => dumpTables(hub.dataDir, 'agenda') as Record<string, Row[]>;
  const live = () => rows().agenda__events!.filter((e) => e.deleted_at === null);
  const asNew = { format: 'ics', name: 'Horaire ECAM', mapping: MAPPING, defaultCategory: 'Cours' };
  const keysOf = (p: Preview) => [...p.add, ...p.modified.filter((m) => !m.mine)].map((l) => l.key);
  const importAll = async (text = ICS, extra: Record<string, unknown> = {}) => {
    const p = await call<Preview>('POST', '/import/preview', { ...asNew, text, ...extra });
    return call<Applied>('POST', '/import/apply', { ...asNew, text, ...extra, accept: keysOf(p) });
  };

  it('analyse: the calendar name, the categories with their counts, no source yet', async () => {
    const a = await call<{
      calendarName: string;
      total: number;
      future: number;
      errors: number;
      categories: { value: string; count: number }[];
      matches: unknown[];
      codes: boolean;
    }>('POST', '/import/analyze', { format: 'ics', text: ICS });
    expect(a.calendarName).toBe('Horaire ECAM');
    expect(a.errors).toBe(1);
    expect(a.categories.map((c) => c.value)).toEqual(['H', 'X']);
    expect(a.categories[1]!.count).toBe(8);
    expect(a.future).toBeLessThan(a.total);
    expect(a.matches).toEqual([]);
    expect(a.codes).toBe(true);
    expect(rows().agenda__events).toEqual([]);
  });

  it('the preview writes nothing; from today by default, the past is « ignoré »', async () => {
    const before = JSON.stringify(rows());
    const p = await call<Preview>('POST', '/import/preview', { ...asNew, text: ICS });
    expect(JSON.stringify(rows())).toBe(before);
    expect(p.add.length).toBeGreaterThan(30);
    expect(p.add.every((l) => l.end.slice(0, 10) >= '2026-11-15')).toBe(true);
    expect(p.ignored.length).toBeGreaterThan(50);
    expect(p.errors.map((e) => e.reason)).toEqual([
      'répétition non prise en charge : « RRULE:FREQ=MONTHLY;BYMONTHDAY=7;COUNT=5 »',
    ]);
    expect(p.categories).toEqual([
      { value: 'H', count: expect.any(Number), category: 'Cours' },
      { value: 'X', count: 3, category: 'Examens' },
    ]);
    const all = await call<Preview>('POST', '/import/preview', {
      ...asNew,
      text: ICS,
      period: 'all',
    });
    expect(all.ignored).toEqual([]);
    expect(all.add.length).toBe(p.add.length + p.ignored.length);
    // The title with its code, on request.
    const coded = await call<Preview>('POST', '/import/preview', {
      ...asNew,
      text: ICS,
      titleStyle: 'code',
    });
    // v0.38.0: the code is the course's SUMMARY (« TH2C-L2-4MIN »), the name its « Act: » line.
    expect(
      coded.add.map((l) => l.title).some((t) => /^TH2C-[A-Z0-9]+-[0-9A-Z]+ · Thermo$/.test(t)),
    ).toBe(true);
    expect(p.add.map((l) => l.title)).toContain('Thermo');
  });

  it('import, then the same file again: everything « identique », nothing written', async () => {
    const done = await importAll();
    expect(done.added).toBeGreaterThan(30);
    expect(done.backup).toMatch(/\.db$/);
    expect(done.source.name).toBe('Horaire ECAM');
    expect(done.source.categories).toEqual(['Cours', 'Examens']);
    const count = live().length;
    expect(count).toBe(done.added);
    const exam = live().find((e) => e.title === 'Thermo · Écrit')!;
    expect(exam).toMatchObject({
      category: 'Examens',
      start_at: '2027-01-11T08:30',
      end_at: '2027-01-11T11:30',
    });
    expect(exam.note).toMatch(/^Enseignants : [A-Z]{3} [A-Z]{3} [A-Z]{3}$/);
    expect(JSON.parse(String(exam.origin)).original).toMatchObject({
      SUMMARY: 'TH2C:Thermo',
      DESCRIPTION: expect.stringContaining('TH2C:Thermo[ECRIT]'),
    });

    const journal = rows().agenda__changes!.length;
    const again = await call<Preview>('POST', '/import/preview', {
      format: 'ics',
      text: ICS,
      sourceId: done.source.id,
    });
    expect(again.sourceId).toBe(done.source.id);
    expect(again.add).toEqual([]);
    expect(again.modified).toEqual([]);
    expect(again.gone).toEqual([]);
    expect(again.same).toBe(count);
    const second = await call<Applied>('POST', '/import/apply', {
      format: 'ics',
      text: ICS,
      sourceId: done.source.id,
      accept: [],
      remove: [],
    });
    expect(second).toMatchObject({
      importId: null,
      backup: null,
      added: 0,
      updated: 0,
      removed: 0,
    });
    expect(rows().agenda__changes!.length).toBe(journal);
    expect(live().length).toBe(count);
    // The same file is recognised as this source (name and UIDs).
    const a = await call<{ matches: { id: string; byName: boolean; shared: number }[] }>(
      'POST',
      '/import/analyze',
      { format: 'ics', text: ICS },
    );
    expect(a.matches).toEqual([
      { id: done.source.id, name: 'Horaire ECAM', byName: true, shared: expect.any(Number) },
    ]);
    expect(a.matches[0]!.shared).toBeGreaterThan(30);
  });

  it('a changed file: modified (with the differences), « modifié par toi » unchecked, gone unchecked', async () => {
    const done = await importAll();
    const id = done.source.id;
    // The user renames one of the courses of the 24 November and moves another one.
    const thermo = live().find((e) => e.start_at === '2026-11-24T08:15')!;
    await call('PATCH', `/events/${thermo.id}`, { title: 'Thermo (amphi)' });
    const info = live().find(
      (e) => e.title === 'Séance d’information stages' || String(e.title).startsWith('Séance'),
    )!;
    // The school changes the room of the information session and drops an exam.
    const changed = ICS.replace(
      'LOCATION:Auditoire Ampère\r\nCATEGORIES:H\r\nEND:VEVENT\r\nEND:VCALENDAR',
      'LOCATION:Salle 1A12\r\nCATEGORIES:H\r\nEND:VEVENT\r\nEND:VCALENDAR',
    ).replace(
      /BEGIN:VEVENT\r\nDTSTAMP:20261101T090000Z\r\nUID:X-IN4D-[^\r]+\r\n(?:[^\r]*\r\n)*?END:VEVENT\r\n/,
      '',
    );
    const p = await call<Preview>('POST', '/import/preview', {
      format: 'ics',
      text: changed,
      sourceId: id,
    });
    expect(p.add).toEqual([]);
    const room = p.modified.find((m) => m.id === info.id)!;
    expect(room.changes).toEqual([
      { field: 'location', label: 'Lieu', before: 'Auditoire Ampère', after: 'Salle 1A12' },
    ]);
    expect(room.mine).toBe(false);
    expect(p.gone.map((g) => g.title)).toEqual(['Réseaux · Oral']);
    // The renamed course: same in the file, the user's title kept, nothing proposed.
    expect(p.modified.find((m) => m.id === thermo.id)).toBeUndefined();

    // Now the school changes the course the user renamed: flagged « modifié par toi ».
    const both = changed.replace(
      /(RRULE:FREQ=WEEKLY;COUNT=12;BYDAY=TU\r\nSUMMARY:[^\r]*\r\nDESCRIPTION:Act:)Thermo/,
      '$1Thermodynamique',
    );
    const p2 = await call<Preview>('POST', '/import/preview', {
      format: 'ics',
      text: both,
      sourceId: id,
    });
    const renamed = p2.modified.filter((m) => m.title === 'Thermodynamique');
    expect(renamed.map((m) => [m.start, m.mine])).toEqual([
      ['2026-11-17T08:15', false],
      ['2026-11-24T08:15', true],
      ['2026-12-01T08:15', false],
    ]);
    expect(renamed[1]!.changes).toEqual([
      { field: 'title', label: 'Titre', before: 'Thermo (amphi)', after: 'Thermodynamique' },
    ]);
    // Apply with the defaults of the page: modified checked except « mine », gone unchecked.
    const applied = await call<Applied>('POST', '/import/apply', {
      format: 'ics',
      text: changed,
      sourceId: id,
      accept: keysOf(p),
      remove: [],
    });
    expect(applied).toMatchObject({ added: 0, updated: 1, removed: 0 });
    expect(live().find((e) => e.id === info.id)!.location).toBe('Salle 1A12');
    const exam = live().find((e) => e.title === 'Réseaux · Oral');
    expect(exam).toBeDefined(); // Gone from the file, unchecked: still there.
    expect(live().find((e) => e.id === thermo.id)!.title).toBe('Thermo (amphi)');

    // Checked: a tombstone, that « Restaurer » brings back.
    const p3 = await call<Preview>('POST', '/import/preview', {
      format: 'ics',
      text: changed,
      sourceId: id,
    });
    expect(p3.gone).toHaveLength(1);
    const removed = await call<Applied>('POST', '/import/apply', {
      format: 'ics',
      text: changed,
      sourceId: id,
      accept: [],
      remove: [p3.gone[0]!.key],
    });
    expect(removed.removed).toBe(1);
    const tomb = rows().agenda__events!.find((e) => e.id === exam!.id)!;
    expect(tomb.deleted_at).not.toBeNull();
    await call('POST', `/events/${exam!.id}/restore`);
    expect(live().find((e) => e.id === exam!.id)).toBeDefined();
  });

  it('a deleted event comes back unchecked (« supprimé avant »), restored, never twice', async () => {
    const done = await importAll();
    const one = live().find((e) => e.start_at === '2026-11-27T08:15')!;
    await call('DELETE', `/events/${one.id}`);
    const p = await call<Preview>('POST', '/import/preview', {
      format: 'ics',
      text: ICS,
      sourceId: done.source.id,
    });
    expect(p.add).toEqual([expect.objectContaining({ key: one.origin_key, deletedBefore: true })]);
    await call('POST', '/import/apply', {
      format: 'ics',
      text: ICS,
      sourceId: done.source.id,
      accept: [one.origin_key],
    });
    expect(
      live()
        .filter((e) => e.origin_key === one.origin_key)
        .map((e) => e.id),
    ).toEqual([one.id]);
  });

  it('« Annuler l’import »: everything undone; then the undo is gone', async () => {
    const done = await importAll();
    expect(live().length).toBe(done.added);
    await call('POST', '/import/undo', { importId: done.importId });
    expect(live()).toEqual([]);
    expect(await call<AgendaSourceDto[]>('GET', '/sources')).toEqual([]);
    expect(
      (await hub.request('POST', `${API}/import/undo`, { importId: done.importId })).status,
    ).toBe(404);
    // An update undone: back to what it was.
    const again = await importAll();
    const info = live().find(
      (e) => e.location === 'Auditoire Ampère' && String(e.title).startsWith('Séance'),
    )!;
    const changed = ICS.replace(
      'LOCATION:Auditoire Ampère\r\nCATEGORIES:H\r\nEND:VEVENT\r\nEND:VCALENDAR',
      'LOCATION:Salle 1A12\r\nCATEGORIES:H\r\nEND:VEVENT\r\nEND:VCALENDAR',
    );
    const p = await call<Preview>('POST', '/import/preview', {
      format: 'ics',
      text: changed,
      sourceId: again.source.id,
    });
    const upd = await call<Applied>('POST', '/import/apply', {
      format: 'ics',
      text: changed,
      sourceId: again.source.id,
      accept: keysOf(p),
    });
    expect(live().find((e) => e.id === info.id)!.location).toBe('Salle 1A12');
    await call('POST', '/import/undo', { importId: upd.importId });
    expect(live().find((e) => e.id === info.id)!.location).toBe('Auditoire Ampère');
    expect(live().length).toBe(again.added);
  });

  it('the events are ordinary ones, with their source; « Cours » off = neither shown nor counted', async () => {
    await importAll();
    const range = await call<RangeDto>('GET', '/range?from=2026-11-16&to=2026-11-22');
    const course = range.events.find((e) => e.title === 'Thermo')!;
    expect(course.source).toMatchObject({
      name: 'Horaire ECAM',
      original: { DESCRIPTION: expect.stringContaining('Act:Thermo'), CATEGORIES: 'H' },
    });
    expect(range.categories).toContain('Cours');
    const on = (category: string) => isOn(category, {}, range.categoriesOff);
    const off = (category: string) => isOn(category, { Cours: false }, range.categoriesOff);
    expect(itemsOf(range, on).some((i) => i.event.category === 'Cours')).toBe(true);
    expect(itemsOf(range, off).some((i) => i.event.category === 'Cours')).toBe(false);
    expect(timedBlocks(range, off).some((b) => b.category === 'Cours')).toBe(false);
    // An event typed by hand has no source.
    const own = await call<{ source?: unknown }>('POST', '/events', {
      title: 'Dentiste',
      start: '2026-11-18T17:00',
      end: '2026-11-18T17:30',
    });
    expect(own.source).toBeUndefined();
  });

  it('the source: mapping changed (applied to its events, not to those the user recategorised), deleted, restored', async () => {
    const done = await importAll();
    const exams = live().filter((e) => e.category === 'Examens');
    expect(exams).toHaveLength(3);
    await call('PATCH', `/events/${exams[0]!.id}`, { category: 'Perso' });
    const s = await call<AgendaSourceDto>('PATCH', `/sources/${done.source.id}`, {
      mapping: { H: 'Cours', X: 'Session' },
    });
    expect(s.categories).toEqual(['Cours', 'Perso', 'Session']);
    expect(live().filter((e) => e.category === 'Session')).toHaveLength(2);
    // The next import sees nothing changed.
    const p = await call<Preview>('POST', '/import/preview', {
      format: 'ics',
      text: ICS,
      sourceId: done.source.id,
    });
    expect([p.add.length, p.modified.length, p.gone.length]).toEqual([0, 0, 0]);
    // Renamed, then deleted: its events become tombstones; restored with them.
    await call('PATCH', `/sources/${done.source.id}`, { name: 'Horaire Q2' });
    const count = live().length;
    const del = await call<{ events: number; backup: string }>(
      'DELETE',
      `/sources/${done.source.id}`,
    );
    expect(del.events).toBe(count);
    expect(live()).toEqual([]);
    expect(rows().agenda__events!.length).toBe(count);
    const back = await call<AgendaSourceDto>('POST', `/sources/${done.source.id}/restore`);
    expect(back).toMatchObject({ name: 'Horaire Q2', events: count });
  });

  it('refusals: not a calendar, nothing written; no name for a new source', async () => {
    const bad = await hub.request<{ error: string }>('POST', `${API}/import/preview`, {
      ...asNew,
      text: 'Bonjour',
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toMatch(/n’est pas un calendrier ICS/);
    const noName = await hub.request('POST', `${API}/import/preview`, { format: 'ics', text: ICS });
    expect(noName.status).toBe(400);
    const apply = await hub.request('POST', `${API}/import/apply`, {
      ...asNew,
      text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
      accept: [],
    });
    expect(apply.status).toBe(400);
    expect(rows().agenda__events).toEqual([]);
    expect(rows().agenda__sources).toEqual([]);
  });

  it('v0.38.0: a re-import after v0.37.0 proposes the new titles as « modifié », no duplicate, « modifié par toi » kept', async () => {
    const done = await importAll();
    const count = live().length;
    // The base as v0.37.0 left it: the title was the SUMMARY (« TH2C-L2-4MIN »,
    // « Thermo » for an exam without its type). Written as an old base would hold it.
    const legacy = (summary: string) => {
      const c = /^([A-Z0-9][A-Z0-9_.-]{0,15})\s*:\s*(.+)$/.exec(summary.trim());
      return c ? c[2]!.trim() : summary.trim();
    };
    const db = new Database(path.join(hub.dataDir, 'hub.db'));
    const rows = db
      .prepare('SELECT id, origin FROM agenda__events WHERE deleted_at IS NULL')
      .all() as { id: string; origin: string }[];
    for (const r of rows) {
      const origin = JSON.parse(r.origin) as {
        original: Record<string, string>;
        imported: Record<string, unknown>;
      };
      const old = legacy(origin.original.SUMMARY ?? '');
      origin.imported.title = old;
      db.prepare('UPDATE agenda__events SET title = ?, origin = ? WHERE id = ?').run(
        old,
        JSON.stringify(origin),
        r.id,
      );
    }
    // One the user renamed himself after the v0.37.0 import.
    const mine = rows[0]!.id;
    db.prepare('UPDATE agenda__events SET title = ? WHERE id = ?').run('Mon cours à moi', mine);
    db.close();

    const p = await call<Preview>('POST', '/import/preview', {
      format: 'ics',
      text: ICS,
      sourceId: done.source.id,
    });
    expect([p.add.length, p.gone.length]).toEqual([0, 0]);
    // All but the two without a code (« Congé… », « Séance d'information… »): same title as before.
    expect(p.same).toBe(2);
    expect(p.modified.length).toBe(count - 2);
    const thermo = p.modified.find((m) => m.title === 'Thermo · Écrit')!;
    expect(thermo.changes).toEqual([
      { field: 'title', label: 'Titre', before: 'Thermo', after: 'Thermo · Écrit' },
    ]);
    const course = p.modified.find(
      (m) => m.title === 'Computer Network Lab' || m.title === 'Thermo',
    )!;
    expect(course.changes[0]).toMatchObject({
      field: 'title',
      before: expect.stringMatching(/^(®-)?[A-Z0-9]+-/),
    });
    expect(p.modified.filter((m) => m.mine).map((m) => m.id)).toEqual([mine]);
    // With the page's defaults (« modifié par toi » unchecked): no duplicate, the user's title kept.
    const applied = await call<Applied>('POST', '/import/apply', {
      format: 'ics',
      text: ICS,
      sourceId: done.source.id,
      accept: keysOf(p),
      remove: [],
    });
    expect(applied).toMatchObject({ added: 0, updated: count - 3, removed: 0 });
    expect(live().length).toBe(count);
    expect(live().find((e) => e.id === mine)!.title).toBe('Mon cours à moi');
    expect(live().filter((e) => e.title === 'Thermo · Écrit').length).toBeGreaterThan(0);
  });
});
