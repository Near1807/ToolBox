// The floating window (electron/overlay-layout.ts): what the page may ask, where it goes.
import { describe, expect, it } from 'vitest';
import {
  BOTTOM_GAP,
  MAX_HEIGHT,
  MAX_WIDTH,
  overlayBounds,
  parseLayout,
} from '../electron/overlay-layout';

describe('floating window layout', () => {
  it('checks what the page sends', () => {
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout('x')).toBeNull();
    expect(parseLayout({ width: 300.2, height: 80, interactive: true, focus: 'yes' })).toEqual({
      width: 301,
      height: 80,
      interactive: true,
      focus: false,
    });
    // Never larger than the limits, never negative.
    expect(parseLayout({ width: 1e9, height: -5 })).toMatchObject({
      width: MAX_WIDTH,
      height: 0,
    });
    expect(parseLayout({ width: Number.NaN, height: Infinity })).toMatchObject({
      width: 0,
      height: 0,
    });
  });

  it('bottom centre of the work area, growing upwards', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 };
    const one = overlayBounds(area, { width: 300, height: 60 });
    expect(one).toEqual({ x: 810, y: 1040 - 60 - BOTTOM_GAP, width: 300, height: 60 });
    // Two panels stacked: same bottom edge, taller.
    const two = overlayBounds(area, { width: 300, height: 130 });
    expect(two.y + two.height).toBe(one.y + one.height);
    // Second screen on the left, empty content (1 × 1).
    expect(
      overlayBounds({ x: -1280, y: 0, width: 1280, height: 984 }, { width: 0, height: 0 }),
    ).toEqual({ x: -640, y: 984 - 1 - BOTTOM_GAP, width: 1, height: 1 });
    expect(MAX_HEIGHT).toBeGreaterThan(300);
  });
});
