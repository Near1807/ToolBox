// Hybrid logical clock (HLC) of the synchronisation (ADR 0044): the wall
// time of the device, a counter, and the device's id. Two devices whose
// clocks differ by minutes still order their changes correctly: a device
// that receives a later HLC moves its own clock past it, so anything it
// writes afterwards is « more recent » than what it has seen.
// Written as a string that sorts like the clock:
//   000001762387200000.00003.<device id>
// Portable: no Node import (it also runs in the phone's Worker).

const WALL = 18;
const COUNT = 5;

export interface HlcParts {
  wall: number;
  count: number;
  device: string;
}

export function formatHlc(p: HlcParts): string {
  return `${String(p.wall).padStart(WALL, '0')}.${String(p.count).padStart(COUNT, '0')}.${p.device}`;
}

export function parseHlc(value: string): HlcParts | null {
  const m = /^(\d{18})\.(\d{5})\.(.+)$/.exec(value);
  if (!m) return null;
  return { wall: Number(m[1]), count: Number(m[2]), device: m[3]! };
}

/** The HLC of a change made before the synchronisation existed (from its ISO date). */
export function hlcFromIso(iso: string | null | undefined, device = '0'): string {
  const t = iso ? Date.parse(iso) : NaN;
  return formatHlc({ wall: Number.isFinite(t) ? t : 0, count: 0, device });
}

export class Hlc {
  private wall = 0;
  private count = 0;

  /**
   * @param device this device's id
   * @param now the wall clock (ms)
   * @param last the last HLC this device issued (kept in the base), so that
   *             the clock never goes back after a restart
   */
  constructor(
    readonly device: string,
    private readonly now: () => number = () => Date.now(),
    last?: string | null,
  ) {
    const p = last ? parseHlc(last) : null;
    if (p) {
      this.wall = p.wall;
      this.count = p.count;
    }
  }

  /** A new HLC for a local change: later than everything issued or received. */
  next(): string {
    const t = this.now();
    if (t > this.wall) {
      this.wall = t;
      this.count = 0;
    } else this.count += 1;
    return formatHlc({ wall: this.wall, count: this.count, device: this.device });
  }

  /** A remote HLC was received: the clock moves past it. */
  receive(remote: string): void {
    const p = parseHlc(remote);
    if (!p) return;
    const t = this.now();
    const wall = Math.max(this.wall, p.wall, t);
    if (wall === this.wall && wall === p.wall) this.count = Math.max(this.count, p.count) + 1;
    else if (wall === this.wall) this.count += 1;
    else if (wall === p.wall) this.count = p.count + 1;
    else this.count = 0;
    this.wall = wall;
  }

  /** The current position (to keep in the base). */
  current(): string {
    return formatHlc({ wall: this.wall, count: this.count, device: this.device });
  }
}
