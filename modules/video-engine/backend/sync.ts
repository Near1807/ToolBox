// Where does the track play in a video's own sound (a phone filming a
// speaker, a screen capture of the DAW…)? « Morceau synchronisé » of the
// Reels made from the user's videos.
//
// Only the chosen passage of the video is searched (± 1 s): a track played
// several times in the video is found at the right place. Features that
// survive a phone capture: the spectral flux (rises of the log magnitude, per
// band, so that volume, equalisation and compression do not matter), matched
// with a normalised correlation at every lag (FFT), then refined to the
// millisecond on the transients. The match is « reliable » only when it is
// both strong and clearly better than any other place in the track.
import type { TrackSync } from '../contract';
import { fft } from './audio-analysis';
import { decodeExcerpt } from './engine';

const RATE = 8000;
/** Coarse feature rate (values per second) and fine one. */
export const COARSE = 100;
export const FINE = 1000;
/** Search window around the passage in the video (s). */
const MARGIN = 1;
/**
 * A match must stand out from all the other places (salience, in standard
 * deviations) and be clearly better than the next best one (ratio). Measured on
 * strongly degraded captures (no bass, echo, noise at ~0 dB SNR, compression):
 * a track that is not in the video stays below 4.7 and 1.23; the track in a
 * passage of 15 s or more stands out at 5.5–11 and 1.3–2.9.
 */
export const MIN_SALIENCE = 5.5;
export const MIN_RATIO = 1.3;

function normalise(values: Float64Array): Float64Array {
  let mean = 0;
  for (const v of values) mean += v;
  mean /= Math.max(1, values.length);
  let variance = 0;
  for (const v of values) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / Math.max(1, values.length)) || 1;
  return values.map((v) => (v - mean) / std);
}

/**
 * Spectral flux at `hopRate` values per second: for each frame (32 ms), the
 * sum over 16 log-spaced bands of the rise of log(1 + magnitude). Volume
 * changes cancel out (log, then rises), a missing band (no bass on a phone)
 * only removes its part.
 */
export function spectralFlux(samples: Float32Array, rate: number, hopRate: number): Float64Array {
  const size = 256;
  const hop = Math.max(1, Math.round(rate / hopRate));
  const count = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
  const bands = 16;
  const edges = Array.from({ length: bands + 1 }, (_, i) =>
    Math.round(2 * (size / 2 / 2) ** (i / bands)),
  );
  const window = Float64Array.from(
    { length: size },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size),
  );
  const previous = new Float64Array(bands);
  const flux = new Float64Array(count);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let f = 0; f < count; f++) {
    const offset = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = samples[offset + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let b = 0; b < bands; b++) {
      let energy = 0;
      for (let k = edges[b]!; k < Math.max(edges[b]! + 1, edges[b + 1]!); k++) {
        energy += re[k]! * re[k]! + im[k]! * im[k]!;
      }
      const level = Math.log(1e-6 + energy);
      if (f > 0) sum += Math.max(0, level - previous[b]!);
      previous[b] = level;
    }
    flux[f] = sum;
  }
  return normalise(flux);
}

/**
 * Normalised correlation of `needle` (zero mean, unit variance) at every lag L
 * where it lies entirely inside `hay` (hay[L + i] ~ needle[i]): Pearson, the
 * hay being normalised on each window (prefix sums), the dot products by FFT.
 */
export function slidingCorrelation(hay: Float64Array, needle: Float64Array): Float64Array {
  const n = needle.length;
  const lags = hay.length - n + 1;
  if (lags <= 0 || n < 2) return new Float64Array(0);
  let size = 1;
  while (size < hay.length + n) size *= 2;
  const ar = new Float64Array(size);
  const ai = new Float64Array(size);
  const br = new Float64Array(size);
  const bi = new Float64Array(size);
  ar.set(hay);
  br.set(needle);
  fft(ar, ai);
  fft(br, bi);
  for (let i = 0; i < size; i++) {
    const re = ar[i]! * br[i]! + ai[i]! * bi[i]!;
    const im = ai[i]! * br[i]! - ar[i]! * bi[i]!;
    ar[i] = re;
    ai[i] = -im;
  }
  fft(ar, ai); // inverse, as conj(FFT(conj(x))) / size: ar holds size × dot(L)
  const sum = new Float64Array(hay.length + 1);
  const squares = new Float64Array(hay.length + 1);
  for (let i = 0; i < hay.length; i++) {
    sum[i + 1] = sum[i]! + hay[i]!;
    squares[i + 1] = squares[i]! + hay[i]! * hay[i]!;
  }
  const out = new Float64Array(lags);
  for (let lag = 0; lag < lags; lag++) {
    const mean = (sum[lag + n]! - sum[lag]!) / n;
    const variance = (squares[lag + n]! - squares[lag]!) / n - mean * mean;
    const dot = ar[lag]! / size;
    out[lag] = variance > 1e-12 ? dot / (n * Math.sqrt(variance)) : 0;
  }
  return out;
}

