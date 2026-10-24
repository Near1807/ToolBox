// Signal processing building blocks of the analysis: K-weighting (ITU-R
// BS.1770-4), true peak by 4× oversampling (the polyphase filter of BS.1770-4,
// Annex 2), a radix-2 FFT. Pure functions and small classes, no I/O.

/** One biquad section (direct form I), coefficients normalised by a0. */
export class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  process(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/**
 * The two stages of the K-weighting (high shelf + high pass) for any sample
 * rate, computed like libebur128 (the 48 kHz coefficients of BS.1770 are its
 * special case).
 */
export function kWeighting(rate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = new Biquad(
    (Vh + (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - Vh)) / a0,
    (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0,
    (1 - K / Q + K * K) / a0,
  );
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const highPass = new Biquad(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  return [shelf, highPass];
}

/** Loudness of a mean square (sum over channels, weights 1): -0.691 + 10·log10. */
export const lufs = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);

export const db = (power: number) => (power > 0 ? 10 * Math.log10(power) : -Infinity);
export const dbAmp = (amplitude: number) =>
  amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;

/** Modified Bessel function of order 0 (Kaiser window). */
function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 30; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

/** Taps per phase of the oversampling filter (the filter's delay is half of it). */
const TAPS = 48;

/**
 * Polyphase windowed-sinc interpolator (Kaiser, β = 9): phase p gives the
 * sample at t + p/factor. Each phase sums to 1. More precise than the 12-tap
 * example of BS.1770-4 Annex 2, whose ripple reads high frequencies up to
 * 0.2 dB too high (and FFmpeg's ebur128 up to 1 dB).
 */
function interpolator(factor: number): Float64Array[] {
  const length = TAPS * factor;
  const beta = 9;
  // Centre on a tap: the phases fall on 0, 1/4, 1/2, 3/4 of a sample.
  const centre = length / 2;
  const full = Float64Array.from({ length }, (_, n) => {
    const t = (n - centre) / factor;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const r = (n - centre) / (centre + 1);
    return sinc * (bessel0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / bessel0(beta));
  });
  return Array.from({ length: factor }, (_, p) => {
    const phase = new Float64Array(TAPS);
    for (let k = 0; k < TAPS; k++) phase[k] = full[k * factor + (factor - 1 - p)]!;
    const sum = phase.reduce((s, v) => s + v, 0);
    return phase.map((v) => v / sum);
  });
}

const PHASES = new Map<number, Float64Array[]>();
const phasesFor = (factor: number) => {
  let phases = PHASES.get(factor);
  if (!phases) {
    phases = interpolator(factor);
    PHASES.set(factor, phases);
  }
  return phases;
};

/**
 * True peak of one channel, sample by sample: the largest absolute value of
 * the 4× oversampled signal (×2 at 96 kHz and above). `push` returns the true
 * peak just after the sample that entered `delay` samples earlier; `flush` the
 * last ones. Quiet passages (below −12 dBFS and below half of the loudest peak
 * so far) keep their sample value: an inter-sample peak there cannot reach the
 * levels that matter, and the analysis stays fast.
 */
export class TruePeakMeter {
  readonly delay = TAPS / 2;
  private readonly history = new Float64Array(TAPS * 2);
  private index = 0;
  private readonly phases: Float64Array[];
  private loudest = 0;

  constructor(rate: number) {
    this.phases = rate >= 96_000 ? phasesFor(2) : phasesFor(4);
  }

  push(x: number): number {
    const h = this.history;
    // Written twice so that the last TAPS samples are always contiguous.
    h[this.index] = x;
    h[this.index + TAPS] = x;
    this.index = (this.index + 1) % TAPS;
    const start = this.index;
    const a = Math.abs(h[start + this.delay - 1]!);
    const b = Math.abs(h[start + this.delay]!);
    const local = a > b ? a : b;
    if (local < 0.25 && local < 0.5 * this.loudest) return b;
    let peak = b;
    for (const coefficients of this.phases) {
      let sum = 0;
      for (let k = 0; k < TAPS; k++) sum += coefficients[k]! * h[start + k]!;
      const v = sum < 0 ? -sum : sum;
      if (v > peak) peak = v;
    }
    if (peak > this.loudest) this.loudest = peak;
    return peak;
  }

  /** Pushes zeros through the filter to read the end of the signal. */
  flush(): number[] {
    return Array.from({ length: this.delay }, () => this.push(0));
  }
}

/** In-place iterative radix-2 FFT of size n (power of two). */
export class Fft {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reverse: Uint32Array;

  constructor(readonly n: number) {
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    this.reverse = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reverse[i] = r;
    }
  }

  transform(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.reverse[i]!;
      if (j > i) {
        [re[i], re[j]] = [re[j]!, re[i]!];
        [im[i], im[j]] = [im[j]!, im[i]!];
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]!;
          const wi = this.sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const tr = wr * re[b]! - wi * im[b]!;
          const ti = wr * im[b]! + wi * re[b]!;
          re[b] = re[a]! - tr;
          im[b] = im[a]! - ti;
          re[a] = re[a]! + tr;
          im[a] = im[a]! + ti;
        }
      }
    }
  }
}

export function hann(n: number): Float64Array {
  return Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
}
