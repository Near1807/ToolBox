// The Timer from the Agenda (v0.36.0): the lent « timer.launch » starts
// through the Timer's own API — linked to the task (« Tâche terminée ? »
// ticks it) or to the event (`subject`); the Agenda shows which block's
// timer runs; the associated timer is kept with the task or the event.
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { RangeDto } from '../shared/types';

const MODULES = path.resolve(__dirname, '..', '..');
const API = '/api/modules/agenda';
const TODO = '/api/modules/todo';
const TIMER = '/api/modules/timer';
const NOW = new Date(2026, 10, 12, 10, 0, 0);

describe('the Timer from the Agenda', () => {
  let hub: TestHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
    vi.useRealTimers();
  });
  const open = async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    hub = await createTestHub({
      loadExamples: false,
      modules: await Promise.all(
        ['todo', 'timer', 'agenda'].map((id) => loadModuleFolder(path.join(MODULES, id))),
      ),
    });
  };
  const week = async () =>
    (await hub!.request<RangeDto>('GET', `${API}/range?from=2026-11-09&to=2026-11-15`)).body;

  it('a task: the session is linked to it; « Tâche terminée ? » → « Oui » ticks it', async () => {
    await open();
    const task = (
      await hub!.request<{ id: string }>('POST', `${TODO}/tasks`, {
        title: 'Réviser',
        plannedAt: '2026-11-12T10:00',
        durationMin: 1,
      })
    ).body;
    // What « Durée du bloc » sends.
    const started = await hub!.request<{ taskId: string; name: string; subject: string | null }>(
      'POST',
      `${TIMER}/start`,
      { config: { mode: 'simple', workMin: 1 }, name: 'Réviser', taskId: task.id, subject: null },
    );
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ taskId: task.id, subject: null });
    expect((await week()).timer).toEqual({ taskId: task.id, subject: null });
    // A second one while it runs: refused (the lent button asks, then stops it first).
    const twice = await hub!.request('POST', `${TIMER}/start`, {
      config: { mode: 'simple', workMin: 5 },
    });
    expect(twice.status).toBe(409);
    // The end, then « Oui »: ticked in the To-do, crossed out in the Agenda.
    vi.setSystemTime(new Date(NOW.getTime() + 2 * 60_000));
    await hub!.request('GET', `${TIMER}/state`);
    const answer = await hub!.request<{ ticked: boolean }>('POST', `${TIMER}/answer`, {
      done: true,
    });
    expect(answer.body.ticked).toBe(true);
    expect((await week()).tasks.find((t) => t.id === task.id)).toMatchObject({ done: true });
  });

  it('an event: the session carries its reference; the Agenda knows it runs', async () => {
    await open();
    const event = (
      await hub!.request<{ id: string }>('POST', `${API}/events`, {
        title: 'Répétition',
        start: '2026-11-12T10:00',
        end: '2026-11-12T11:30',
      })
    ).body;
    const started = await hub!.request<{ subject: string; name: string }>(
      'POST',
      `${TIMER}/start`,
      {
        config: { mode: 'simple', workMin: 90 },
        name: 'Répétition',
        subject: `agenda:event:${event.id}`,
      },
    );
    expect(started.body).toMatchObject({ name: 'Répétition', subject: `agenda:event:${event.id}` });
    expect((await week()).timer).toEqual({ taskId: null, subject: `agenda:event:${event.id}` });
    // Running: a second one is refused (the lent button asks, then stops it first).
    expect(
      (
        await hub!.request('POST', `${TIMER}/start`, {
          config: { mode: 'simple', workMin: 5 },
          subject: 'agenda:event:autre',
        })
      ).status,
    ).toBe(409);
    await hub!.request('POST', `${TIMER}/stop`);
    expect(
      (
        await hub!.request('POST', `${TIMER}/start`, {
          config: { mode: 'simple', workMin: 5 },
          subject: 'pas une référence',
        })
      ).status,
    ).toBe(400);
    expect((await week()).timer).toBeNull();
  });

  it('« Associer un timer »: kept with the task (To-do) and the event / the week type (Agenda)', async () => {
    await open();
    const task = (await hub!.request<{ id: string }>('POST', `${TODO}/tasks`, { title: 'Mixer' }))
      .body;
    const choice = { kind: 'preset', presetId: 'p1', name: 'Pomodoro 50/10' };
    const saved = await hub!.request<{ timerPref: unknown }>('PATCH', `${TODO}/tasks/${task.id}`, {
      timerPref: choice,
    });
    expect(saved.body.timerPref).toEqual(choice);
    expect(
      (await hub!.request('PATCH', `${TODO}/tasks/${task.id}`, { timerPref: 'pomodoro' })).status,
    ).toBe(400);
    const event = (
      await hub!.request<{ id: string }>('POST', `${API}/events`, {
        title: 'Cours',
        start: '2026-11-12T14:00',
        end: '2026-11-12T15:00',
      })
    ).body;
    await hub!.request('PATCH', `${API}/events/${event.id}`, { timerPref: { kind: 'block' } });
    const weekly = (
      await hub!.request<{ weekly: { id: string } }>('POST', `${API}/quick`, {
        text: 'solfège tous les jeudis 17h 1h',
      })
    ).body.weekly;
    await hub!.request('PATCH', `${API}/weekly/${weekly.id}`, { timerPref: { kind: 'pomodoro' } });
    const w = await week();
    expect(w.events.find((e) => e.id === event.id)?.timerPref).toEqual({ kind: 'block' });
    expect(w.events.find((e) => e.title === 'Solfège')?.timerPref).toEqual({ kind: 'pomodoro' });
    // Cleared.
    await hub!.request('PATCH', `${API}/events/${event.id}`, { timerPref: null });
    expect((await week()).events.find((e) => e.id === event.id)?.timerPref).toBeNull();
  });
});
