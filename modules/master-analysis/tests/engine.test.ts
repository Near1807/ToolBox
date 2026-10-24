// The measures against signals whose properties are known, and against
// FFmpeg's ebur128 (integrated loudness, LRA, true peak within ±0.1).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyseFile } from '../backend/analyze';
import {
  abLevels,
  align,
  compareVersions,
  markers,
  measures,
  normalisation,
  parsePlatforms,
  DEFAULT_PLATFORMS,
} from '../shared/measures';
import { BLOCK, type Analysis } from '../shared/types';
import { ebur128, ffmpeg, ffprobe, noise, RATE, seconds, sine, writeWav } from './signals';

let dir: string;
const file = (name: string) => path.join(dir, name);
const analyse = (name: string) => analyseFile({ ffmpeg, ffprobe, file: file(name) });

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolbox-master-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('loudness and true peak, against ebur128 (±0.1)', () => {
  const cases: [string, () => void][] = [
    [
      'sine-1k.wav',
      () => {
        const s = sine(seconds(20), 997, 0.1);
        writeWav(file('sine-1k.wav'), [s, s]);
      },
    ],
    [
      'pink.wav',
      () => {
        const l = noise(seconds(20), 3, true);
        const r = noise(seconds(20), 4, true);
        writeWav(file('pink.wav'), [l, r], { bits: 24 });
      },
    ],
    [
      // Samples at ±0.707 of the amplitude: the true peak is 3 dB above the sample peak.
      'intersample.wav',
      () => {
        const s = sine(seconds(10), RATE / 4, 0.98, Math.PI / 4);
        writeWav(file('intersample.wav'), [s, s]);
      },
    ],
    [
      // Two levels (−20 then −30 LUFS): LRA ≈ 10 LU.
      'two-levels.wav',
      () => {
        const a = noise(seconds(15), 5, true);
        for (let i = seconds(7.5); i < a.length; i++) a[i]! *= 10 ** (-10 / 20);
        writeWav(file('two-levels.wav'), [a, a]);
      },
    ],
    ['mono.wav', () => writeWav(file('mono.wav'), [noise(seconds(12), 7, true)], { bits: 16 })],
    [
      'rate-44k.wav',
      () => {
        const s = noise(seconds(12, 44_100), 8, true);
        writeWav(file('rate-44k.wav'), [s, noise(seconds(12, 44_100), 9, true)], { rate: 44_100 });
      },
    ],
  ];
  for (const [name, make] of cases)
    it(name, async () => {
      make();
      const a = await analyse(name);
      const m = measures(a);
      const reference = ebur128(file(name));
      expect(Math.abs(m.integrated! - reference.integrated), 'integrated').toBeLessThanOrEqual(0.1);
      expect(Math.abs(m.lra! - reference.lra), 'LRA').toBeLessThanOrEqual(
        0.1 + (name === 'two-levels.wav' ? 0.1 : 0),
      );
      // ebur128 prints the true peak to 0.1 dB: ±0.1 plus its rounding.
      expect(Math.abs(m.truePeak! - reference.truePeak), 'true peak').toBeLessThanOrEqual(0.15);
    });

  it('true peak = the real peak of the signal, between samples, up to 19 kHz', async () => {
    // A sine at a quarter of the rate with its peaks halfway between samples:
    // sample peak 3 dB below the real peak.
    const m = measures(await analyse('intersample.wav'));
    expect(m.samplePeak!).toBeCloseTo(20 * Math.log10(0.98 * Math.SQRT1_2), 2);
    expect(m.truePeak!).toBeCloseTo(20 * Math.log10(0.98), 2);
    for (const frequency of [1000, 9000, 15000, 19000]) {
      const s = sine(seconds(3), frequency, 0.9, 0.3);
      writeWav(file(`tp-${frequency}.wav`), [s, s]);
      const tp = measures(await analyse(`tp-${frequency}.wav`)).truePeak!;
      expect(Math.abs(tp - 20 * Math.log10(0.9)), `${frequency} Hz`).toBeLessThan(0.01);
    }
  });

  it('a mono file is measured as mono (not 3 dB louder), with its format', async () => {
    const a = await analyse('mono.wav');
    expect(a.file).toMatchObject({
      channels: 1,
      sampleRate: 48_000,
      bitDepth: 16,
      codec: 'pcm_s16le',
    });
    expect(measures(a).correlation).toBe(1);
  });
});

