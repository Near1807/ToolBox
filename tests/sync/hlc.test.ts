// The hybrid logical clock: always increasing, and past anything received,
// even when the wall clocks of two devices differ by minutes.
import { describe, expect, it } from 'vitest';
import { formatHlc, Hlc, hlcFromIso, parseHlc } from '../../backend/core/sync/hlc';

describe('HLC', () => {
  it('sorts like the clock, as a string', () => {
    const a = formatHlc({ wall: 1000, count: 2, device: 'pc' });
    const b = formatHlc({ wall: 1000, count: 10, device: 'pc' });
    const c = formatHlc({ wall: 2000, count: 0, device: 'pc' });
    expect([c, b, a].sort()).toEqual([a, b, c]);
    expect(parseHlc(b)).toEqual({ wall: 1000, count: 10, device: 'pc' });
    expect(hlcFromIso('1970-01-01T00:00:01.000Z', 'x')).toBe(
      formatHlc({ wall: 1000, count: 0, device: 'x' }),
    );
  });

  it('never goes back: same millisecond → counter; clock set back → still later', () => {
    let now = 5000;
    const h = new Hlc('a', () => now);
    const one = h.next();
    const two = h.next();
    now = 1000; // The clock was set back.
    const three = h.next();
    expect(one < two && two < three).toBe(true);
    // Restart: the last HLC kept in the base is the floor.
    const again = new Hlc('a', () => 10, three);
    expect(again.next() > three).toBe(true);
  });

  it('a device 10 minutes late writes after what it received', () => {
    const pc = new Hlc('pc', () => 1_000_000);
    const phone = new Hlc('phone', () => 1_000_000 - 600_000);
    const fromPc = pc.next();
    phone.receive(fromPc);
    expect(phone.next() > fromPc).toBe(true);
  });
});
