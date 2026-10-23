import { describe, expect, it } from 'vitest';
import {
  anomalies,
  atAge,
  bootstrapDiff,
  byAge,
  confidence,
  evergreen,
  halfLife,
  holm,
  laggedCorrelation,
  mannWhitney,
  median,
  ranks,
  rng,
  spearman,
} from '../backend/stats';

describe('small-sample statistics', () => {
  it('ranks ties with their mean rank', () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });

  it('Mann-Whitney: clear separation is significant, overlap is not', () => {
    const separated = mannWhitney([6, 7, 8, 9, 10], [1, 2, 3, 4, 5]);
    expect(separated.r).toBe(1);
    expect(separated.p).toBeLessThan(0.02); // exact value 0.0079, normal approximation ≈ 0.012
    const mixed = mannWhitney([1, 3, 5, 7, 9], [2, 4, 6, 8, 10]);
    expect(mixed.p).toBeGreaterThan(0.5);
  });

  it('Spearman: monotonic relation found, noise not', () => {
    const x = Array.from({ length: 12 }, (_, i) => i);
    const strong = spearman(
      x,
      x.map((v) => v * v + 3),
    );
    expect(strong.rho).toBeCloseTo(1, 6);
    expect(strong.p).toBeLessThan(0.01);
    const random = rng(4);
    const noise = spearman(
      x,
      x.map(() => random()),
    );
    expect(noise.p).toBeGreaterThan(0.05);
  });

  it('bootstrap interval of the difference of medians covers the true difference', () => {
    const random = rng(9);
    const a = Array.from({ length: 30 }, () => 10 + random() * 4);
    const b = Array.from({ length: 30 }, () => 5 + random() * 4);
    const diff = bootstrapDiff(a, b)!;
    expect(diff.ci95[0]).toBeLessThan(5.5);
    expect(diff.ci95[1]).toBeGreaterThan(4.5);
    expect(diff.ci80[0]).toBeGreaterThanOrEqual(diff.ci95[0]);
    expect(bootstrapDiff([1], [2])).toBeNull();
  });

  it('Holm correction keeps the order and is never below the raw p', () => {
    const adjusted = holm([0.01, 0.04, 0.03]);
    expect(adjusted).toEqual([0.03, 0.06, 0.06]);
  });

  it('three confidence tiers, with the reason', () => {
    expect(confidence({ n: [3, 20], p: 0.001, ci: [1, 2], strong: true }).tier).toBe('intuition');
    const solid = confidence({ n: [10, 12], p: 0.01, ci: [0.2, 0.9], strong: true });
    expect(solid.tier).toBe('solide');
    expect(solid.reason).toContain('10+ vidéos de chaque côté');
    expect(confidence({ n: [10, 12], p: 0.01, ci: [-0.1, 0.9], strong: true }).tier).toBe('piste');
    expect(confidence({ n: [5, 6], p: 0.03, ci: [0.1, 0.5], strong: true }).reason).toContain(
      'encore peu',
    );
    expect(confidence({ n: [10, 10], p: 0.6, ci: null, strong: false }).tier).toBe('intuition');
    // Ratios: no effect = 1.
    expect(confidence({ n: [9, 9], p: 0.01, ci: [1.1, 2], nullValue: 1, strong: true }).tier).toBe(
      'solide',
    );
  });
});

describe('life of a video', () => {
  it('views by age, median at an age, half-life', () => {
    const series = byAge(
      [
        { day: '2026-01-01', value: 50 },
        { day: '2026-01-02', value: 30 },
        { day: '2026-01-05', value: 20 },
      ],
      '2026-01-01',
      '2026-01-20',
    );
    expect(series.slice(0, 5)).toEqual([50, 30, 0, 0, 20]);
    expect(atAge(series, 1)).toBe(80);
    expect(atAge(series, 30)).toBeNull();
    expect(halfLife(series)).toBe(0); // half of 100 on day 0
    expect(halfLife(series.slice(0, 5))).toBeNull(); // too young
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });

  it('evergreen: still alive after two months', () => {
    const alive = Array.from({ length: 90 }, (_, i) => (i < 28 ? 20 : 8));
    const dead = Array.from({ length: 90 }, (_, i) => (i < 28 ? 20 : 0));
    expect(evergreen(alive).evergreen).toBe(true);
    expect(evergreen(dead).evergreen).toBe(false);
    expect(evergreen(alive.slice(0, 40)).ratio).toBeNull();
  });

  it('flags an unusual day, not the normal noise', () => {
    const random = rng(2);
    const series = Array.from({ length: 60 }, () => 40 + Math.round(random() * 10));
    series[45] = 400;
    const found = anomalies(series);
    expect(found.map((a) => a.index)).toEqual([45]);
    expect(found[0]!.kind).toBe('spike');
  });

  it('finds that the long video follows the Shorts two days later', () => {
    const random = rng(3);
    const shorts = Array.from({ length: 80 }, () => 20 + random() * 200);
    const long = shorts.map((_, i) => 30 + (i >= 2 ? shorts[i - 2]! * 0.5 : 0) + random() * 10);
    const result = laggedCorrelation(shorts, long, 7)!;
    expect(result.best.lag).toBe(2);
    expect(result.p).toBeLessThan(0.05);
    const unrelated = laggedCorrelation(
      shorts,
      shorts.map(() => 50 + random() * 50),
      7,
    )!;
    expect(unrelated.p).toBeGreaterThan(0.05);
    expect(laggedCorrelation([1, 2, 3], [1, 2, 3], 7)).toBeNull();
  });
});
