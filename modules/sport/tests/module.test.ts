// Sport on a real hub: the template on the weeks to come (not the past), a
// change after today, validation, mood, comment, a move inside the week, a
// session added by hand, the calendar source, the assistant and its right.
import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { addDays, localToday, mondayOf } from '../shared/plan';
import type { WeekDto } from '../shared/types';

const API = '/api/modules/sport';
const open = async () =>
  createTestHub({
    loadExamples: false,
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
});
