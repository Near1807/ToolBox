// The To-do's estimated duration (v0.34.0) travels like the other fields:
// a column of a synchronised table, written through SyncStore.
import { afterEach, describe, expect, it } from 'vitest';
import { devices, type Devices } from './harness';

const API = '/api/modules/todo';

describe('estimated duration of a task over the synchronisation', () => {
  let d: Devices;
  afterEach(async () => {
    await d?.close();
  });

  it('given on the phone, changed on the PC, cleared on the phone: the same on both', async () => {
    d = await devices();
    d.first('replace');
    const task = await d.onPhone<{ id: string }>('POST', `${API}/tasks`, {
      title: 'Réviser',
      durationMin: '~2h',
    });
    d.exchange();
    const onPc = () => d.rows('pc', 'todo').tasks!.find((t) => t.id === task.id)!;
    const onPhone = () => d.rows('phone', 'todo').tasks!.find((t) => t.id === task.id)!;
    expect(onPc().duration_min).toBe(120);
    await d.onPc('PATCH', `${API}/tasks/${task.id}`, { durationMin: 45 });
    d.exchange();
    expect(onPhone().duration_min).toBe(45);
    await d.onPhone('PATCH', `${API}/tasks/${task.id}`, { durationMin: null });
    d.exchange();
    expect(onPc().duration_min).toBeNull();
    expect(d.rows('phone', 'todo')).toEqual(d.rows('pc', 'todo'));
  });
});
