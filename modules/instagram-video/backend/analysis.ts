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

/**
 * Start (seconds) of the most energetic passage of `clipSec` seconds: the
 * window maximizing the summed energy (RMS²). Short tracks start at 0.
 */
export function suggestStart(
  analysis: Pick<AudioAnalysis, 'rms' | 'windowSec'>,
  clipSec: number,
): number {
  const { rms, windowSec } = analysis;
  const length = Math.max(1, Math.round(clipSec / windowSec));
  if (rms.length <= length) return 0;
  let current = 0;
  for (let i = 0; i < length; i++) current += rms[i]! ** 2;
  let best = current;
  let bestIndex = 0;
  for (let i = 1; i + length <= rms.length; i++) {
    current += rms[i + length - 1]! ** 2 - rms[i - 1]! ** 2;
    if (current > best + 1e-9) {
      best = current;
      bestIndex = i;
    }
  }
  return round(bestIndex * windowSec);
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
