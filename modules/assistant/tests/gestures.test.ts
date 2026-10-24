// The keys of the assistant (backend/gestures.ts): microphone held or tapped,
// the bar by single or double press, and both on the same key.
import { describe, expect, it } from 'vitest';
import { conflictOf, KeyGestures, type BarMode, type KeyRole } from '../backend/gestures';

function setup(role: KeyRole, barMode: BarMode = 'double') {
  let now = 0;
  let listening = false;
  const timers: { at: number; fn: () => void }[] = [];
  const events: string[] = [];
  const keys = new KeyGestures(
    role,
    {
      micStart: () => {
        listening = true;
        events.push('mic-start');
      },
      micStop: () => {
        listening = false;
        events.push('mic-stop');
      },
      micToggle: () => events.push('mic-toggle'),
      micCancel: () => {
        listening = false;
        events.push('mic-cancel');
      },
      listening: () => listening,
      openBar: () => events.push('bar'),
    },
    {
      holdMs: 350,
      doubleMs: 400,
      barMode,
      now: () => now,
      setTimer: (fn, ms) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimer: (t) => {
        const i = timers.indexOf(t as (typeof timers)[number]);
        if (i >= 0) timers.splice(i, 1);
      },
    },
  );
  const wait = (ms: number) => {
    now += ms;
    for (const t of [...timers].filter((t) => t.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  /** A press held `ms`, then released. */
  const tap = (ms = 80) => {
    keys.press();
    wait(ms);
    keys.release();
  };
  return { keys, events, wait, tap };
}

describe('microphone key alone (as before)', () => {
  it('held = talk while held', () => {
    const { events, tap } = setup('mic');
    tap(1200);
    expect(events).toEqual(['mic-start', 'mic-stop']);
  });
  it('quick tap = until the next press', () => {
    const { events, tap, wait } = setup('mic');
    tap();
    wait(3000);
    tap();
    expect(events).toEqual(['mic-start', 'mic-toggle', 'mic-stop']);
  });
});

describe('bar key alone', () => {
  it('single press opens the bar at once', () => {
    const { events, tap } = setup('bar', 'single');
    tap();
    expect(events).toEqual(['bar']);
  });
  it('double press: two presses within the delay, not one, not two slow ones', () => {
    const { events, tap, wait } = setup('bar', 'double');
    tap();
    expect(events).toEqual([]);
    wait(1000);
    tap(); // too late: a new first press
    expect(events).toEqual([]);
    wait(150);
    tap();
    expect(events).toEqual(['bar']);
    // A third press right after starts over.
    wait(100);
    tap();
    expect(events).toEqual(['bar']);
  });
});

describe('same key for both', () => {
  it('double press: held = microphone, never the bar', () => {
    const { events, tap } = setup('both', 'double');
    tap(1200);
    expect(events).toEqual(['mic-start', 'mic-stop']);
  });
  it('double press: two quick presses = the bar, the first recording thrown away', () => {
    const { events, tap, wait } = setup('both', 'double');
    tap();
    wait(150);
    tap();
    expect(events).toEqual(['mic-start', 'mic-toggle', 'mic-cancel', 'bar']);
  });
  it('double press: one quick press = microphone until the next press', () => {
    const { events, tap, wait } = setup('both', 'double');
    tap();
    wait(5000); // the delay passed: it is the microphone's
    tap();
    expect(events).toEqual(['mic-start', 'mic-toggle', 'mic-stop']);
  });
  it('single press: short = bar, held = microphone', () => {
    const { events, tap, wait } = setup('both', 'single');
    tap();
    expect(events).toEqual(['mic-start', 'mic-cancel', 'bar']);
    wait(1000);
    tap(900);
    expect(events.slice(3)).toEqual(['mic-start', 'mic-stop']);
  });
  it('says in the settings when it is not reliable', () => {
    expect(conflictOf(false, 'single')).toBeNull();
    expect(conflictOf(true, 'double')).toMatchObject({ warning: false });
    expect(conflictOf(true, 'single')).toMatchObject({
      warning: true,
      text: expect.stringMatching(/Recommandé : « Double appui »/),
    });
  });
});
