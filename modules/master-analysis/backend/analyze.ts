// The analysis of an audio file, in one pass over the decoded samples: FFmpeg
// decodes to 32-bit float at the file's own rate (never modified, never
// written), this module measures. Every curve is kept at 100 ms (10 ms for the
// waveform and the true peak), so that any part of the file (a section, a
// zoom) can be measured afterwards with the same code (shared/measures.ts).
import { spawn } from 'node:child_process';
import {
  ANALYZER_VERSION,
  BANDS,
  BLOCK,
  FINE,
  type Analysis,
  type FileInfo,
} from '../shared/types';
import { detectSections } from '../shared/sections';
import { Fft, hann, kWeighting, TruePeakMeter } from './dsp';

/** Below this level (−60 dBFS) a sample counts as silence at the start or the end. */
const SILENCE = 0.001;
/** Consecutive samples at full scale that make a clip. */
const CLIP_RUN = 3;
const FULL_SCALE = 0.9999;

const LOSSY = new Set(['mp3', 'aac', 'vorbis', 'opus', 'wmav2', 'ac3', 'eac3']);

/** Format, rate, bit depth, channels, duration (ffprobe). */
export async function probe(ffprobe: string, file: string): Promise<FileInfo> {
  const out = await run(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,sample_rate,channels,bits_per_raw_sample,bits_per_sample,sample_fmt,bit_rate,duration:format=format_name,duration,bit_rate',
    '-of',
    'json',
    file,
  ]);
  const json = JSON.parse(out) as {
    streams?: Record<string, string | number | undefined>[];
    format?: Record<string, string | undefined>;
  };
  const stream = json.streams?.[0];
  if (!stream) throw new Error('Aucune piste audio dans ce fichier');
  const codec = String(stream.codec_name ?? '');
  const lossy = LOSSY.has(codec);
  const sampleFormat = String(stream.sample_fmt ?? '');
  const bits = Number(stream.bits_per_raw_sample) || Number(stream.bits_per_sample) || null;
  const channels = Number(stream.channels) || 2;
  return {
    format: String(json.format?.format_name ?? '').split(',')[0] ?? '',
    codec,
    sampleRate: Number(stream.sample_rate) || 48_000,
    bitDepth: lossy ? null : bits,
    sampleFormat:
      sampleFormat.startsWith('flt') || sampleFormat.startsWith('dbl') ? 'float' : sampleFormat,
    channels,
    analysedChannels: Math.min(2, channels),
    durationSec: Number(stream.duration ?? json.format?.duration) || 0,
    lossy,
    bitRate: Number(stream.bit_rate ?? json.format?.bit_rate) || null,
  };
}

/** Runs a short command (ffprobe) and returns its output; killed after `timeoutMs`. */
function run(command: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Lecture du fichier trop longue (ffprobe ne répond pas)'));
    }, timeoutMs);
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (err += c.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').pop() || `code ${code}`));
    });
  });
}

/** Streams the samples of a file (interleaved float32) to `onSamples`. */
export function decode(options: {
  ffmpeg: string;
  file: string;
  info: FileInfo;
  signal?: AbortSignal;
  onSamples: (samples: Float32Array) => void;
}): Promise<void> {
  const { info } = options;
  // Above 96 kHz, decoded at 96 kHz (true peak and spectrum stay meaningful, memory stays small).
  const rate = Math.min(info.sampleRate, 96_000);
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error('Analyse annulée'));
    const args = ['-v', 'error', '-nostdin', '-i', options.file, '-map', '0:a:0', '-vn'];
    if (info.channels > 2) args.push('-ac', '2');
    if (rate !== info.sampleRate) args.push('-ar', String(rate));
    args.push('-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1');
    const child = spawn(options.ffmpeg, args, { windowsHide: true });
    let rest: Buffer | null = null;
    let err = '';
    let failed: Error | null = null;
    const abort = () => child.kill();
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      if (failed) return;
      const data: Buffer = rest ? Buffer.concat([rest, chunk]) : chunk;
      const usable = data.length - (data.length % 4);
      rest = usable < data.length ? Buffer.from(data.subarray(usable)) : null;
      if (usable === 0) return;
      // Copy into an aligned buffer (a Buffer slice may start at any offset).
      const aligned = new Float32Array(usable / 4);
      new Uint8Array(aligned.buffer).set(data.subarray(0, usable));
      try {
        options.onSamples(aligned);
      } catch (error) {
        failed = error instanceof Error ? error : new Error(String(error));
        child.kill();
      }
    });
    child.stderr.on('data', (c: Buffer) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', abort);
      if (failed) return reject(failed);
      if (options.signal?.aborted) return reject(new Error('Analyse annulée'));
      if (code !== 0)
        return reject(
          new Error(`Lecture du fichier impossible : ${err.trim().split('\n').pop() ?? code}`),
        );
      resolve();
    });
  });
}

