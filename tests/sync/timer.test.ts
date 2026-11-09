// The Timer on two devices (ADR 0044, v0.33.0): a session started on one
// device appears on the other after a synchronisation (same phase, same time
// left: from the real time); one timer at a time: if two run, the one
// started LAST wins, the other is stopped, listed in « Conflits » on both
// devices, and the device that showed it says so.
import { afterEach, describe, expect, it } from 'vitest';
import type { StateDto, StopNotice } from '../../modules/timer/shared/types';
import { devices, type Devices } from './harness';

const API = '/api/modules/timer';
const pomodoro = { mode: 'pomodoro', workMin: 25, breakMin: 5, longBreakMin: 15, cycles: 4 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the Timer on two devices', () => {
  let d: Devices;
  afterEach(async () => {
    await d?.close();
  });

  const state = (device: 'pc' | 'phone') =>
    device === 'pc'
      ? d.onPc<StateDto>('GET', `${API}/state`)
      : d.onPhone<StateDto>('GET', `${API}/state`);
  const notice = async (device: 'pc' | 'phone') =>
    (
      await (device === 'pc'
        ? d.onPc<{ notice: StopNotice | null }>('GET', `${API}/notice`)
        : d.onPhone<{ notice: StopNotice | null }>('GET', `${API}/notice`))
    ).notice;
  const conflicts = (device: 'pc' | 'phone') =>
    (device === 'pc' ? d.pcEngine : d.phoneEngine).conflicts().filter((c) => c.scope === 'timer');

  it('a session started on the PC appears on the phone: same phase, same time left', async () => {
    d = await devices();
    d.first('replace');
    await d.onPc('POST', `${API}/start`, { config: pomodoro, name: 'Révisions' });
    await d.onPc('POST', `${API}/extend`, { minutes: 5 });
    // Time passes on the PC before the synchronisation: the phone counts it too.
    await wait(400);
    d.exchange();
    const pc = (await state('pc')).session!;
    const phone = (await state('phone')).session!;
    expect(phone.id).toBe(pc.id);
    expect(phone.status).toBe('running');
    expect(phone.name).toBe('Révisions');
    expect(phone.phases).toEqual(pc.phases);
    // Same elapsed time (a few milliseconds apart: the two answers are not simultaneous).
    expect(Math.abs(phone.elapsed - pc.elapsed)).toBeLessThan(0.2);
    expect(phone.elapsed).toBeGreaterThan(0.39);
    expect(phone.phases[0]!.seconds).toBe(30 * 60); // « +5 min » travelled too.
    // Paused on the phone → paused on the PC, time frozen.
    await d.onPhone('POST', `${API}/pause`);
    d.exchange();
    expect((await state('pc')).session!.status).toBe('paused');
    expect(conflicts('pc')).toEqual([]);
    expect(await notice('phone')).toBeNull();
  });

  it('two sessions: the one started last wins, the other is stopped, listed, and said', async () => {
    d = await devices();
    d.first('replace');
    // The phone first, the PC a bit later (between two synchronisations).
    await d.onPhone('POST', `${API}/start`, { config: pomodoro, name: 'Lecture' });
    await wait(5);
    await d.onPc('POST', `${API}/start`, { config: pomodoro, name: 'Code' });
    d.exchange();
    for (const device of ['pc', 'phone'] as const) {
      const s = await state(device);
      expect(s.session).toMatchObject({ name: 'Code', status: 'running' });
      const lecture = d.rows(device, 'timer').sessions!.find((r) => r.name === 'Lecture')!;
      expect(lecture.status).toBe('stopped');
      // Listed in « Conflits », on both devices.
      expect(conflicts(device).map((c) => c.label)).toEqual([
        'Timer « Lecture » — arrêté : « Code », lancé plus tard sur le PC, a la priorité (un seul timer à la fois)',
      ]);
    }
    // The phone showed « Lecture »: it says why it stopped. The PC shows nothing.
    expect((await notice('phone'))?.text).toMatch(
      /Ton timer « Lecture » est arrêté : « Code », lancé plus tard sur le PC, a la priorité/,
    );
    expect(await notice('pc')).toBeNull();
    // Both devices hold the same rows.
    expect(d.rows('phone', 'timer').sessions).toEqual(d.rows('pc', 'timer').sessions);
    // « OK » : the notice goes away.
    await d.onPhone('POST', `${API}/notice/dismiss`);
    expect(await notice('phone')).toBeNull();
  });

  it('the PC first, the phone later: the PC’s session is stopped, the PC says so', async () => {
    d = await devices();
    d.first('replace');
    await d.onPc('POST', `${API}/start`, { config: pomodoro, name: 'Code' });
    await wait(5);
    await d.onPhone('POST', `${API}/start`, { config: pomodoro, name: 'Sport' });
    d.exchange();
    for (const device of ['pc', 'phone'] as const)
      expect((await state(device)).session).toMatchObject({ name: 'Sport', status: 'running' });
    expect((await notice('pc'))?.text).toMatch(
      /Ton timer « Code » est arrêté : « Sport », lancé plus tard sur le téléphone/,
    );
    expect(await notice('phone')).toBeNull();
    expect(conflicts('phone')).toHaveLength(1);
    expect(d.rows('phone', 'timer').sessions).toEqual(d.rows('pc', 'timer').sessions);
    // A stop on the PC reaches the phone: no other notice there (it was not stopped by the rule).
    await d.onPc('POST', `${API}/stop`);
    d.exchange();
    expect((await state('phone')).session).toBeNull();
    expect((await notice('phone'))?.text).toBe('Ton timer « Sport » a été arrêté sur le PC.');
  });
});
