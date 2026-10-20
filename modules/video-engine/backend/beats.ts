// Beats of an excerpt and the « breathing » of the cover on them (Reels): the
// whole cover grows by 1–2 % on the strong beats and settles back softly. Pure
// functions, unit-tested; the engine decodes the audio with FFmpeg.

const round3 = (n: number) => Number(n.toFixed(3));

export interface Onset {
  time: number;
  /** Relative strength (z-score of the energy rise). */
  strength: number;
}

/** Positive rises of a series, divided by their standard deviation. */
function normalisedRises(values: number[]): number[] {
  const rises = values.map((v, i) => (i === 0 ? 0 : Math.max(0, v - values[i - 1]!)));
  const mean = rises.reduce((a, b) => a + b, 0) / Math.max(1, rises.length);
  const std = Math.sqrt(rises.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rises.length));
  return rises.map((r) => (std > 0 ? r / std : 0));
}

/**
 * Attacks of a mono 16-bit signal: sudden rises of the energy, measured twice
 * — on the whole signal (kicks, bass notes) and on its first difference
 * (snares, hi-hats, plucks) — kept as local peaks clearly above the average.
 * Windows of 1024 samples, hop of 256.
 */
export function detectOnsets(samples: Int16Array, sampleRate: number): Onset[] {
  const hop = 256;
  const size = 1024;
  const full: number[] = [];
  const highs: number[] = [];
  for (let start = 0; start + size <= samples.length; start += hop) {
    let sum = 0;
    let diff = 0;
    for (let i = start + 1; i < start + size; i++) {
      const v = samples[i]! / 32768;
      const d = v - samples[i - 1]! / 32768;
      sum += v * v;
      diff += d * d;
    }
    full.push(Math.log10(1e-9 + sum));
    highs.push(Math.log10(1e-9 + diff));
  }
  const a = normalisedRises(full);
  const b = normalisedRises(highs);
  const flux = a.map((value, i) => value + b[i]!);
  const mean = flux.reduce((x, y) => x + y, 0) / Math.max(1, flux.length);
  const std = Math.sqrt(flux.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, flux.length));
  const onsets: Onset[] = [];
  for (let i = 1; i < flux.length; i++) {
    const value = flux[i]!;
    if (std === 0 || value <= mean + std) continue;
    let peak = true;
    for (let j = Math.max(0, i - 4); j <= Math.min(flux.length - 1, i + 4); j++) {
      if (flux[j]! > value) peak = false;
    }
    if (peak) {
      onsets.push({
        // Centre of the window plus one hop: where the rise is heard.
        time: round3((i * hop + size / 2 + hop) / sampleRate),
        strength: round3((value - mean) / std),
      });
    }
  }
  return onsets;
}

/** A soft swell of the whole cover on a strong beat. */
export interface Pulse {
  time: number;
  /** Extra scale at the top of the swell, e.g. 0.012 = +1.2 %. */
  amplitude: number;
}

/** Breathing shape: 160 ms rise (half cosine), then a slow decay (0.45 s). */
export const PULSE_RISE = 0.16;
export const PULSE_DECAY = 0.45;
/** Never more than this, even when swells overlap. */
export const PULSE_MAX = 0.015;

/**
 * Strong beats only: the clearest attacks, at least `minGap` seconds apart
 * (so the cover breathes with the groove, never trembles), scaled 1–1.5 %
 * by their strength.
 */
export function pickPulses(onsets: Onset[], duration: number, minGap = 0.42): Pulse[] {
  if (onsets.length === 0) return [];
  const sorted = [...onsets].sort((a, b) => b.strength - a.strength);
  // The top 30 % of the attacks, and clearly above the average one.
  const mean = onsets.reduce((sum, o) => sum + o.strength, 0) / onsets.length;
  const std = Math.sqrt(
    onsets.reduce((sum, o) => sum + (o.strength - mean) ** 2, 0) / onsets.length,
  );
  const threshold = Math.max(
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.3))]!.strength,
    mean + 0.5 * std,
  );
  const strongest = sorted[0]!.strength;
  const chosen: Onset[] = [];
  for (const onset of sorted) {
    if (onset.strength < threshold) break;
    if (onset.time < 0.1 || onset.time > duration - 0.3) continue;
    if (chosen.some((c) => Math.abs(c.time - onset.time) < minGap)) continue;
    chosen.push(onset);
  }
  return chosen
    .sort((a, b) => a.time - b.time)
    .map((o) => ({
      time: o.time,
      amplitude: round3(
        0.01 +
          0.005 * Math.min(1, (o.strength - threshold) / Math.max(1e-6, strongest - threshold)),
      ),
    }));
}

/**
 * FFmpeg expression (variable t) of the extra scale: sum of the swells, capped
 * at PULSE_MAX. Each swell rises with a half cosine and decays exponentially:
 * smooth, no jolt. "0" without pulses.
 */
export function pulseExpression(pulses: Pulse[]): string {
  if (pulses.length === 0) return '0';
  const terms = pulses.map(({ time, amplitude }) => {
    const x = `(t-${time})`;
    return (
      `${amplitude}*if(gte(${x},0),` +
      `if(lt(${x},${PULSE_RISE}),0.5-0.5*cos(PI*${x}/${PULSE_RISE}),` +
      `exp(-(${x}-${PULSE_RISE})/${PULSE_DECAY})),0)`
    );
  });
  return `min(${PULSE_MAX},${terms.join('+')})`;
}
