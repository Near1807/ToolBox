// Audio analysis of a Reel excerpt, frame by frame (30 fps), in plain JS:
// - the bass energy that drives the « breathing » of the cover, read directly
//   from the sound at the exact time of each frame (no detected events);
// - a logarithmic spectrum per frame for the visualisation around the cover.
// Pure functions, unit-tested; the engine decodes the audio with FFmpeg.

/** Second-order (biquad) filter coefficients, RBJ cookbook, Butterworth Q. */
function biquad(type: 'lowpass' | 'highpass', frequency: number, rate: number) {
  const w0 = (2 * Math.PI * frequency) / rate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b =
    type === 'lowpass'
      ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
      : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  return {
    b0: b[0]! / a0,
    b1: b[1]! / a0,
    b2: b[2]! / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function filter(input: Float32Array, c: ReturnType<typeof biquad>): Float32Array {
  const output = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    output[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return output;
}

/** The kick band: 40–150 Hz (two cascaded Butterworth sections each side). */
export const BASS_BAND = { low: 40, high: 150 };

/** Window of the bass power: one period of 40 Hz. */
export const BASS_WINDOW = 0.025;

/** Onset threshold of an attack: part of the way from the low to the peak. */
export const ATTACK_FRACTION = 0.3;

/** The peak that defines an attack is the one reached within this time (ms). */
export const ATTACK_WINDOW_MS = 40;

/** Longest bass event after an attack (ms): its peak is shown on the attack's frame. */
export const EVENT_MS = 150;

/** Lead of the detected attacks on the real ones (ms), compensated when placing the peak. */
export const ONSET_LEAD_MS = 3;

/**
 * Power of the kick band (40–150 Hz), one value per millisecond: band-pass
 * (two Butterworth sections each side), then mean square over 25 ms, centred.
 */
export function bassPower(samples: Float32Array, rate: number): number[] {
  let band = samples;
  for (const section of [
    biquad('highpass', BASS_BAND.low, rate),
    biquad('highpass', BASS_BAND.low, rate),
    biquad('lowpass', BASS_BAND.high, rate),
    biquad('lowpass', BASS_BAND.high, rate),
  ]) {
    band = filter(band, section);
  }
  const step = rate / 1000;
  // One full period of the lowest frequency (25 ms at 40 Hz): a shorter window
  // would make the power of a bass note oscillate at twice its frequency.
  const half = Math.max(1, Math.round((rate * BASS_WINDOW) / 2));
  const squares = new Float64Array(band.length + 1);
  for (let i = 0; i < band.length; i++) squares[i + 1] = squares[i]! + band[i]! * band[i]!;
  const power: number[] = [];
  for (let ms = 0; ms * step < band.length; ms++) {
    const center = Math.round(ms * step);
    const from = Math.max(0, center - half);
    const to = Math.min(band.length, center + half);
    power.push((squares[to]! - squares[from]!) / Math.max(1, to - from));
  }
  return power;
}

/**
 * Bass energy shown by each video frame: the strongest bass power within the
 * time slot the frame stands for (from its exact time to the next frame) and,
 * when a bass attack falls in that slot, the peak of that whole bass event.
 * The render is offline, so the coming milliseconds are known: the cover is
 * at its biggest on the very frame of the attack — never a frame late — even
 * when a bass note keeps swelling after its attack.
 */
export function bassEnergyPerFrame(
  samples: Float32Array,
  rate: number,
  fps: number,
  frames: number,
): number[] {
  const power = bassPower(samples, rate);
  const events = bassEvents(power);
  const slotMs = 1000 / fps;
  const energy = Array.from({ length: frames }, (_, i) => {
    const from = Math.min(power.length - 1, Math.round(i * slotMs));
    const to = Math.min(power.length - 1, Math.round((i + 1) * slotMs) - 1);
    let max = 0;
    for (let j = from; j <= to; j++) if (power[j]! > max) max = power[j]!;
    return max;
  });
  for (const event of events) {
    // The smoothing (25 ms) makes the detected attack lead the real one by
    // 0–4 ms (measured on kicks at known times, 3.5 ms on average): compensated by 3 ms.
    const frame = Math.floor((event.attack + ONSET_LEAD_MS / 1000) * fps + 1e-9);
    if (frame < frames) energy[frame] = Math.max(energy[frame]!, event.peak);
  }
  return energy;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/**
 * Bass power (band-passed, mean square, full scale = 1) of a clearly marked
 * kick in a mastered track. Excerpts whose bass stays well below it barely
 * move: an excerpt without marked bass must not be « boosted » into motion.
 */
export const BASS_REFERENCE = 0.02;

/** Release of the breathing (s): soft, but each kick stays readable. */
export const BREATH_RELEASE = 0.16;

/**
 * Breathing envelope 0..1 from the bass energy: normalised on the excerpt
 * (between its quiet level and its loud kicks, never above the absolute
 * reference), curved so that small values barely count, then with an
 * INSTANT attack (the peak is on the frame of the kick) and a soft release.
 */
export function breathEnvelope(
  energy: number[],
  fps: number,
  options: { releaseSec?: number; reference?: number } = {},
): number[] {
  const floor = percentile(energy, 0.3);
  // The loud kicks (98th percentile) reach the full amplitude; below, less.
  const top = Math.max(percentile(energy, 0.98), options.reference ?? BASS_REFERENCE);
  const range = Math.max(1e-12, top - floor);
  const decay = Math.exp(-1 / (fps * (options.releaseSec ?? BREATH_RELEASE)));
  const envelope: number[] = [];
  let previous = 0;
  for (const value of energy) {
    const level = Math.min(1, Math.max(0, (value - floor) / range)) ** 1.5;
    previous = Math.max(level, previous * decay);
    envelope.push(previous);
  }
  return envelope;
}

/** In-place iterative radix-2 FFT (re, im of length 2^n). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

export interface SpectrumOptions {
  bands: number;
  /** Lowest and highest frequencies, Hz (logarithmic scale between them). */
  minFrequency?: number;
  maxFrequency?: number;
  /** Dynamic range shown, dB below the loudest moments of the excerpt. */
  rangeDb?: number;
}

/**
 * Logarithmic spectrum per video frame, values 0..1: FFT (Hann window of
 * 2048 samples centred on the frame's time), energy summed in log-spaced
 * bands (50 Hz–8 kHz), treble tilted +3 dB/octave above 120 Hz (music carries
 * far more energy in the bass), in dB relative to the loud moments of the
 * excerpt, and smoothed in time (quick rise, slow fall).
 */
export function spectrumPerFrame(
  samples: Float32Array,
  rate: number,
  fps: number,
  frames: number,
  options: SpectrumOptions,
): Float32Array[] {
  const size = 2048;
  const { bands } = options;
  const minF = options.minFrequency ?? 50;
  const maxF = Math.min(options.maxFrequency ?? 8000, rate / 2);
  const range = options.rangeDb ?? 36;
  const window = Float64Array.from(
    { length: size },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)),
  );
  const edges = Array.from({ length: bands + 1 }, (_, b) => minF * (maxF / minF) ** (b / bands));
  const binOf = (f: number) => Math.max(1, Math.min(size / 2 - 1, Math.round((f * size) / rate)));
  const tilt = edges.slice(0, bands).map((low, b) => {
    const centre = Math.sqrt(low * edges[b + 1]!);
    return Math.min(12, Math.max(0, 3 * Math.log2(centre / 120)));
  });

  const raw: Float32Array[] = [];
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    const centre = Math.round((f * rate) / fps);
    for (let i = 0; i < size; i++) {
      const index = centre - size / 2 + i;
      re[i] = index >= 0 && index < samples.length ? samples[index]! * window[i]! : 0;
      im[i] = 0;
    }
    fft(re, im);
    const values = new Float32Array(bands);
    for (let b = 0; b < bands; b++) {
      const from = binOf(edges[b]!);
      const to = Math.max(from, binOf(edges[b + 1]!) - 1);
      let energy = 0;
      for (let k = from; k <= to; k++) energy += re[k]! * re[k]! + im[k]! * im[k]!;
      values[b] = 10 * Math.log10(energy / (to - from + 1) + 1e-12) + tilt[b]!;
    }
    raw.push(values);
  }

  // dB relative to the loud moments (98th percentile of the whole excerpt).
  const all: number[] = [];
  for (const values of raw) for (const v of values) all.push(v);
  const top = percentile(all, 0.98);
  const smoothed: Float32Array[] = [];
  let previous = new Float32Array(bands);
  for (const values of raw) {
    const next = new Float32Array(bands);
    for (let b = 0; b < bands; b++) {
      const level = Math.min(1, Math.max(0, (values[b]! - (top - range)) / range));
      const before = previous[b]!;
      next[b] = before + (level - before) * (level > before ? 0.6 : 0.15);
    }
    smoothed.push(next);
    previous = next;
  }
  return smoothed;
}

