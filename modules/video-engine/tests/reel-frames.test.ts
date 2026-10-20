import { describe, expect, it } from 'vitest';
import {
  bandAt,
  coverScale,
  coverSize,
  lightTone,
  outlinePoints,
  REEL_LAYOUT,
} from '../backend/reel-frames';

describe('Reel frames', () => {
  it('keeps the ratio of the cover inside its box', () => {
    expect(coverSize(1, 660)).toEqual({ width: 660, height: 660 });
    expect(coverSize(2, 660)).toEqual({ width: 660, height: 330 });
    expect(coverSize(0.75, 660)).toEqual({ width: 495, height: 660 });
  });

  it('scales the cover: slow zoom × breathing (≤ 2 %)', () => {
    expect(coverScale(0, 840, 0)).toBe(1);
    expect(coverScale(839, 840, 0)).toBeCloseTo(1 + REEL_LAYOUT.zoom, 9);
    expect(coverScale(0, 840, 1)).toBeCloseTo(1 + REEL_LAYOUT.breath, 9);
    expect(REEL_LAYOUT.breath).toBeLessThanOrEqual(0.02);
    expect(REEL_LAYOUT.breath).toBeGreaterThanOrEqual(0.015);
  });

  it('spreads points around the rounded cover, outward, mirrored left/right', () => {
    const [cx, cy, w, h, r] = [540, 800, 600, 400, 28];
    const points = outlinePoints(cx, cy, w, h, r, 200);
    expect(points).toHaveLength(200);
    for (const p of points) {
      expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1, 9);
      // Outward: the normal points away from the centre.
      expect((p.x - cx) * p.nx + (p.y - cy) * p.ny).toBeGreaterThan(0);
      // On the outline (inside the bounding box, on its edge or in a corner).
      expect(Math.abs(p.x - cx)).toBeLessThanOrEqual(w / 2 + 1e-9);
      expect(Math.abs(p.y - cy)).toBeLessThanOrEqual(h / 2 + 1e-9);
    }
    // Starts at the bottom (bass), reaches the top (treble) halfway.
    expect(points[0]!.u).toBeLessThan(0.01);
    expect(points[0]!.y).toBeCloseTo(cy + h / 2, 9);
    expect(points[100]!.u).toBeGreaterThan(0.99);
    expect(points[100]!.y).toBeLessThan(cy - h / 2 + r);
    // Mirror: point i and point count-1-i are symmetric, same u.
    for (let i = 0; i < 100; i++) {
      const a = points[i]!;
      const b = points[199 - i]!;
      expect(a.x + b.x).toBeCloseTo(2 * cx, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
      expect(a.u).toBeCloseTo(b.u, 9);
    }
  });

  it('reads the spectrum along the outline (bass at the bottom)', () => {
    const spectrum = Float32Array.from([1, 0.5, 0]);
    expect(bandAt(spectrum, 0)).toBe(1);
    expect(bandAt(spectrum, 0.25)).toBeCloseTo(0.75, 6);
    expect(bandAt(spectrum, 1)).toBe(0);
    expect(bandAt(spectrum, 2)).toBe(0);
  });

  it('takes a light colour from the cover', () => {
    expect(lightTone([0, 0, 0])).toBe('rgb(153, 153, 153)');
    expect(lightTone([255, 255, 255])).toBe('rgb(255, 255, 255)');
  });

  it('stays inside the Instagram safe zones, even at full zoom and breath', () => {
    const L = REEL_LAYOUT;
    const scale = coverScale(1, 2, 1);
    const half = (L.cover.size * scale) / 2;
    const reach = half + L.bars.gap + L.bars.maxLength * L.cover.size * scale;
    expect(L.width / 2 + reach).toBeLessThanOrEqual(L.width - L.safe.right);
    expect(L.cover.centerY - reach).toBeGreaterThanOrEqual(L.safe.top);
    // Bars stay above the title (title.top = top of its text).
    expect(L.cover.centerY + reach).toBeLessThan(L.title.top - 40);
    expect(L.artist.top + L.artist.fontSize).toBeLessThanOrEqual(L.height - L.safe.bottom);
  });
});
