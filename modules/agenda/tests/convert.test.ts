// v0.43.0 (the fix planned for v0.41.1): the « Rendez-vous » destination never
// creates a task; « Convertir en tâche / en rendez-vous », one action each,
// « Annuler » puts back exactly the state of before; the timer follows.
process.env.TZ = 'Europe/Brussels';

import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, dumpTables, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { AgendaEventDto } from '../shared/types';

const API = '/api/modules/agenda';
const MODULES = path.resolve(__dirname, '..', '..');

describe('conversions and the « Rendez-vous » destination', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });
  const open = async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 17, 10) });
    hub = await createTestHub({
      loadExamples: false,
      modules: await Promise.all(
        ['todo', 'agenda'].map((id) => loadModuleFolder(path.join(MODULES, id))),
      ),
    });
  };
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await hub.request<T>(method, `${API}${url}`, body);
    if (r.status !== 200)
      throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const rows = () => ({
    events: dumpTables(hub.dataDir, 'agenda').agenda__events as Record<string, unknown>[],
    tasks: dumpTables(hub.dataDir, 'todo').todo__tasks as Record<string, unknown>[],
  });
  /** What a row says, without its clocks (a restore writes updated_at). */
  const content = (r: Record<string, unknown> | undefined) =>
    r && Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'updated_at'));

  it('« Rendez-vous » of the « Ajouter » bar: no date and time, or « ~1h » without a time → nothing written', async () => {
    await open();
    for (const text of ['appeler la banque', 'préparer la réunion ~1h', 'rendre le rapport ~2h']) {
      const r = await hub.request('POST', `${API}/quick`, { text, mode: 'appointment' });
      expect(r.status, text).toBe(400);
      expect(JSON.stringify(r.body)).toContain('Rien n’a été ajouté');
    }
    expect(rows().tasks).toEqual([]);
    expect(rows().events).toEqual([]);
    // With a date and a time: a rendez-vous.
    const ok = await call<{ kind: string }>('POST', '/quick', {
      text: 'dentiste jeudi 14h',
      mode: 'appointment',
    });
    expect(ok.kind).toBe('event');
    // The Agenda's own bar keeps « à caser » (a task) as before.
    const bar = await call<{ kind: string }>('POST', '/quick', { text: 'appeler la banque' });
    expect(bar.kind).toBe('task');
  });

  it('an event → a task (same time, same length, its timer); « Annuler » = exactly before', async () => {
    await open();
    const made = await call<AgendaEventDto>('POST', '/events', {
      title: 'Réviser thermo',
      start: '2026-11-18T14:00',
      end: '2026-11-18T15:30',
    });
    await call('PATCH', `/events/${made.id}`, { timerPref: { kind: 'pomodoro' } });
    const before = rows();
    const r = await call<{
      task: { id: string; plannedAt: string; durationMin: number };
      eventId: string;
    }>('POST', `/events/${made.id}/to-task`);
    expect(r.task).toMatchObject({ plannedAt: '2026-11-18T14:00', durationMin: 90 });
    const task = rows().tasks.find((t) => t.id === r.task.id)!;
    expect(JSON.parse(String(task.timer_pref))).toEqual({ kind: 'pomodoro' });
    expect(rows().events[0]!.deleted_at).not.toBeNull();
    // « Annuler »: the task deleted again, the event back.
    await call('DELETE', `/tasks/${r.task.id}`);
    await call('POST', `/events/${made.id}/restore`);
    const after = rows();
    expect(content(after.events[0])).toEqual(content(before.events[0]));
    expect(after.tasks.filter((t) => t.deleted_at === null)).toEqual([]);
  });

  it('a task → an event (planned: timed; only due: all day); « Annuler » = the task back as it was', async () => {
    await open();
    const planned = await call<{ id: string }>('POST', '/tasks', {
      title: 'Appeler le garage',
      plannedAt: '2026-11-19T09:00',
      durationMin: 30,
    });
    const before = rows();
    const r = await call<{ event: AgendaEventDto; taskId: string }>(
      'POST',
      `/tasks/${planned.id}/to-event`,
    );
    expect(r.event).toMatchObject({
      start: '2026-11-19T09:00',
      end: '2026-11-19T09:30',
      allDay: false,
      title: 'Appeler le garage',
    });
    expect(rows().tasks[0]!.deleted_at).not.toBeNull();
    await call('DELETE', `/events/${r.event.id}`);
    await call('POST', `/tasks/${planned.id}/restore`);
    expect(content(rows().tasks[0])).toEqual(content(before.tasks[0]));
    expect(rows().events.filter((e) => e.deleted_at === null)).toEqual([]);
    // A task « à caser » with only a due date: an all-day event.
    const due = await hub.request<{ id: string }>('POST', '/api/modules/todo/tasks', {
      title: 'Rendre le rapport',
      due: '2026-11-20',
    });
    const allDay = await call<{ event: AgendaEventDto }>('POST', `/tasks/${due.body.id}/to-event`);
    expect(allDay.event).toMatchObject({ allDay: true, start: '2026-11-20', end: '2026-11-20' });
    // Neither a time nor a due date: refused, nothing written.
    const loose = await call<{ task: { id: string } }>('POST', '/quick', {
      text: 'acheter du pain',
    });
    const count = rows().events.length;
    expect((await hub.request('POST', `${API}/tasks/${loose.task.id}/to-event`)).status).toBe(409);
    expect(rows().events.length).toBe(count);
  });
});