export interface BassEvent {
  /** Attack time (s). */
  attack: number;
  /** Highest bass power of the event: from its attack to the next attack (150 ms at most). */
  peak: number;
}

/**
 * Bass attacks (kicks, plucked bass notes) at 1 ms resolution, from the raw
 * bass power: from a local low, the power at least multiplies by 2.5 within
 * 40 ms (also a kick landing on a bass note still sounding). The attack time
 * is the usual onset threshold, 30 % of the way from the low to that peak.
 * Only clear attacks (above 30 % of the loud kicks of the excerpt).
 */
export function bassEvents(power: number[]): BassEvent[] {
  const loud = percentile(power, 0.98);
  const attacks: number[] = [];
  let ms = 1;
  while (ms < power.length - ATTACK_WINDOW_MS) {
    const low = power[ms - 1]!;
    if (power[ms]! <= low) {
      ms++;
      continue;
    }
    let peakAt = ms;
    for (let j = ms; j < ms + ATTACK_WINDOW_MS; j++) if (power[j]! > power[peakAt]!) peakAt = j;
    const peak = power[peakAt]!;
    if (peak > 0.3 * loud && peak >= 2.5 * low) {
      let cross = ms;
      while (power[cross]! < low + ATTACK_FRACTION * (peak - low)) cross++;
      attacks.push(cross);
      ms = peakAt + 10; // after its peak (a kick may land 50 ms later)
    } else {
      ms++;
    }
  }
  return attacks.map((attack, i) => {
    const end = Math.min(attacks[i + 1] ?? Infinity, attack + EVENT_MS, power.length);
    let peak = 0;
    for (let m = attack; m < end; m++) peak = Math.max(peak, power[m]!);
    return { attack: attack / 1000, peak };
  });
}

