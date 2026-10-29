// Sport on a real hub: the template on the weeks to come (not the past), a
// change after today, validation, mood, comment, a move inside the week, a
// session added by hand, the calendar source, the assistant and its right.
import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHost, createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { addDays, localToday, mondayOf } from '../shared/plan';
import type { WeekDto } from '../shared/types';

const API = '/api/modules/sport';
const open = async (saveTo: string | null = null) =>
  createTestHub({
    loadExamples: false,
    host: createTestHost({ selectSaveFile: () => Promise.resolve(saveTo) }),
    modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
  });

describe('sport', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
  });
  const week = async (start = '') =>
    (await hub.request<WeekDto>('GET', `${API}/week${start ? `?start=${start}` : ''}`)).body;
  const monday = mondayOf(localToday());
  const items = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    name: `Séance ${weekday}`,
    start: '18:00',
    durationMin: 60,
  }));

  it('the template fills this week and the next ones, never a past week', async () => {
    hub = await open();
    // The week shown before any template (home card): it still fills completely later.
    expect((await week()).days.flatMap((d) => d.sessions)).toHaveLength(0);
    expect(
      (
        await hub.request('PUT', `${API}/template`, {
          items: [{ weekday: 9, name: 'x', start: '18:00', durationMin: 60 }],
        })
      ).status,
    ).toBe(400);
    await hub.request('PUT', `${API}/template`, { items });
    const w = await week();
    expect(w.days.map((d) => d.sessions.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect((await week(addDays(monday, 7))).days.flatMap((d) => d.sessions)).toHaveLength(7);
    expect((await week(addDays(monday, -7))).days.flatMap((d) => d.sessions)).toHaveLength(0);
    // UUIDs and the journal (« Prêt pour la synchro »).
    expect(w.days[0]!.sessions[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    const db = new Database(path.join(hub.dataDir, 'hub.db'), { readonly: true });
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM sport__changes').get() as { n: number }).n,
    ).toBeGreaterThan(14);
    db.close();
  });

  it('validation, mood, comment, move in the week, cancel, a session added by hand', async () => {
    hub = await open();
    await hub.request('PUT', `${API}/template`, { items });
    const w = await week();
    const s = w.days[1]!.sessions[0]!;
    const done = await hub.request<{
      status: string;
      mood: number;
      comment: string;
      custom: boolean;
    }>('PATCH', `${API}/sessions/${s.id}`, {
      status: 'done',
      mood: 4,
      comment: 'bien',
    });
    expect(done.body).toMatchObject({ status: 'done', mood: 4, comment: 'bien', custom: false });
    expect((await hub.request('PATCH', `${API}/sessions/${s.id}`, { mood: 7 })).status).toBe(400);
    // Move: inside the week only, and it becomes « changed by hand ».
    expect(
      (await hub.request('PATCH', `${API}/sessions/${s.id}`, { date: addDays(monday, 9) })).status,
    ).toBe(400);
    const moved = await hub.request<{ date: string; custom: boolean }>(
      'PATCH',
      `${API}/sessions/${s.id}`,
      { date: addDays(monday, 6), start: '07:30' },
    );
    expect(moved.body).toMatchObject({ date: addDays(monday, 6), custom: true });
    await hub.request('PATCH', `${API}/sessions/${w.days[2]!.sessions[0]!.id}`, {
      status: 'cancelled',
    });
    const extra = await hub.request<{ id: string; templateId: null }>('POST', `${API}/sessions`, {
      date: addDays(monday, 3),
      name: 'Course',
      start: '07:00',
      durationMin: 30,
    });
    expect(extra.body.templateId).toBeNull();
    const after = await week();
    expect(after.summary.done).toBe(1);
    expect(after.summary.planned).toBe(7); // 7 template − 1 cancelled + 1 added
    expect(after.summary.mood).toBe(4);
  });

  it('a template change touches the days after today only', async () => {
    hub = await open();
    await hub.request('PUT', `${API}/template`, { items });
    await week(addDays(monday, 7));
    const next = (await week()).template.map((t) => ({ ...t, name: `${t.name} bis` }));
    await hub.request('PUT', `${API}/template`, { items: next });
    const today = localToday();
    const w = await week();
    for (const d of w.days)
      for (const s of d.sessions) expect(s.name.endsWith(' bis')).toBe(d.date > today);
    expect(
      (await week(addDays(monday, 7))).days.every((d) => d.sessions[0]!.name.endsWith(' bis')),
    ).toBe(true);
  });

  it('calendar source: sessions as events, without writing anything', async () => {
    hub = await open();
    await hub.request('PUT', `${API}/template`, { items });
    const far = addDays(monday, 28);
    const r = await hub.request<{
      events: {
        title: string;
        start: string;
        durationMin: number;
        moduleId: string;
        open: string;
      }[];
    }>('GET', `/api/core/calendar?from=${far}&to=${addDays(far, 6)}`);
    expect(r.body.events).toHaveLength(7);
    expect(r.body.events[0]).toMatchObject({
      title: 'Séance 1',
      start: `${far}T18:00`,
      durationMin: 60,
      moduleId: 'sport',
      open: `/m/sport?week=${far}`,
    });
    const db = new Database(path.join(hub.dataDir, 'hub.db'), { readonly: true });
    expect(
      (
        db.prepare('SELECT COUNT(*) AS n FROM sport__weeks WHERE week = ?').get(far) as {
          n: number;
        }
      ).n,
    ).toBe(0);
    db.close();
  });

  it('assistant: reading is free, changes need « valider et modifier les séances » (off)', async () => {
    hub = await open();
    await hub.request('PUT', `${API}/template`, { items });
    expect(hub.hub.assistant.rights().find((r) => r.id === 'sport.edit-sessions')).toMatchObject({
      granted: false,
    });
    expect(await hub.hub.assistant.run('sport.today-session', {})).toMatchObject({
      status: 'done',
      message: expect.stringMatching(/^Aujourd’hui : Séance \d à 18h00 \(60 min\)\.$/),
    });
    expect((await hub.hub.assistant.run('sport.session-done', { done: true })).status).toBe(
      'forbidden',
    );
    hub.hub.assistant.setRight('sport.edit-sessions', true);
    const done = await hub.hub.assistant.run('sport.session-done', { done: true });
    expect(done).toMatchObject({ status: 'done', message: expect.stringMatching(/faite\.$/) });
    expect(await hub.hub.assistant.run('sport.week-summary', {})).toMatchObject({
      message: expect.stringMatching(/^Cette semaine : 1 séance faite sur 7/),
    });
    if (done.status === 'done' && done.undoId) await hub.hub.assistant.undo(done.undoId);
    expect((await week()).summary.done).toBe(0);
    const move = await hub.hub.assistant.run('sport.move-session', { from: 2, to: 4 });
    expect(move).toMatchObject({
      status: 'done',
      message: expect.stringMatching(/^Séance 2 déplacée de mardi à jeudi/),
    });
  });

  it('exercises: template list copied to sessions, own list per session, library, merge', async () => {
    hub = await open();
    await hub.request('PUT', `${API}/template`, {
      items: items.map((it) =>
        it.weekday === 1
          ? {
              ...it,
              exercises: [
                { name: 'Squat', sets: 4, reps: '8', load: '60 kg', restSec: 90 },
                { name: 'Gainage', sets: 3, reps: '30 s' },
              ],
            }
          : it,
      ),
    });
    const lib = async () =>
      (
        await hub.request<{ exercises: { id: string; name: string; uses: number }[] }>(
          'GET',
          `${API}/exercises`,
        )
      ).body.exercises;
    expect((await lib()).map((e) => e.name)).toEqual(['Gainage', 'Squat']);
    // Same name, other spelling: no duplicate.
    expect((await hub.request('POST', `${API}/exercises`, { name: 'squat' })).status).toBe(409);
    const w = await week(addDays(monday, 7));
    const mon = w.days[0]!.sessions[0]!;
    expect(mon.exercises.map((e) => `${e.name} ${e.sets}×${e.reps}`)).toEqual([
      'Squat 4×8',
      'Gainage 3×30 s',
    ]);
    // A list for that session alone: the template keeps its own.
    const squats = (
      await hub.request<{ id: string }>('POST', `${API}/exercises`, { name: 'Squats barre' })
    ).body;
    await hub.request('PATCH', `${API}/sessions/${mon.id}`, {
      exercises: [{ exerciseId: squats.id, sets: 5, reps: '5', load: '70 kg' }],
    });
    const after = await week(addDays(monday, 7));
    expect(after.days[0]!.sessions[0]!.exercises.map((e) => e.name)).toEqual(['Squats barre']);
    expect(after.days[0]!.sessions[0]!.custom).toBe(true);
    expect(after.template.find((t) => t.weekday === 1)!.exercises.map((e) => e.name)).toEqual([
      'Squat',
      'Gainage',
    ]);
    // Merge « Squats barre » into « Squat »: the session follows; the duplicate goes.
    const squat = (await lib()).find((e) => e.name === 'Squat')!;
    expect((await hub.request('DELETE', `${API}/exercises/${squat.id}`)).status).toBe(400); // used
    await hub.request('POST', `${API}/exercises/merge`, { from: squats.id, into: squat.id });
    expect((await lib()).map((e) => e.name)).toEqual(['Gainage', 'Squat']);
    const merged = (await week(addDays(monday, 7))).days[0]!.sessions[0]!;
    expect(merged.exercises.map((e) => `${e.name} ${e.load}`)).toEqual(['Squat 70 kg']);
    // Read by the assistant.
    expect((await hub.hub.assistant.run('sport.today-exercises', {})).status).toBe('done');
  });

  it('a session added by hand is deleted (and restored); one of the template is not', async () => {
    hub = await open();
    await hub.request('PUT', `${API}/template`, { items });
    const next = addDays(monday, 7);
    const added = (
      await hub.request<{ id: string }>('POST', `${API}/sessions`, {
        date: next,
        name: 'Course',
        start: '07:00',
        durationMin: 30,
      })
    ).body;
    const fromTemplate = (await week(next)).days[0]!.sessions.find((s) => s.templateId)!;
    expect((await hub.request('DELETE', `${API}/sessions/${fromTemplate.id}`)).status).toBe(400);
    expect((await hub.request('DELETE', `${API}/sessions/${added.id}`)).status).toBe(200);
    expect((await week(next)).days[0]!.sessions.map((s) => s.name)).toEqual(['Séance 1']);
    await hub.request('POST', `${API}/sessions/${added.id}/restore`);
    expect((await week(next)).days[0]!.sessions.map((s) => s.name).sort()).toEqual([
      'Course',
      'Séance 1',
    ]);
  });

  it('export: the comment and the exercises are in the CSV and the Markdown', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sport-export-'));
    const csvPath = path.join(dir, 'sport.csv');
    hub = await open(csvPath);
    await hub.request('PUT', `${API}/template`, {
      items: [{ ...items[0]!, exercises: [{ name: 'Squat', sets: 4, reps: '8', load: '60 kg' }] }],
    });
    const s = (await week()).days[0]!.sessions[0]!;
    await hub.request('PATCH', `${API}/sessions/${s.id}`, {
      status: 'done',
      comment: 'Bonne séance; genou "ok"\nà surveiller',
    });
    await hub.request('POST', `${API}/export`, {
      format: 'csv',
      from: monday,
      to: addDays(monday, 6),
    });
    const csv = readFileSync(csvPath, 'utf8');
    expect(csv.split('\n')[0]).toBe(
      'date;séance;début;durée_min;état;humeur;commentaire;exercices',
    );
    expect(csv).toContain('"Bonne séance; genou ""ok""\nà surveiller";Squat 4 × 8 · 60 kg');
    await hub.close();
    const mdPath = path.join(dir, 'sport.md');
    hub = await open(mdPath);
    // A new hub starts empty: same template again.
    await hub.request('PUT', `${API}/template`, {
      items: [{ ...items[0]!, exercises: [{ name: 'Squat', sets: 4, reps: '8', load: '60 kg' }] }],
    });
    const s2 = (await week()).days[0]!.sessions[0]!;
    await hub.request('PATCH', `${API}/sessions/${s2.id}`, { comment: 'RAS' });
    await hub.request('POST', `${API}/export`, {
      format: 'md',
      from: monday,
      to: addDays(monday, 6),
    });
    const md = readFileSync(mdPath, 'utf8');
    expect(md).toContain('  - Commentaire : RAS');
    expect(md).toContain('    - Squat 4 × 8 · 60 kg');
  });
});
