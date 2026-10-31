// Sport, the rest of the logic on a real hub: exercise lines edited one by one
// (ids kept, only what changed journalled), usage counts, a template change
// of the exercises (future untouched sessions only), cancel and back,
// deletion and « Annuler », the assistant's reading and its right.
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

describe('sport (solidified)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
  });
  const monday = mondayOf(localToday());
  const week = async (start = '') =>
    (await hub.request<WeekDto>('GET', `${API}/week${start ? `?start=${start}` : ''}`)).body;
  const journal = (entity: string) => {
    const db = new Database(path.join(hub.dataDir, 'hub.db'), { readonly: true });
    const rows = db
      .prepare('SELECT entity_id, op, data FROM sport__changes WHERE entity = ? ORDER BY at')
      .all(entity) as { entity_id: string; op: string; data: string | null }[];
    db.close();
    return rows;
  };
  const template = [
    {
      weekday: 1,
      name: 'Jambes',
      start: '18:30',
      durationMin: 75,
      exercises: [
        { name: 'Squat', sets: 4, reps: '8', load: '60 kg', restSec: 120 },
        { name: 'Fentes', sets: 3, reps: '10' },
      ],
    },
  ];

  it('a line changed alone: same id, only its changed field written', async () => {
    hub = await open();
    await hub.request('PUT', `${API}/template`, { items: template });
    const next = addDays(monday, 7);
    const s = (await week(next)).days[0]!.sessions[0]!;
    const [squat, fentes] = s.exercises;
    const before = journal('session_exercises').length;
    const r = await hub.request<{ exercises: { id: string; load: string }[] }>(
      'PATCH',
      `${API}/sessions/${s.id}`,
      { exercises: [{ ...squat, load: '65 kg' }, fentes] },
    );
    expect(r.body.exercises.map((l) => l.id)).toEqual([squat!.id, fentes!.id]);
    expect(r.body.exercises[0]!.load).toBe('65 kg');
    const written = journal('session_exercises').slice(before);
    expect(written).toEqual([
      { entity_id: squat!.id, op: 'update', data: JSON.stringify({ load: '65 kg' }) },
    ]);
    // Reordered, one removed, one added.
    const again = await hub.request<{ exercises: { id: string; name: string }[] }>(
      'PATCH',
      `${API}/sessions/${s.id}`,
      { exercises: [fentes, { name: 'Mollets', sets: 4, reps: '15' }] },
    );
    expect(again.body.exercises.map((l) => l.name)).toEqual(['Fentes', 'Mollets']);
    expect(again.body.exercises[0]!.id).toBe(fentes!.id);
    const ops = journal('session_exercises')
      .slice(before + 1)
      .map((j) => j.op)
      .sort();
    expect(ops).toEqual(['create', 'delete', 'update']); // Mollets, Squat, Fentes moved up
  });

  it('usage counts and a template change of the exercises: future untouched sessions only', async () => {
    hub = await open();
    await hub.request('PUT', `${API}/template`, { items: template });
    const w1 = addDays(monday, 7);
    const w2 = addDays(monday, 14);
    const s1 = (await week(w1)).days[0]!.sessions[0]!;
    const s2 = (await week(w2)).days[0]!.sessions[0]!;
    // s2 gets its own list: the template no longer touches it.
    await hub.request('PATCH', `${API}/sessions/${s2.id}`, {
      exercises: [{ name: 'Presse', sets: 3, reps: '12' }],
    });
    const lib = async () =>
      (
        await hub.request<{ exercises: { name: string; uses: number }[] }>(
          'GET',
          `${API}/exercises`,
        )
      ).body.exercises;
    // Template (1) + s1 (1) for Squat; Presse only on s2.
    expect(Object.fromEntries((await lib()).map((e) => [e.name, e.uses]))).toMatchObject({
      Squat: 2,
      Fentes: 2,
      Presse: 1,
    });
    const t = (await week()).template;
    await hub.request('PUT', `${API}/template`, {
      items: t.map((x) => ({ ...x, exercises: [{ ...x.exercises[0], sets: 5 }] })),
    });
    const after1 = (await week(w1)).days[0]!.sessions[0]!;
    const after2 = (await week(w2)).days[0]!.sessions[0]!;
    expect(after1.id).not.toBe(s1.id); // replaced, as a planned untouched session after today
    expect(after1.exercises.map((l) => `${l.name} ${l.sets}`)).toEqual(['Squat 5']);
    expect(after2.exercises.map((l) => l.name)).toEqual(['Presse']);
  });

  it('cancel and back; a session added by hand deleted and restored; a template session refused', async () => {
    hub = await open();
    await hub.request('PUT', `${API}/template`, { items: template });
    const next = addDays(monday, 7);
    const s = (await week(next)).days[0]!.sessions[0]!;
    await hub.request('PATCH', `${API}/sessions/${s.id}`, { status: 'cancelled' });
    expect((await week(next)).summary.planned).toBe(0);
    await hub.request('PATCH', `${API}/sessions/${s.id}`, { status: 'planned' });
    expect((await week(next)).summary.planned).toBe(1);
    expect((await hub.request('DELETE', `${API}/sessions/${s.id}`)).status).toBe(400);
    const added = (
      await hub.request<{ id: string }>('POST', `${API}/sessions`, {
        date: next,
        name: 'Yoga',
        exercises: [{ name: 'Chien tête en bas', reps: '1 min' }],
      })
    ).body;
    expect((await hub.request('DELETE', `${API}/sessions/${added.id}`)).status).toBe(200);
    expect((await week(next)).days[0]!.sessions.map((x) => x.name)).toEqual(['Jambes']);
    const back = await hub.request<{ name: string; exercises: { name: string }[] }>(
      'POST',
      `${API}/sessions/${added.id}/restore`,
    );
    expect(back.body).toMatchObject({ name: 'Yoga', exercises: [{ name: 'Chien tête en bas' }] });
  });

  it('assistant: exercises of the day and week summary read freely; changes behind the right', async () => {
    hub = await open();
    const wd = ((new Date().getDay() + 6) % 7) + 1;
    await hub.request('PUT', `${API}/template`, {
      items: [{ ...template[0], weekday: wd }],
    });
    expect(await hub.hub.assistant.run('sport.today-exercises', {})).toMatchObject({
      status: 'done',
      message: 'Jambes : Squat 4 × 8 · 60 kg · repos 2 min, Fentes 3 × 10.',
    });
    expect(await hub.hub.assistant.run('sport.week-summary', {})).toMatchObject({
      status: 'done',
      message: expect.stringMatching(/^Cette semaine : 0 séance faite sur 1/),
    });
    expect((await hub.hub.assistant.run('sport.session-done', { done: true })).status).toBe(
      'forbidden',
    );
    hub.hub.assistant.setRight('sport.edit-sessions', true);
    const done = await hub.hub.assistant.run('sport.session-done', { done: true });
    expect(done).toMatchObject({ status: 'done', message: 'Jambes : faite.' });
    expect((await week()).summary.done).toBe(1);
    if (done.status === 'done' && done.undoId) await hub.hub.assistant.undo(done.undoId);
    expect((await week()).summary.done).toBe(0);
  });
});
