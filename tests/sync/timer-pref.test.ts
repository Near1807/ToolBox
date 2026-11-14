// The associated timer (v0.36.0) travels like the other fields: on a task
// (To-do) and on an event (Agenda).
import { afterEach, describe, expect, it } from 'vitest';
import { devices, type Devices } from './harness';

describe('associated timer over the synchronisation', () => {
  let d: Devices;
  afterEach(async () => {
    await d?.close();
  });

  it('set on the PC, changed on the phone: the same on both', async () => {
    d = await devices();
    d.first('replace');
    const task = await d.onPc<{ id: string }>('POST', '/api/modules/todo/tasks', {
      title: 'Mixer',
    });
    await d.onPc('PATCH', `/api/modules/todo/tasks/${task.id}`, {
      timerPref: { kind: 'pomodoro' },
    });
    const event = await d.onPc<{ id: string }>('POST', '/api/modules/agenda/events', {
      title: 'Cours',
      start: '2026-11-12T14:00',
      end: '2026-11-12T15:00',
    });
    await d.onPc('PATCH', `/api/modules/agenda/events/${event.id}`, {
      timerPref: { kind: 'block' },
    });
    d.exchange();
    const onPhone = d.rows('phone', 'todo').tasks!.find((t) => t.id === task.id)!;
    expect(JSON.parse(String(onPhone.timer_pref))).toEqual({ kind: 'pomodoro' });
    await d.onPhone('PATCH', `/api/modules/agenda/events/${event.id}`, { timerPref: null });
    d.exchange();
    expect(d.rows('pc', 'agenda').events!.find((e) => e.id === event.id)!.timer_pref).toBeNull();
    expect(d.rows('phone', 'todo')).toEqual(d.rows('pc', 'todo'));
    expect(d.rows('phone', 'agenda')).toEqual(d.rows('pc', 'agenda'));
  });
});
