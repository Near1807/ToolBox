// Test files with KNOWN properties (level, clip at a precise time, phase
// opposition, DC offset, silences, pink noise, build-up and drop, two versions
// with a known difference), and FFmpeg's ebur128 as the reference meter.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import ffprobePath from '@derhuerst/ffprobe-static';
import ffmpegPath from 'ffmpeg-static';

export const ffmpeg = ffmpegPath as unknown as string;
export const ffprobe =
  (ffprobePath as unknown as { path: string }).path ?? (ffprobePath as unknown as string);

export const RATE = 48_000;

/** A float32 WAV (or 16/24-bit PCM) from channel arrays. */
export function writeWav(
  file: string,
  channels: Float32Array[],
  options: { rate?: number; bits?: 16 | 24 | 32 } = {},
) {
  const rate = options.rate ?? RATE;
  const bits = options.bits ?? 32;
  const n = channels[0]!.length;
  const c = channels.length;
  const bytes = bits / 8;
  const buffer = Buffer.alloc(44 + n * c * bytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + n * c * bytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(bits === 32 ? 3 : 1, 20);
  buffer.writeUInt16LE(c, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * c * bytes, 28);
  buffer.writeUInt16LE(c * bytes, 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(n * c * bytes, 40);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let ch = 0; ch < c; ch++) {
      const x = channels[ch]![i]!;
      if (bits === 32) buffer.writeFloatLE(x, o);
      else if (bits === 16)
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * 32767))), o);
      else buffer.writeIntLE(Math.max(-8388608, Math.min(8388607, Math.round(x * 8388607))), o, 3);
      o += bytes;
    }
  writeFileSync(file, buffer);
}

/** Deterministic noise (white, or pink with Paul Kellet's filter). */
export function noise(n: number, seed = 1, pink = false): Float32Array {
  let s = seed >>> 0 || 1;
  const random = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
  const out = new Float32Array(n);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = random();
    if (!pink) {
      out[i] = w;
      continue;
    }
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

/** A sine with 50 ms fades (a sudden start overshoots for real between samples). */
export function sine(
  n: number,
  frequency: number,
  amplitude: number,
  phase = 0,
  rate = RATE,
): Float32Array {
  const fade = Math.round(0.05 * rate);
  return Float32Array.from({ length: n }, (_, i) => {
    const edge = Math.min(1, i / fade, (n - 1 - i) / fade);
    return amplitude * edge * Math.sin((2 * Math.PI * frequency * i) / rate + phase);
  });
}

export const seconds = (s: number, rate = RATE) => Math.round(s * rate);

/** FFmpeg's ebur128 (the reference): integrated and LRA to 0.001, true peak to 0.1 dB. */
export function ebur128(file: string): { integrated: number; lra: number; truePeak: number } {
  const run = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-af',
      'ebur128=peak=true:metadata=1,ametadata=print:file=-',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  );
  const last = (key: string) => {
    const matches = [
      ...run.stdout.matchAll(new RegExp(`lavfi\\.r128\\.${key}=(-?[\\d.]+|-?inf)`, 'g')),
    ];
    return Number(matches.at(-1)?.[1]);
  };
  const peak = /True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf)/.exec(run.stderr)?.[1];
  return { integrated: last('I'), lra: last('LRA'), truePeak: Number(peak) };
}