/**
 * Best place of the video window in the track. Returns the lag (in values of
 * the coarse rate), its correlation, and how much better it is than the best
 * match farther than 0.3 s from it.
 */
function bestLag(
  scores: Float64Array,
  rate: number,
): { lag: number; score: number; ratio: number; z: number } {
  let lag = 0;
  let score = -Infinity;
  let mean = 0;
  for (let i = 0; i < scores.length; i++) {
    mean += scores[i]!;
    if (scores[i]! > score) {
      score = scores[i]!;
      lag = i;
    }
  }
  mean /= scores.length;
  let variance = 0;
  for (const v of scores) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / scores.length) || 1;
  let second = 1e-3;
  const away = Math.round(0.3 * rate);
  for (let i = 0; i < scores.length; i++) {
    if (Math.abs(i - lag) > away && scores[i]! > second) second = scores[i]!;
  }
  return { lag, score, ratio: score > 0 ? score / second : 0, z: (score - mean) / std };
}

/**
 * Pure part: track and video window sounds (mono, `rate`) → offset such that
 * track time = video time + offset, where the window starts at `windowStart`
 * (s) in the video.
 */
export function matchWindow(
  track: Float32Array,
  window: Float32Array,
  rate: number,
  windowStart: number,
): TrackSync {
  const none = { offset: 0, score: 0, ratio: 0, salience: 0, reliable: false };
  if (window.length < rate * 2 || track.length < window.length) return none;
  const coarse = slidingCorrelation(
    spectralFlux(track, rate, COARSE),
    spectralFlux(window, rate, COARSE),
  );
  if (coarse.length === 0) return none;
  const best = bestLag(coarse, COARSE);
  // Refined to the millisecond: the same flux every millisecond, on the part of
  // the track around the coarse match only (± 20 ms).
  const margin = 0.02;
  const coarseStart = best.lag / COARSE;
  const from = Math.max(0, Math.round((coarseStart - margin) * rate));
  const to = Math.min(track.length, Math.round((coarseStart + margin) * rate) + window.length);
  const fineScores = slidingCorrelation(
    spectralFlux(track.subarray(from, to), rate, FINE),
    spectralFlux(window, rate, FINE),
  );
  let fine = coarseStart;
  if (fineScores.length > 0) {
    let top = -Infinity;
    let at = 0;
    fineScores.forEach((value, i) => {
      if (value > top) {
        top = value;
        at = i;
      }
    });
    // Parabolic interpolation around the top: below the millisecond.
    const a = fineScores[at - 1] ?? top;
    const c = fineScores[at + 1] ?? top;
    const curve = a - 2 * top + c;
    const shift = curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curve)) : 0;
    fine = from / rate + (at + shift) / FINE;
  }
  return {
    offset: Number((fine - windowStart).toFixed(4)),
    score: Number(best.score.toFixed(3)),
    ratio: Number(best.ratio.toFixed(2)),
    salience: Number(best.z.toFixed(1)),
    reliable: best.z >= MIN_SALIENCE && best.ratio >= MIN_RATIO,
  };
}

/**
 * Finds where the track plays during the passage [start, start + duration]
 * of the video (the whole video when no passage is given).
 */
export async function findTrackInVideo(
  ffmpeg: string,
  trackPath: string,
  videoPath: string,
  passage?: { start: number; duration: number },
): Promise<TrackSync> {
  const track = await decodeExcerpt(ffmpeg, trackPath, 0, 36_000, RATE);
  const windowStart = passage ? Math.max(0, passage.start - MARGIN) : 0;
  const windowLength = passage ? passage.duration + 2 * MARGIN : 36_000;
  let window: Float32Array;
  try {
    window = await decodeExcerpt(ffmpeg, videoPath, windowStart, windowLength, RATE);
  } catch (error) {
    throw new Error('Cette vidéo n’a pas de son exploitable', { cause: error });
  }
  if (window.length < RATE * 2) throw new Error('Son de la vidéo trop court (2 s minimum)');
  // Silent video: nothing to find.
  let peak = 0;
  for (const v of window) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-4) return { offset: 0, score: 0, ratio: 0, salience: 0, reliable: false };
  return matchWindow(track, window, RATE, windowStart);
}
