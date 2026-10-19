import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, type TestHub } from '@hub/sdk/testing';
import {
  isDue,
  nextRunAfter,
  RETRY_DELAY_MS,
  validateScheduleSpec,
} from '../../backend/core/scheduler';
import { fakeModule } from '../helpers/fake-modules';

// Local-time dates, so the tests pass in any time zone.
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes);

describe('schedule rules', () => {
  it('computes the next daily run in local time', () => {
    expect(nextRunAfter({ daily: '08:00' }, at(19, 7, 30))).toEqual(at(19, 8));
    expect(nextRunAfter({ daily: '08:00' }, at(19, 8))).toEqual(at(20, 8));
    expect(nextRunAfter({ daily: '08:00' }, at(19, 22))).toEqual(at(20, 8));
  });

  it('computes interval runs', () => {
    expect(nextRunAfter({ everyMinutes: 30 }, at(19, 8))).toEqual(at(19, 8, 30));
  });

  it('runs a task that never ran', () => {
    expect(isDue({ daily: '08:00' }, { lastSuccessAt: null, lastAttemptAt: null }, at(19, 3))).toBe(
      true,
    );
  });

  it('catches up a run missed while the app was closed', () => {
    // Last success on the 17th; the app was closed on the 18th at 08:00.
    const state = { lastSuccessAt: at(17, 8, 5), lastAttemptAt: at(17, 8, 5) };
    expect(isDue({ daily: '08:00' }, state, at(19, 7))).toBe(true);
  });

  it('does not run twice the same day', () => {
    const state = { lastSuccessAt: at(19, 8, 1), lastAttemptAt: at(19, 8, 1) };
    expect(isDue({ daily: '08:00' }, state, at(19, 23))).toBe(false);
  });

  it('waits before retrying a failed run', () => {
    const failedAt = at(19, 8);
    const state = { lastSuccessAt: at(18, 8), lastAttemptAt: failedAt };
    expect(isDue({ daily: '08:00' }, state, new Date(failedAt.getTime() + 60_000))).toBe(false);
    expect(isDue({ daily: '08:00' }, state, new Date(failedAt.getTime() + RETRY_DELAY_MS))).toBe(
      true,
    );
  });

  it('validates specs', () => {
    expect(() => validateScheduleSpec({ daily: '25:00' })).toThrow(/HH:MM/);
    expect(() => validateScheduleSpec({ everyMinutes: 0 })).toThrow();
  });
});

describe('scheduler', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub.close();
  });

  it('catches up at startup and records the run', async () => {
    const runs: (Date | null)[] = [];
    hub = await createTestHub({
      modules: [
        fakeModule('stats', {
          backend: {
            register: (ctx) =>
              ctx.scheduler.schedule('snapshot', { daily: '08:00' }, async (task) => {
                runs.push(task.lastSuccessAt);
              }),
          },
        }),
      ],
    });
    await hub.hub.scheduler.tick(); // the startup catch-up may still be in flight
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runs).toEqual([null]);
    const row = hub.hub.handle.db.prepare('SELECT last_success_at FROM core__schedules').get() as {
      last_success_at: string;
    };
    expect(row.last_success_at).toBeTruthy();
  });
});
