// The floating window (electron/overlay-layout.ts): what the page may ask, where it goes.
import { describe, expect, it } from 'vitest';
import {
  BOTTOM_GAP,
  MAX_HEIGHT,
  MAX_WIDTH,
  draggedPosition,
  overlayBounds,
  parseLayout,
  parsePosition,
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

describe('floating window position', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: 300, height: 60 };
  it('corners and centres, growing away from their edge', () => {
    expect(overlayBounds(area, size, { anchor: 'top-left', locked: false })).toMatchObject({
      x: BOTTOM_GAP,
      y: BOTTOM_GAP,
    });
    expect(overlayBounds(area, size, { anchor: 'top-right', locked: false })).toMatchObject({
      x: 1920 - 300 - BOTTOM_GAP,
    });
    const top = overlayBounds(
      area,
      { width: 300, height: 200 },
      { anchor: 'top-center', locked: false },
    );
    expect(top.y).toBe(BOTTOM_GAP); // the top edge stays put
    expect(overlayBounds(area, size, { anchor: 'bottom-right', locked: false })).toMatchObject({
      y: 1040 - 60 - BOTTOM_GAP,
    });
  });
  it('a dragged position is kept, and comes back on screen after a resolution change', () => {
    const dropped = draggedPosition(area, { x: 1500, y: 100, width: 300, height: 60 }, false);
    expect(dropped).toEqual({ anchor: 'custom', x: 1650, y: 100, edge: 'top', locked: false });
    expect(overlayBounds(area, size, dropped)).toEqual({ x: 1500, y: 100, width: 300, height: 60 });
    // Smaller screen: inside it.
    const small = { x: 0, y: 0, width: 1280, height: 680 };
    const b = overlayBounds(small, size, dropped);
    expect(b.x + b.width).toBeLessThanOrEqual(1280);
    const low = draggedPosition(area, { x: 100, y: 900, width: 300, height: 60 }, true);
    expect(low).toMatchObject({ edge: 'bottom', y: 960, locked: true });
    expect(overlayBounds(small, size, low).y).toBe(680 - 60);
  });
  it('a broken saved position falls back to bottom centre', () => {
    expect(parsePosition({ anchor: 'nowhere' })).toEqual({
      anchor: 'bottom-center',
      locked: false,
    });
    expect(parsePosition({ anchor: 'custom' })).toEqual({ anchor: 'bottom-center', locked: false });
    expect(parsePosition({ anchor: 'top-left', locked: true })).toEqual({
      anchor: 'top-left',
      locked: true,
    });
  });
});
