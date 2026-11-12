// The plan of the phone's ongoing notification (ADR 0044, v0.33.0): computed
// from the Timer's server answers, with the server's texts; at start, pause,
// resume and « +5 min » a new plan; stopped or ended: none.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { ongoingLabel, ongoingPlan } from '../shared/notices';
import { PHASE_LABELS } from '../shared/plan';
import type { SessionDto, StateDto } from '../shared/types';

const API = '/api/modules/timer';
const pomodoro = { mode: 'pomodoro', workMin: 25, breakMin: 5, cycles: 3 };

describe('the plan of the ongoing notification', () => {
  let hub: TestHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
  });
  const open = async () => {
    hub = await createTestHub({
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    return hub;
  };
  const session = async () => (await hub!.request<StateDto>('GET', `${API}/state`)).body.session;

  it('start: every phase still to come, with the server’s labels and real end times', async () => {
    await open();
    const before = Date.now();
    await hub!.request('POST', `${API}/start`, { config: pomodoro, name: 'Révisions' });
    const s = (await session())!;
    const plan = ongoingPlan(s, Date.now())!;
    expect(plan).toMatchObject({ sessionId: s.id, name: 'Révisions', status: 'running' });
    expect(plan.steps.map((x) => x.label)).toEqual([
      'Travail · cycle 1 sur 3',
      'Pause',
      'Travail · cycle 2 sur 3',
      'Pause',
      'Travail · cycle 3 sur 3',
    ]);
    // The labels are the server's (the same words as its notices).
    expect(plan.steps[1]!.label).toBe(PHASE_LABELS.break);
    const ends = plan.steps.map((x) => x.endsAt);
    expect(ends[0]! - before).toBeGreaterThan(25 * 60_000 - 2000);
    expect(ends[0]! - before).toBeLessThan(25 * 60_000 + 2000);
    expect(ends[1]! - ends[0]!).toBe(5 * 60_000);
    expect(ends.at(-1)! - ends[0]!).toBe((5 + 25 + 5 + 25) * 60_000);
  });

  it('pause: frozen; resume: new ends; « +5 min »: the phase longer; stop: nothing', async () => {
    await open();
    await hub!.request('POST', `${API}/start`, { config: pomodoro });
    const first = ongoingPlan((await session())!, Date.now())!;
    await hub!.request('POST', `${API}/pause`);
    const paused = ongoingPlan((await session())!, Date.now())!;
    expect(paused).toMatchObject({ status: 'paused', label: 'Travail · cycle 1 sur 3', steps: [] });
    expect(paused.remaining).toBeGreaterThan(25 * 60 - 3);
    // Frozen: the same an hour later.
    expect(ongoingPlan((await session())!, Date.now() + 3_600_000)!.remaining).toBe(
      paused.remaining,
    );
    await new Promise((r) => setTimeout(r, 50));
    await hub!.request('POST', `${API}/resume`);
    const resumed = ongoingPlan((await session())!, Date.now())!;
    expect(resumed.status).toBe('running');
    expect(resumed.steps[0]!.endsAt).toBeGreaterThan(first.steps[0]!.endsAt);
    await hub!.request('POST', `${API}/extend`, { minutes: 5 });
    const longer = ongoingPlan((await session())!, Date.now())!;
    expect(longer.steps[0]!.endsAt - resumed.steps[0]!.endsAt).toBeGreaterThan(5 * 60_000 - 100);
    expect(longer.steps[0]!.endsAt - resumed.steps[0]!.endsAt).toBeLessThan(5 * 60_000 + 100);
    await hub!.request('POST', `${API}/stop`);
    expect(ongoingPlan(await session(), Date.now())).toBeNull();
  });

  it('ended, or past the last phase: nothing; a simple timer is « Timer »', async () => {
    const s: SessionDto = {
      id: 'x',
      mode: 'simple',
      name: 'Timer 10 min',
      config: { mode: 'simple', workMin: 10 },
      phases: [{ kind: 'work', seconds: 600, cycle: 1 }],
      status: 'running',
      taskId: null,
      taskTitle: null,
      startedAt: new Date().toISOString(),
      elapsed: 0,
      at: new Date().toISOString(),
    };
    expect(ongoingPlan(s, Date.parse(s.at))!.steps.map((x) => x.label)).toEqual(['Timer']);
    expect(ongoingPlan(s, Date.parse(s.at) + 601_000)).toBeNull();
    expect(ongoingPlan({ ...s, status: 'ended' }, Date.now())).toBeNull();
    expect(ongoingLabel(s.phases, 1, 'simple')).toBe('Terminé');
  });
});