/** Growable float array (the number of blocks is only known at the end). */
class Series {
  data = new Float32Array(1024);
  length = 0;
  push(value: number) {
    if (this.length === this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = value;
  }
  done(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

const SPECTROGRAM_BINS = 96;
const THIRD_OCTAVES = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

/**
 * Measures a stream of interleaved samples. `push` as the samples come,
 * `finish` once at the end.
 */
export class Analyzer {
  private readonly channels: number;
  private readonly rate: number;
  private readonly blockSize: number;
  private readonly fineSize: number;
  private readonly kw: [ReturnType<typeof kWeighting>, ReturnType<typeof kWeighting>];
  private readonly tp: TruePeakMeter[];
  private sampleIndex = 0;

  // Current 100 ms block.
  private bPower = 0;
  private bSquare = 0;
  private bPeak = 0;
  private bTrue = 0;
  private bMid = 0;
  private bSide = 0;
  private bLR = 0;
  private bLL = 0;
  private bRR = 0;
  private bCount = 0;
  private readonly power = new Series();
  private readonly meanSquare = new Series();
  private readonly peak = new Series();
  private readonly truePeak = new Series();
  private readonly mid = new Series();
  private readonly side = new Series();
  private readonly correlation = new Series();

  // Current 10 ms step.
  private fMin = 0;
  private fMax = 0;
  private fTrue = 0;
  private fCount = 0;
  private readonly waveMin = new Series();
  private readonly waveMax = new Series();
  private readonly trueFine = new Series();

  // Spectrum.
  private readonly fft: Fft;
  private readonly window: Float64Array;
  private readonly windowPower: number;
  private readonly frameMid: Float64Array;
  private readonly frameSide: Float64Array;
  private framePos = 0;
  private framesDone = 0;
  private readonly bandEdges: number[][];
  private readonly bandSums: { mid: number[]; side: number[]; count: number }[] = [];
  private readonly spectro: number[] = [];
  private readonly ltas: Float64Array;
  private ltasFrames = 0;
  private previousMagnitude: Float64Array | null = null;
  private readonly flux: number[] = [];

  // Hygiene.
  private readonly dcSum: number[];
  private firstSound = -1;
  private lastSound = -1;
  private samplePeakMax = 0;
  private truePeakMaxValue = 0;
  private above = 0;
  private readonly clipRun: number[];
  private readonly clipAbove: boolean[];
  private readonly clips: Analysis['clipping'] = [];
  // True peak values are late by the filter delay: they are given to the right block.
  private readonly tpDelay: number;
  private readonly tpQueue: number[] = [];

  constructor(
    private readonly info: FileInfo,
    private readonly started = Date.now(),
  ) {
    this.channels = info.analysedChannels;
    this.rate = Math.min(info.sampleRate, 96_000);
    this.blockSize = Math.round(this.rate * BLOCK);
    this.fineSize = Math.round(this.rate * FINE);
    this.kw = [kWeighting(this.rate), kWeighting(this.rate)];
    this.tp = Array.from({ length: this.channels }, () => new TruePeakMeter(this.rate));
    this.tpDelay = this.tp[0]!.delay;
    const n = this.rate > 48_000 ? 8192 : 4096;
    this.fft = new Fft(n);
    this.window = hann(n);
    this.windowPower = this.window.reduce((s, w) => s + w * w, 0);
    this.frameMid = new Float64Array(n);
    this.frameSide = new Float64Array(n);
    this.ltas = new Float64Array(n / 2 + 1);
    const binOf = (f: number) => Math.round((f * n) / this.rate);
    this.bandEdges = BANDS.map((b) => [
      Math.max(1, binOf(b.from)),
      Math.min(n / 2, binOf(b.to) - 1),
    ]);
    this.dcSum = Array(this.channels).fill(0);
    this.clipRun = Array(this.channels).fill(0);
    this.clipAbove = Array(this.channels).fill(false);
  }

  push(samples: Float32Array): void {
    const c = this.channels;
    const [kl, kr] = this.kw;
    const hop = this.fft.n / 2;
    for (let i = 0; i + c - 1 < samples.length; i += c) {
      const l = samples[i]!;
      const r = c === 2 ? samples[i + 1]! : l;
      // Loudness (K-weighted, BS.1770: sum of the channels' mean squares).
      const wl = kl[1].process(kl[0].process(l));
      if (c === 2) {
        const wr = kr[1].process(kr[0].process(r));
        this.bPower += wl * wl + wr * wr;
      } else this.bPower += wl * wl;
      this.bSquare += c === 2 ? (l * l + r * r) / 2 : l * l;
      const al = Math.abs(l);
      const ar = Math.abs(r);
      const a = al > ar ? al : ar;
      if (a > this.bPeak) this.bPeak = a;
      const m = (l + r) / 2;
      const s = (l - r) / 2;
      this.bMid += m * m;
      this.bSide += s * s;
      this.bLR += l * r;
      this.bLL += l * l;
      this.bRR += r * r;
      // True peak (one meter per channel, results late by the filter delay).
      let t = this.tp[0]!.push(l);
      if (c === 2) {
        const t2 = this.tp[1]!.push(r);
        if (t2 > t) t = t2;
      }
      this.takeTruePeak(t);
      // Waveform.
      const lo = l < r ? l : r;
      const hi = l > r ? l : r;
      if (this.fCount === 0 || lo < this.fMin) this.fMin = lo;
      if (this.fCount === 0 || hi > this.fMax) this.fMax = hi;
      // Hygiene.
      this.dcSum[0]! += l;
      if (c === 2) this.dcSum[1]! += r;
      if (a > SILENCE) {
        if (this.firstSound < 0) this.firstSound = this.sampleIndex;
        this.lastSound = this.sampleIndex;
      }
      if (a > this.samplePeakMax) this.samplePeakMax = a;
      this.clip(0, al, l);
      if (c === 2) this.clip(1, ar, r);
      // Spectrum frames (hop of half a frame).
      this.frameMid[this.framePos] = m;
      this.frameSide[this.framePos] = s;
      this.framePos++;
      if (this.framePos === this.fft.n) {
        this.analyseFrame();
        this.frameMid.copyWithin(0, hop);
        this.frameSide.copyWithin(0, hop);
        this.framePos = hop;
      }
      this.sampleIndex++;
      this.bCount++;
      this.fCount++;
      if (this.fCount === this.fineSize) this.closeFine();
      if (this.bCount === this.blockSize) this.closeBlock();
    }
  }

  private takeTruePeak(value: number) {
    // The value describes the sample that entered `tpDelay` samples ago.
    this.tpQueue.push(value);
    if (this.tpQueue.length <= this.tpDelay) return;
    const v = this.tpQueue.shift()!;
    if (v > this.bTrue) this.bTrue = v;
    if (v > this.fTrue) this.fTrue = v;
    if (v > this.truePeakMaxValue) this.truePeakMaxValue = v;
  }

  private clip(channel: number, a: number, x: number) {
    if (Math.abs(x) > 1) this.above++;
    if (a >= FULL_SCALE) {
      this.clipRun[channel]!++;
      if (a > 1) this.clipAbove[channel] = true;
      return;
    }
    const runLength = this.clipRun[channel]!;
    if (runLength >= CLIP_RUN || this.clipAbove[channel]) {
      const time = (this.sampleIndex - runLength) / this.rate;
      const last = this.clips.findLast((k) => k.channel === channel);
      if (last && time - last.time < 0.01) {
        last.samples += runLength;
        last.aboveFullScale ||= this.clipAbove[channel]!;
      } else if (this.clips.length < 5000) {
        this.clips.push({
          time,
          channel,
          samples: runLength,
          aboveFullScale: this.clipAbove[channel]!,
        });
      }
    }
    this.clipRun[channel] = 0;
    this.clipAbove[channel] = false;
  }

  private closeFine() {
    this.waveMin.push(this.fMin);
    this.waveMax.push(this.fMax);
    this.trueFine.push(this.fTrue);
    this.fCount = 0;
    this.fTrue = 0;
  }

  private closeBlock() {
    const n = this.bCount || 1;
    this.power.push(this.bPower / n);
    this.meanSquare.push(this.bSquare / n);
    this.peak.push(this.bPeak);
    this.truePeak.push(this.bTrue);
    this.mid.push(this.bMid / n);
    this.side.push(this.bSide / n);
    const denominator = Math.sqrt(this.bLL * this.bRR);
    this.correlation.push(denominator > 1e-12 ? this.bLR / denominator : 0);
    this.bPower = this.bSquare = this.bPeak = this.bTrue = 0;
    this.bMid = this.bSide = this.bLR = this.bLL = this.bRR = 0;
    this.bCount = 0;
  }

  private analyseFrame() {
    const n = this.fft.n;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = this.frameMid[i]! * this.window[i]!;
      im[i] = this.frameSide[i]! * this.window[i]!;
    }
    this.fft.transform(re, im);
    // Z = M + iS: M_k = (Z_k + conj Z_{n-k}) / 2, S_k = (Z_k − conj Z_{n-k}) / 2i.
    const half = n / 2;
    const pm = new Float64Array(half + 1);
    const ps = new Float64Array(half + 1);
    const scale = 1 / (n * this.windowPower);
    for (let k = 0; k <= half; k++) {
      const j = (n - k) % n;
      const mr = (re[k]! + re[j]!) / 2;
      const mi = (im[k]! - im[j]!) / 2;
      const sr = (im[k]! + im[j]!) / 2;
      const si = (re[j]! - re[k]!) / 2;
      const factor = k === 0 || k === half ? scale : 2 * scale;
      pm[k] = (mr * mr + mi * mi) * factor;
      ps[k] = (sr * sr + si * si) * factor;
    }
    // Bands, given to the block of the frame's centre.
    const centre = (this.framesDone * half + half) / this.rate;
    const block = Math.floor(centre / BLOCK);
    while (this.bandSums.length <= block)
      this.bandSums.push({
        mid: Array(BANDS.length).fill(0),
        side: Array(BANDS.length).fill(0),
        count: 0,
      });
    const sums = this.bandSums[block]!;
    sums.count++;
    this.bandEdges.forEach(([from, to], b) => {
      let em = 0;
      let es = 0;
      for (let k = from!; k <= to!; k++) {
        em += pm[k]!;
        es += ps[k]!;
      }
      sums.mid[b]! += em;
      sums.side[b]! += es;
    });
    // Long-term spectrum, spectrogram row, spectral flux (onsets).
    const total = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) {
      total[k] = pm[k]! + ps[k]!;
      this.ltas[k]! += total[k]!;
    }
    this.ltasFrames++;
    const fmin = 20;
    const fmax = Math.min(20_000, this.rate / 2);
    for (let i = 0; i < SPECTROGRAM_BINS; i++) {
      const f0 = fmin * (fmax / fmin) ** (i / SPECTROGRAM_BINS);
      const f1 = fmin * (fmax / fmin) ** ((i + 1) / SPECTROGRAM_BINS);
      const k0 = Math.max(1, Math.floor((f0 * n) / this.rate));
      const k1 = Math.max(k0, Math.min(half, Math.ceil((f1 * n) / this.rate) - 1));
      let sum = 0;
      for (let k = k0; k <= k1; k++) sum += total[k]!;
      const mean = sum / (k1 - k0 + 1);
      const value = mean > 0 ? 10 * Math.log10(mean) : -120;
      this.spectro.push(Math.max(0, Math.min(240, Math.round((value + 120) * 2))));
    }
    const magnitude = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) magnitude[k] = Math.log1p(1000 * Math.sqrt(pm[k]!));
    let flux = 0;
    if (this.previousMagnitude)
      for (let k = 1; k <= half; k++) {
        const d = magnitude[k]! - this.previousMagnitude[k]!;
        if (d > 0) flux += d;
      }
    this.previousMagnitude = magnitude;
    this.flux.push(flux);
    this.framesDone++;
  }