describe('signals with known properties', () => {
  it('clipping at a precise time', async () => {
    const s = sine(seconds(10), 440, 0.5);
    const at = seconds(5);
    for (let i = at; i < at + 24; i++) s[i] = 1;
    writeWav(file('clip.wav'), [s, s]);
    const a = await analyse('clip.wav');
    expect(a.clipping.length).toBeGreaterThanOrEqual(1);
    expect(a.clipping[0]!.time).toBeCloseTo(5, 3);
    expect(a.clipping[0]!.samples).toBe(24);
    const clip = markers(a).find((m) => m.kind === 'clip')!;
    expect(clip.start).toBeCloseTo(5, 3);
    // The over above −1 dBTP is there too, at the same place.
    const over = markers(a, -1).find((m) => m.kind === 'over')!;
    expect(Math.abs(over.start - 5)).toBeLessThan(0.02);
  });

  it('phase opposition: correlation −1, mono sum empty, marker over the whole file', async () => {
    const l = noise(seconds(6), 11, true);
    const r = l.map((x) => -x);
    writeWav(file('phase.wav'), [l, r]);
    const a = await analyse('phase.wav');
    const m = measures(a);
    expect(m.correlation!).toBeCloseTo(-1, 3);
    expect(m.width!).toBeCloseTo(1, 3);
    expect(m.monoLoss === null || m.monoLoss < -60).toBe(true);
    const phase = markers(a).filter((x) => x.kind === 'phase');
    expect(phase).toHaveLength(1);
    expect(phase[0]!.end - phase[0]!.start).toBeGreaterThan(5.5);
  });

  it('uncorrelated channels: width 0.5, mono sum −3 dB; identical: width 0, 0 dB', async () => {
    writeWav(file('wide.wav'), [noise(seconds(6), 12, true), noise(seconds(6), 13, true)]);
    const wide = measures(await analyse('wide.wav'));
    expect(wide.width!).toBeCloseTo(0.5, 1);
    expect(wide.monoLoss!).toBeCloseTo(-3, 0);
    const same = measures(await analyse('pink.wav'));
    expect(same.width!).toBeCloseTo(0.5, 1);
    const centre = measures(await analyse('sine-1k.wav'));
    expect(centre.width!).toBeLessThan(1e-6);
    expect(centre.monoLoss!).toBeCloseTo(0, 5);
  });

  it('DC offset', async () => {
    const s = sine(seconds(5), 220, 0.3).map((x) => x + 0.05);
    writeWav(file('dc.wav'), [s, s]);
    const a = await analyse('dc.wav');
    expect(a.dc[0]!).toBeCloseTo(0.05, 3);
    expect(a.dc[1]!).toBeCloseTo(0.05, 3);
  });

  it('silences at the start and the end', async () => {
    const n = noise(seconds(11), 14, true);
    n.fill(0, 0, seconds(2));
    n.fill(0, seconds(8));
    writeWav(file('silences.wav'), [n, n]);
    const a = await analyse('silences.wav');
    expect(a.leadingSilence).toBeCloseTo(2, 2);
    expect(a.trailingSilence).toBeCloseTo(3, 2);
    const silences = markers(a).filter((m) => m.kind === 'silence');
    expect(
      silences.map((s) => [Math.round(s.start * 10) / 10, Math.round(s.end * 10) / 10]),
    ).toEqual([
      [0, 2],
      [8, 11],
    ]);
  });

  it('pink noise: flat in thirds of an octave (equal energy per band)', async () => {
    const a = await analyse('pink.wav');
    const thirds = a.thirdOctave.filter((t) => t.f >= 100 && t.f <= 10_000).map((t) => t.db);
    expect(Math.max(...thirds) - Math.min(...thirds)).toBeLessThan(3);
    // White noise rises 1 dB per third of an octave (3 dB per octave).
    writeWav(
      file('white.wav'),
      [noise(seconds(10), 21), noise(seconds(10), 22)].map((x) => x.map((v) => v * 0.3)),
    );
    const w = (await analyse('white.wav')).thirdOctave;
    const at = (f: number) => w.find((t) => t.f === f)!.db;
    expect(at(8000) - at(1000)).toBeCloseTo(9, 0);
  });

  it('a build-up and a drop: sections found where they are', async () => {
    const total = seconds(40);
    const l = new Float32Array(total);
    const r = new Float32Array(total);
    const nl = noise(total, 31, true);
    const nr = noise(total, 32, true);
    const sub = sine(total, 50, 1);
    for (let i = 0; i < total; i++) {
      const t = i / RATE;
      let gain: number;
      let bass = 0;
      if (t < 8) gain = 0.03;
      else if (t < 16) gain = 0.03 * 10 ** ((((t - 8) / 8) * 20) / 20);
      else if (t < 32) {
        gain = 0.4;
        bass = 0.4;
      } else gain = 0.03;
      l[i] = nl[i]! * gain + sub[i]! * bass;
      r[i] = nr[i]! * gain + sub[i]! * bass;
    }
    writeWav(file('drop.wav'), [l, r]);
    const a = await analyse('drop.wav');
    const sections = a.sectionsAuto;
    expect(sections.map((s) => s.label)).toEqual(['Intro', 'Montée', 'Drop', 'Outro']);
    expect(Math.abs(sections[1]!.start - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(sections[2]!.start - 16)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(sections[3]!.start - 32)).toBeLessThanOrEqual(0.2);
    // The drop has the sub, the intro not.
    const drop = measures(a, sections[2]!.start / BLOCK, sections[2]!.end / BLOCK);
    const intro = measures(a, 0, sections[0]!.end / BLOCK);
    expect(drop.bands[0]!.db! - intro.bands[0]!.db!).toBeGreaterThan(20);
  });

  it('two versions with a known difference: offset and sub +6 dB found', async () => {
    const total = seconds(30);
    const delay = seconds(0.5);
    const music = noise(total, 41, true);
    const sub = sine(total, 45, 1);
    // Bursts every 0.75 s give the alignment something to hold.
    const shape = (i: number) => (Math.floor(i / seconds(0.75)) % 3 === 0 ? 1 : 0.3);
    const v1 = Float32Array.from(
      { length: total },
      (_, i) => 0.2 * music[i]! * shape(i) + 0.05 * sub[i]!,
    );
    const v2 = new Float32Array(total + delay);
    for (let i = 0; i < total; i++) v2[i + delay] = 0.2 * music[i]! * shape(i) + 0.1 * sub[i]!;
    writeWav(file('v1.wav'), [v1, v1]);
    writeWav(file('v2.wav'), [v2, v2]);
    const a = await analyse('v1.wav');
    const b = await analyse('v2.wav');
    const alignment = align(a, b);
    expect(alignment.offset).toBeCloseTo(0.5, 2);
    const comparison = compareVersions(a, b, alignment.offset, [
      { start: 0, end: 30, label: 'Morceau' },
    ]);
    const subDifference = comparison.sections[0]!.difference.bands[0]!.db!;
    expect(subDifference).toBeCloseTo(6, 0);
    expect(Math.abs(comparison.sections[0]!.difference.bands[3]!.db!)).toBeLessThan(0.5);
  });
});

describe('platform normalisation', () => {
  it('turns down, turns up only as far as the ceiling, never up where the service does not', () => {
    const m = { integrated: -9, truePeak: -0.2 } as ReturnType<typeof measures>;
    const platforms = parsePlatforms(DEFAULT_PLATFORMS);
    expect(platforms.map((p) => p.name)).toEqual([
      'Spotify',
      'YouTube',
      'Apple Music',
      'SoundCloud',
      'Deezer',
    ]);
    const loud = normalisation(m, platforms);
    expect(loud.find((p) => p.name === 'Spotify')).toMatchObject({ gain: -5, result: -14 });
    expect(loud.find((p) => p.name === 'Apple Music')!.gain).toBe(-7);
    const quiet = normalisation({ integrated: -20, truePeak: -5 } as never, platforms);
    // Spotify: up to −16 only (true peak −5 → −1 dBTP: 4 dB of room).
    expect(quiet.find((p) => p.name === 'Spotify')).toMatchObject({ gain: 4, result: -16 });
    expect(quiet.find((p) => p.name === 'YouTube')).toMatchObject({ gain: 0, result: -20 });
  });

  it('the setting is read leniently', () => {
    expect(parsePlatforms('Tidal:-14:down; faux; Qobuz:-16')).toEqual([
      { name: 'Tidal', target: -14, mode: 'down', ceiling: -1 },
      { name: 'Qobuz', target: -16, mode: 'both', ceiling: -1 },
    ]);
  });
});

export type { Analysis };

describe('A/B playback levels', () => {
  it('only the louder side is turned down, never up', () => {
    expect(abLevels(-3.5)).toEqual({ master: 0, reference: -3.5 });
    expect(abLevels(2)).toEqual({ master: -2, reference: 0 });
    expect(abLevels(0)).toEqual({ master: 0, reference: 0 });
    expect(abLevels(Number.NaN)).toEqual({ master: 0, reference: 0 });
  });
});
