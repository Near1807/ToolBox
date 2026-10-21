// EXPERIMENTAL — where does the track play in a video's own sound (a phone
// filming a speaker, a clip…)? Simple cross-correlation of the onset strength
// (rises of the log energy): coarse over the whole files (100 Hz, FFT), then
// refined to the millisecond around the best match.
import type { TrackSync } from '../contract';
import { fft } from './audio-analysis';
import { decodeExcerpt } from './engine';

const RATE = 8000;
const COARSE = 100;
const FINE = 1000;

/** Onset strength at `hopRate` values per second: rectified rise of the log energy, normalised. */
export function onsetStrength(samples: Float32Array, rate: number, hopRate: number): Float64Array {
  const hop = Math.max(1, Math.round(rate / hopRate));
  const win = hop * 2;
  const count = Math.max(0, Math.floor((samples.length - win) / hop));
  const energy = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = i * hop; j < i * hop + win; j++) sum += samples[j]! * samples[j]!;
    energy[i] = Math.log(1e-9 + sum / win);
  }
  const onset = new Float64Array(count);
  for (let i = 1; i < count; i++) onset[i] = Math.max(0, energy[i]! - energy[i - 1]!);
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= Math.max(1, count);
  let variance = 0;
  for (const v of onset) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / Math.max(1, count)) || 1;
  for (let i = 0; i < count; i++) onset[i] = (onset[i]! - mean) / std;
  return onset;
}

/** c[L] / overlap(L) for every lag L (track index = video index + L), via FFT. */
function correlate(track: Float64Array, video: Float64Array, minOverlap: number) {
  let n = 1;
  while (n < track.length + video.length) n *= 2;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(track);
  br.set(video);
  fft(ar, ai);
  fft(br, bi);
  // A × conj(B), then inverse FFT as conj(FFT(conj(x))) / n.
  for (let i = 0; i < n; i++) {
    const re = ar[i]! * br[i]! + ai[i]! * bi[i]!;
    const im = ai[i]! * br[i]! - ar[i]! * bi[i]!;
    ar[i] = re;
    ai[i] = -im;
  }
  fft(ar, ai);
  const scores = new Map<number, number>();
  for (let lag = -(video.length - 1); lag < track.length; lag++) {
    const overlap = Math.min(video.length, track.length - lag) - Math.max(0, -lag);
    if (overlap < minOverlap) continue;
    const value = ar[(lag + n) % n]! / n;
    scores.set(lag, value / overlap);
  }
  return scores;
}

/** Correlation at one lag, computed directly (fine search). */
function correlationAt(track: Float64Array, video: Float64Array, lag: number): number {
  const from = Math.max(0, -lag);
  const to = Math.min(video.length, track.length - lag);
  if (to - from < 10) return -Infinity;
  let sum = 0;
  for (let i = from; i < to; i++) sum += track[i + lag]! * video[i]!;
  return sum / (to - from);
}

export function matchOnsets(
  coarseTrack: Float64Array,
  coarseVideo: Float64Array,
  fineTrack: Float64Array,
  fineVideo: Float64Array,
): TrackSync {
  const scores = correlate(coarseTrack, coarseVideo, 3 * COARSE);
  let best = 0;
  let bestScore = -Infinity;
  for (const [lag, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (!Number.isFinite(bestScore)) {
    return { offset: 0, score: 0, ratio: 0, reliable: false };
  }
  let second = 1e-3;
  for (const [lag, score] of scores) {
    if (Math.abs(lag - best) > 0.3 * COARSE && score > second) second = score;
  }
  // Refined to the millisecond around the coarse match (± 15 ms).
  const centre = Math.round((best * FINE) / COARSE);
  let fine = centre;
  let fineScore = -Infinity;
  for (let lag = centre - 15; lag <= centre + 15; lag++) {
    const score = correlationAt(fineTrack, fineVideo, lag);
    if (score > fineScore) {
      fineScore = score;
      fine = lag;
    }
  }
  const ratio = bestScore / second;
  return {
    offset: Number((fine / FINE).toFixed(3)),
    score: Number(bestScore.toFixed(3)),
    ratio: Number(ratio.toFixed(2)),
    // Prototype thresholds (to be measured on real phone videos).
    reliable: bestScore >= 0.2 && ratio >= 1.4,
  };
}

export async function findTrackInVideo(
  ffmpeg: string,
  trackPath: string,
  videoPath: string,
): Promise<TrackSync> {
  const track = await decodeExcerpt(ffmpeg, trackPath, 0, 36_000, RATE);
  let video: Float32Array;
  try {
    video = await decodeExcerpt(ffmpeg, videoPath, 0, 36_000, RATE);
  } catch (error) {
    throw new Error('Cette vidéo n’a pas de son exploitable', { cause: error });
  }
  if (video.length < RATE * 3) throw new Error('Son de la vidéo trop court (3 s minimum)');
  return matchOnsets(
    onsetStrength(track, RATE, COARSE),
    onsetStrength(video, RATE, COARSE),
    onsetStrength(track, RATE, FINE),
    onsetStrength(video, RATE, FINE),
  );
}