/** Attack times (s) of the bass of an excerpt (see bassEvents). */
export function bassAttacks(samples: Float32Array, rate: number): number[] {
  return bassEvents(bassPower(samples, rate)).map((e) => e.attack);
}

export interface BreathSync {
  attack: number;
  /**
   * Delay (s, positive = late) between the attack and the frame where the
   * scale peaks for this bass event; null when no visible peak answers it.
   */
  peak: number | null;
}

/**
 * Sync of the breathing, attack by attack: the frame where the envelope is
 * highest for this bass event — from the frame before the attack's frame (but
 * after the previous attack's frame) to the end of the event (150 ms at most, and before the next attack: the 25 ms
 * of power smoothing before it belong to the next event) — compared with the
 * attack time. A frame stands for the time slot from its time to the next
 * frame: an attack within the slot of frame f, shown on frame f, gives a
 * delay between −33.3 and 0 ms; one frame late would be above 0. null when
 * the envelope does not rise by at least `visible` from two frames before
 * (masked by a louder kick still releasing, or too weak to move the cover:
 * 0.1 ≈ 0.2 % of scale at 1.8 %).
 */
export function breathSync(
  attacks: number[],
  envelope: number[],
  fps: number,
  visible = 0.1,
): BreathSync[] {
  return attacks.map((attack, i) => {
    const at = Math.floor(attack * fps + 1e-9);
    const next = attacks[i + 1] ?? Infinity;
    const end = Math.min(
      envelope.length - 1,
      Math.floor((attack + EVENT_MS / 1000) * fps),
      Math.floor((next - BASS_WINDOW) * fps) - 1,
    );
    // From the frame before the attack's, but after the previous attack's frame.
    const previous = i > 0 ? Math.floor(attacks[i - 1]! * fps + 1e-9) : -Infinity;
    const from = Math.max(0, at - 1, previous + 1);
    let best = from;
    for (let f = from; f <= Math.max(at, end) && f < envelope.length; f++) {
      if (envelope[f]! > envelope[best]! + 1e-9) best = f;
    }
    if (envelope[best]! - (envelope[at - 2] ?? 0) < visible) return { attack, peak: null };
    return { attack, peak: best / fps - attack };
  });
}