  finish(): Analysis {
    // The end of the true peak filter, then the last partial block / step.
    const tails = this.tp.map((m) => m.flush());
    tails[0]!.forEach((v, i) => this.takeTruePeak(Math.max(v, tails[1]?.[i] ?? 0)));
    while (this.tpQueue.length) {
      const v = this.tpQueue.shift()!;
      if (v > this.bTrue) this.bTrue = v;
      if (v > this.fTrue) this.fTrue = v;
      if (v > this.truePeakMaxValue) this.truePeakMaxValue = v;
    }
    for (let ch = 0; ch < this.channels; ch++) this.clip(ch, 0, 0);
    if (this.fCount > 0) this.closeFine();
    if (this.bCount > 0) this.closeBlock();
    const blocks = this.power.length;
    // Band powers per block (frames averaged; blocks without a frame take the nearest one).
    const bandMid = BANDS.map(() => new Float32Array(blocks));
    const bandSide = BANDS.map(() => new Float32Array(blocks));
    let lastFilled = -1;
    for (let i = 0; i < blocks; i++) {
      const sums = this.bandSums[i];
      if (sums && sums.count > 0) {
        BANDS.forEach((_, b) => {
          bandMid[b]![i] = sums.mid[b]! / sums.count;
          bandSide[b]![i] = sums.side[b]! / sums.count;
        });
        lastFilled = i;
      } else if (lastFilled >= 0) {
        BANDS.forEach((_, b) => {
          bandMid[b]![i] = bandMid[b]![lastFilled]!;
          bandSide[b]![i] = bandSide[b]![lastFilled]!;
        });
      }
    }
    const firstFilled = this.bandSums.findIndex((s) => s && s.count > 0);
    if (firstFilled > 0)
      for (let i = 0; i < firstFilled; i++)
        BANDS.forEach((_, b) => {
          bandMid[b]![i] = bandMid[b]![firstFilled]!;
          bandSide[b]![i] = bandSide[b]![firstFilled]!;
        });
    const n = this.fft.n;
    const half = n / 2;
    const averaged = (from: number, to: number) => {
      const k0 = Math.max(1, Math.ceil((from * n) / this.rate));
      const k1 = Math.min(half, Math.floor((to * n) / this.rate));
      if (k1 < k0) {
        const k = Math.max(1, Math.min(half, Math.round((((from + to) / 2) * n) / this.rate)));
        return this.ltas[k]! / Math.max(1, this.ltasFrames);
      }
      let sum = 0;
      for (let k = k0; k <= k1; k++) sum += this.ltas[k]!;
      return sum / Math.max(1, this.ltasFrames);
    };
    const toDb = (p: number) => (p > 0 ? 10 * Math.log10(p) : -120);
    const nyquist = this.rate / 2;
    const thirdOctave = THIRD_OCTAVES.filter((f) => f * 2 ** (1 / 6) <= nyquist * 1.001).map(
      (f) => ({
        f,
        db: toDb(averaged(f / 2 ** (1 / 6), f * 2 ** (1 / 6))),
      }),
    );
    const spectrum = Array.from({ length: 120 }, (_, i) => {
      const f = 20 * (Math.min(20_000, nyquist) / 20) ** (i / 119);
      // Mean power density over a third of an octave around f, per bin.
      const k0 = Math.max(1, Math.ceil(((f / 2 ** (1 / 6)) * n) / this.rate));
      const k1 = Math.min(half, Math.max(k0, Math.floor((f * 2 ** (1 / 6) * n) / this.rate)));
      let sum = 0;
      for (let k = k0; k <= k1; k++) sum += this.ltas[k]!;
      return { f, db: toDb(sum / (k1 - k0 + 1) / Math.max(1, this.ltasFrames)) };
    });
    const density = this.onsetDensity(blocks);
    const total = this.sampleIndex;
    const analysis: Analysis = {
      analyzer: ANALYZER_VERSION,
      file: this.info,
      blocks,
      power: this.power.done(),
      meanSquare: this.meanSquare.done(),
      peak: this.peak.done(),
      truePeak: this.truePeak.done(),
      mid: this.mid.done(),
      side: this.side.done(),
      correlation: this.correlation.done(),
      bandMid,
      bandSide,
      density,
      waveMin: this.waveMin.done(),
      waveMax: this.waveMax.done(),
      truePeakFine: this.trueFine.done(),
      spectrogram: {
        bins: SPECTROGRAM_BINS,
        fmin: 20,
        fmax: Math.min(20_000, nyquist),
        hopSec: half / this.rate,
        frames: this.framesDone,
        data: Uint8Array.from(this.spectro),
      },
      thirdOctave,
      spectrum,
      clipping: this.clips,
      dc: this.dcSum.map((s) => (total ? s / total : 0)),
      leadingSilence: this.firstSound < 0 ? total / this.rate : this.firstSound / this.rate,
      trailingSilence: this.lastSound < 0 ? 0 : (total - 1 - this.lastSound) / this.rate,
      samplePeak: this.samplePeakMax,
      truePeakMax: Math.max(this.truePeakMaxValue, this.samplePeakMax),
      aboveFullScale: this.above,
      sectionsAuto: [],
      analysisMs: 0,
    };
    analysis.sectionsAuto = detectSections(analysis);
    analysis.analysisMs = Date.now() - this.started;
    return analysis;
  }

