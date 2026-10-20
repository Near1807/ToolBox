// Audio analysis for choosing the excerpt: waveform peaks and the most
// energetic passage (RMS). The pure functions are unit-tested; decoding uses FFmpeg.
import { spawn } from 'node:child_process';

/** Mono, 8 kHz is plenty for loudness and a waveform. */
export const ANALYSIS_RATE = 8000;
/** Analysis window: 0.1 s. */
export const WINDOW_SECONDS = 0.1;

export interface AudioAnalysis {
  durationSec: number;
  windowSec: number;
  /** Peak amplitude per window, 0..1. */
  peaks: number[];
  /** RMS level per window, 0..1. */
  rms: number[];
}

/** Peak and RMS per window from signed 16-bit mono samples. */
export function analyzeSamples(
  samples: Int16Array,
  sampleRate: number,
  windowSec = WINDOW_SECONDS,
): AudioAnalysis {
  const size = Math.max(1, Math.round(sampleRate * windowSec));
  const count = Math.ceil(samples.length / size);
  const peaks: number[] = [];
  const rms: number[] = [];
  for (let w = 0; w < count; w++) {
    let peak = 0;
    let sum = 0;
    const end = Math.min(samples.length, (w + 1) * size);
    for (let i = w * size; i < end; i++) {
      const v = Math.abs(samples[i]!) / 32768;
      if (v > peak) peak = v;
      sum += v * v;
    }
    peaks.push(round(peak));
    rms.push(round(Math.sqrt(sum / Math.max(1, end - w * size))));
  }
  return { durationSec: samples.length / sampleRate, windowSec, peaks, rms };
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Reduces peaks to `bars` values (max of each group), for drawing. */
export function downsamplePeaks(peaks: number[], bars: number): number[] {
  if (peaks.length <= bars) return peaks;
  const result: number[] = [];
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((b * peaks.length) / bars);
    const to = Math.max(from + 1, Math.floor(((b + 1) * peaks.length) / bars));
    result.push(Math.max(...peaks.slice(from, to)));
  }
  return result;
}

/** Intro and outro left out of the automatic choice: 8 % of the track, between 5 and 15 s. */
export function introOutroSkip(durationSec: number): number {
  return Math.min(15, Math.max(5, durationSec * 0.08));
}

export interface ExcerptPick {
  /** Start times in seconds, most energetic first (Reel 1 = strongest passage). */
  starts: number[];
}

/**
 * Picks up to `count` excerpts of `clipSec` seconds, most energetic first
 * (summed RMS²), leaving out the intro and the outro. Without overlap, two
 * excerpts never share a second; with `allowOverlap`, they may share up to 30 %.
 * Fewer starts are returned when the track is too short.
 */
export function pickExcerpts(
  analysis: Pick<AudioAnalysis, 'rms' | 'windowSec' | 'durationSec'>,
  options: {
    count: number;
    clipSec: number;
    allowOverlap?: boolean;
    /** Starts (seconds) already taken (e.g. published Reels): new excerpts avoid them. */
    fixed?: number[];
  },
): ExcerptPick {
  const { rms, windowSec } = analysis;
  const length = Math.max(1, Math.round(options.clipSec / windowSec));
  if (rms.length <= length) return { starts: [0] };

  // Energy of every possible start (sliding window).
  const scores: number[] = [];
  let current = 0;
  for (let i = 0; i < length; i++) current += rms[i]! ** 2;
  scores.push(current);
  for (let i = 1; i + length <= rms.length; i++) {
    current += rms[i + length - 1]! ** 2 - rms[i - 1]! ** 2;
    scores.push(current);
  }

  // Leave the intro and the outro out, unless the track is too short for that.
  const skip = Math.round(introOutroSkip(analysis.durationSec) / windowSec);
  let first = skip;
  let last = scores.length - 1 - skip;
  if (last < first) {
    first = 0;
    last = scores.length - 1;
  }

  const minDistance = options.allowOverlap ? Math.ceil(length * 0.7) : length;
  const fixed = (options.fixed ?? []).map((start) => Math.round(start / windowSec));
  const picked: number[] = [];
  const free = (i: number) => [...fixed, ...picked].every((p) => Math.abs(p - i) >= minDistance);
  while (picked.length < options.count) {
    let best = -1;
    for (let i = first; i <= last; i++) {
      if (!free(i)) continue;
      if (best === -1 || scores[i]! > scores[best]! + 1e-9) best = i;
    }
    if (best === -1) break;
    picked.push(best);
  }

  // Greedy choice can fragment the region: if more excerpts fit, space them evenly.
  const fit = Math.min(options.count, Math.floor((last - first) / minDistance) + 1);
  if (fixed.length === 0 && picked.length < fit) {
    picked.length = 0;
    const step = fit > 1 ? (last - first) / (fit - 1) : 0;
    for (let j = 0; j < fit; j++) picked.push(Math.round(first + j * step));
    picked.sort((a, b) => scores[b]! - scores[a]!);
  }
  return { starts: picked.map((i) => round(i * windowSec)) };
}

/** True when two excerpts of `clipSec` seconds overlap. */
export function overlaps(a: number, b: number, clipSec: number): boolean {
  return Math.abs(a - b) < clipSec - 1e-6;
}

/** Clamps the excerpt inside the track (duration first, then start). */
export function clampExcerpt(
  start: number,
  duration: number,
  trackDuration: number,
): { start: number; duration: number } {
  const clippedDuration = Math.min(duration, trackDuration);
  const clippedStart = Math.min(Math.max(0, start), Math.max(0, trackDuration - clippedDuration));
  return { start: round(clippedStart), duration: round(clippedDuration) };
}

/** Decodes an audio file to 8 kHz mono and analyses it. */
export function analyzeFile(ffmpeg: string, file: string): Promise<AudioAnalysis> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        '-v',
        'error',
        '-i',
        file,
        '-ac',
        '1',
        '-ar',
        String(ANALYSIS_RATE),
        '-f',
        's16le',
        'pipe:1',
      ],
      { windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-2000)));
    child.on('error', (error) =>
      reject(new Error(`Impossible de lancer FFmpeg : ${error.message}`)),
    );
    child.on('close', (code) => {
      if (code !== 0)
        return reject(new Error(`Analyse du son impossible : ${stderr.trim() || `code ${code}`}`));
      const buffer = Buffer.concat(chunks);
      const samples = new Int16Array(
        buffer.buffer,
        buffer.byteOffset,
        Math.floor(buffer.length / 2),
      );
      resolve(analyzeSamples(samples, ANALYSIS_RATE));
    });
  });
}
