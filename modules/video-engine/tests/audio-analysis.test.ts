import { describe, expect, it } from 'vitest';
import {
  bassAttacks,
  bassEnergyPerFrame,
  breathEnvelope,
  breathSync,
  fft,
  spectrumPerFrame,
} from '../backend/audio-analysis';

const RATE = 22050;
const FPS = 30;
const ONE_FRAME = 1 / FPS + 1e-4;

/** Deterministic pseudo-random numbers (tests must not be flaky). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Synthetic track with kicks at KNOWN times: kick = 55 Hz sine falling from
 * 110 Hz, quick decay; plus a soft pad (330 Hz) and hi-hat noise all along.
 */
function track(seconds: number, kicks: number[], next = random(7)): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    samples[i] = 0.08 * Math.sin(2 * Math.PI * 330 * t) + 0.02 * (next() * 2 - 1);
  }
  for (const kick of kicks) {
    let phase = 0;
    const from = Math.round(kick * RATE);
    for (let i = 0; i < 0.3 * RATE && from + i < samples.length; i++) {
      const t = i / RATE;
      phase += (2 * Math.PI * (55 + 55 * Math.exp(-t / 0.02))) / RATE;
      samples[from + i]! += 0.7 * Math.exp(-t / 0.09) * Math.sin(phase);
    }
  }
  return samples;
}

/** Irregular kicks (0.3 to 0.9 s apart) except a calm passage without kicks. */
function irregularKicks(seconds: number, calm: [number, number]): number[] {
  const next = random(42);
  const kicks: number[] = [];
  for (let t = 0.4; t < seconds - 0.3; t += 0.3 + 0.6 * next()) {
    if (t < calm[0] || t > calm[1]) kicks.push(Math.round(t * 1000) / 1000);
  }
  return kicks;
}

function envelopeOf(samples: Float32Array): number[] {
  const frames = Math.floor((samples.length / RATE) * FPS);
  return breathEnvelope(bassEnergyPerFrame(samples, RATE, FPS, frames), FPS);
}

describe('Reel breathing driven by the bass', () => {
  const seconds = 20;
  const calm: [number, number] = [8, 13];
  const kicks = irregularKicks(seconds, calm);
  const samples = track(seconds, kicks);
  const envelope = envelopeOf(samples);

  it('puts the peak of the scale on the frame of each known kick (≤ 1 frame)', () => {
    expect(kicks.length).toBeGreaterThan(20);
    const sync = breathSync(kicks, envelope, FPS);
    for (const { attack, peak } of sync) {
      expect(peak, `kick at ${attack} s`).not.toBeNull();
      expect(Math.abs(peak!), `kick at ${attack} s`).toBeLessThanOrEqual(ONE_FRAME);
    }
  });

  it('rises instantly on the kick and releases softly', () => {
    for (const kick of kicks.slice(0, 10)) {
      const at = Math.floor(kick * FPS);
      // Nothing moves before the kick (no anticipation beyond one frame).
      expect(envelope[at - 2]!).toBeLessThan(envelope[at]! + 1e-9);
    }
    // Release ~160 ms: after 2 frames still visible, after 10 frames nearly gone.
    const isolated = kicks.find((k, i) => (kicks[i + 1] ?? Infinity) - k > 0.6)!;
    const at = Math.floor(isolated * FPS);
    const top = Math.max(envelope[at]!, envelope[at + 1]!);
    expect(envelope[at + 3]!).toBeGreaterThan(top * 0.3);
    expect(envelope[at + 15]!).toBeLessThan(top * 0.1);
  });

  it('keeps the cover still during the calm passage', () => {
    // Envelope < 0.05 → scale < 0.1 %: invisible.
    for (let f = Math.ceil((calm[0] + 0.5) * FPS); f < calm[1] * FPS; f++) {
      expect(envelope[f]!).toBeLessThan(0.05);
    }
  });

  it('finds the kicks by itself, on time', () => {
    const found = bassAttacks(samples, RATE);
    for (const kick of kicks) {
      const nearest = Math.min(...found.map((t) => Math.abs(t - kick)));
      expect(nearest, `kick at ${kick} s`).toBeLessThan(0.015);
    }
  });

  it('barely moves without marked bass', () => {
    const quiet = track(10, []);
    expect(Math.max(...envelopeOf(quiet))).toBeLessThan(0.05);
  });
});

describe('Spectrum per frame', () => {
  it('computes an FFT', () => {
    const n = 64;
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n));
    const im = new Float64Array(n);
    fft(re, im);
    expect(re[5]).toBeCloseTo(n / 2, 6);
    expect(re[n - 5]).toBeCloseTo(n / 2, 6);
    expect(Math.abs(re[4]!)).toBeLessThan(1e-9);
  });

  it('places a tone in the right band, log scale, values 0..1', () => {
    const seconds = 2;
    const samples = new Float32Array(seconds * RATE);
    // 100 Hz for the first second, 2 kHz for the second.
    for (let i = 0; i < samples.length; i++) {
      const f = i < RATE ? 100 : 2000;
      samples[i] = 0.5 * Math.sin((2 * Math.PI * f * i) / RATE);
    }
    const frames = seconds * FPS;
    const spectrum = spectrumPerFrame(samples, RATE, FPS, frames, { bands: 24 });
    expect(spectrum).toHaveLength(frames);
    const loudest = (bands: Float32Array) => bands.indexOf(Math.max(...bands));
    // Log bands 50 Hz–8 kHz: 100 Hz → band ~3, 2 kHz → band ~17.
    expect(loudest(spectrum[15]!)).toBeGreaterThanOrEqual(2);
    expect(loudest(spectrum[15]!)).toBeLessThanOrEqual(4);
    expect(loudest(spectrum[50]!)).toBeGreaterThanOrEqual(16);
    expect(loudest(spectrum[50]!)).toBeLessThanOrEqual(18);
    for (const bands of spectrum) {
      for (const v of bands) expect(v >= 0 && v <= 1).toBe(true);
    }
  });
});