  /** Onsets (peaks of the spectral flux) per second, over ±1 s around each block. */
  private onsetDensity(blocks: number): Float32Array {
    const flux = this.flux;
    const hopSec = this.fft.n / 2 / this.rate;
    const onsets: number[] = [];
    const radius = Math.max(2, Math.round(0.5 / hopSec));
    const mean = flux.reduce((s, v) => s + v, 0) / Math.max(1, flux.length);
    let lastOnset = -Infinity;
    for (let i = 1; i < flux.length - 1; i++) {
      const v = flux[i]!;
      if (v < flux[i - 1]! || v < flux[i + 1]!) continue;
      const window = flux.slice(Math.max(0, i - radius), i + radius + 1).sort((a, b) => a - b);
      const median = window[Math.floor(window.length / 2)]!;
      // Centre of frame i (frames start every hop and last two hops).
      const time = (i + 1) * hopSec;
      if (v > median * 1.5 + mean * 0.1 && time - lastOnset >= 0.05) {
        onsets.push(time);
        lastOnset = time;
      }
    }
    const density = new Float32Array(blocks);
    let lo = 0;
    let hi = 0;
    for (let b = 0; b < blocks; b++) {
      const t = (b + 0.5) * BLOCK;
      while (lo < onsets.length && onsets[lo]! < t - 1) lo++;
      while (hi < onsets.length && onsets[hi]! <= t + 1) hi++;
      density[b] = (hi - lo) / 2;
    }
    return density;
  }
}

/** Probes, decodes and measures a file. */
export async function analyseFile(options: {
  ffmpeg: string;
  ffprobe: string;
  file: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}): Promise<Analysis> {
  const started = Date.now();
  const info = await probe(options.ffprobe, options.file);
  const analyzer = new Analyzer(info, started);
  const expected = Math.max(
    1,
    info.durationSec * Math.min(info.sampleRate, 96_000) * info.analysedChannels,
  );
  let seen = 0;
  let lastReport = 0;
  await decode({
    ffmpeg: options.ffmpeg,
    file: options.file,
    info,
    signal: options.signal,
    onSamples: (samples) => {
      analyzer.push(samples);
      seen += samples.length;
      const fraction = Math.min(0.99, seen / expected);
      if (fraction - lastReport >= 0.02) {
        lastReport = fraction;
        options.onProgress?.(fraction);
      }
    },
  });
  const analysis = analyzer.finish();
  if (analysis.blocks === 0) throw new Error('Fichier audio vide');
  if (!info.durationSec) info.durationSec = analysis.blocks * BLOCK;
  return analysis;
}
