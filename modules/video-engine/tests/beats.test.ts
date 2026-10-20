import { describe, expect, it } from 'vitest';
import {
  detectOnsets,
  pickPulses,
  PULSE_DECAY,
  PULSE_MAX,
  PULSE_RISE,
  pulseExpression,
} from '../backend/beats';

/** Mono signal with short clicks (attacks) at the given times, over a quiet tone. */
function clicks(times: number[], duration: number, rate = 11025): Int16Array {
  const samples = new Int16Array(Math.round(duration * rate));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(800 * Math.sin(i / 20));
  for (const t of times) {
    const start = Math.round(t * rate);
    for (let i = 0; i < 400 && start + i < samples.length; i++) {
      samples[start + i] = Math.round(20000 * Math.exp(-i / 80) * (i % 2 ? 1 : -1));
    }
  }
  return samples;
}

/** Evaluates pulseExpression() in JS, to check its shape. */
function evaluate(expression: string, t: number): number {
  const js = expression
    .replace(/\bPI\b/g, 'Math.PI')
    .replace(/\b(min|exp|cos)\(/g, 'Math.$1(')
    .replace(/\bif\(/g, 'iff(')
    .replace(/\bgte\(/g, 'gte(')
    .replace(/\blt\(/g, 'lt(');
  const fn = new Function('t', 'iff', 'gte', 'lt', `return ${js};`) as (
    t: number,
    ...h: ((...a: number[]) => number)[]
  ) => number;
  return fn(
    t,
    (c, a, b) => (c ? a! : b!),
    (a, b) => (a! >= b! ? 1 : 0),
    (a, b) => (a! < b! ? 1 : 0),
  );
}

describe('beats', () => {
  it('finds the attacks within a frame', () => {
    const times = [1, 2, 3.5, 5];
    const onsets = detectOnsets(clicks(times, 6), 11025);
    for (const t of times) {
      expect(onsets.some((o) => Math.abs(o.time - t) < 1 / 30)).toBe(true);
    }
  });

  it('keeps only strong beats, spaced, with 1 to 1.5 % of scale', () => {
    const onsets = Array.from({ length: 56 }, (_, i) => ({
      time: i * 0.25,
      strength: i % 4 === 0 ? 5 : 1,
    }));
    const pulses = pickPulses(onsets, 14);
    expect(pulses.length).toBeGreaterThan(5);
    for (const p of pulses) {
      expect(p.time % 1).toBe(0); // the strong beats only
      expect(p.amplitude).toBeGreaterThanOrEqual(0.01);
      expect(p.amplitude).toBeLessThanOrEqual(0.015);
    }
    for (let i = 1; i < pulses.length; i++) {
      expect(pulses[i]!.time - pulses[i - 1]!.time).toBeGreaterThanOrEqual(0.42);
    }
    expect(pickPulses([], 10)).toEqual([]);
  });

  it('breathes smoothly: soft rise, slow decay, never above the cap', () => {
    const expression = pulseExpression([
      { time: 1, amplitude: 0.015 },
      { time: 1.3, amplitude: 0.015 },
    ]);
    expect(evaluate(expression, 0.5)).toBe(0);
    expect(evaluate(expression, 1)).toBeCloseTo(0, 5);
    expect(evaluate(expression, 1 + PULSE_RISE)).toBeCloseTo(0.015, 3);
    // Two close swells add up, but stay capped.
    expect(evaluate(expression, 1.3 + PULSE_RISE)).toBeLessThanOrEqual(PULSE_MAX);
    // About a third left after one decay time: a soft return, no jolt.
    const later = evaluate(expression, 1.3 + PULSE_RISE + PULSE_DECAY);
    expect(later).toBeLessThan(0.011);
    expect(later).toBeGreaterThan(0.003);
    // Continuous: no step between two frames.
    for (let t = 0.9; t < 3; t += 1 / 30) {
      expect(Math.abs(evaluate(expression, t + 1 / 30) - evaluate(expression, t))).toBeLessThan(
        0.006,
      );
    }
    expect(pulseExpression([])).toBe('0');
  });
});
