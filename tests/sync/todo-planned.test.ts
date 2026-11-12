// The planned start and the length of a task (v0.35.0) travel like the other
// fields: changed on one device, the same on the other.
import { afterEach, describe, expect, it } from 'vitest';
import { devices, type Devices } from './harness';

const API = '/api/modules/todo';

describe('planned start of a task over the synchronisation', () => {
  let d: Devices;
  afterEach(async () => {
    await d?.close();
  });

  it('planned on the PC (a drop), moved on the phone, taken out on the PC', async () => {
    d = await devices();
    d.first('replace');
    const task = await d.onPc<{ id: string }>('POST', `${API}/tasks`, { title: 'Réviser' });
    await d.onPc('PATCH', `${API}/tasks/${task.id}`, { plannedAt: '2026-11-18T14:00' });
    d.exchange();
    const onPc = () => d.rows('pc', 'todo').tasks!.find((t) => t.id === task.id)!;
    const onPhone = () => d.rows('phone', 'todo').tasks!.find((t) => t.id === task.id)!;
    expect(onPhone()).toMatchObject({ planned_at: '2026-11-18T14:00', duration_min: 30 });
    await d.onPhone('PATCH', `${API}/tasks/${task.id}`, {
      plannedAt: '2026-11-19T09:00',
      durationMin: 90,
    });
    d.exchange();
    expect(onPc()).toMatchObject({ planned_at: '2026-11-19T09:00', duration_min: 90 });
    await d.onPc('PATCH', `${API}/tasks/${task.id}`, { plannedAt: null });
    d.exchange();
    expect(onPhone().planned_at).toBeNull();
    expect(d.rows('phone', 'todo')).toEqual(d.rows('pc', 'todo'));
  });
});
