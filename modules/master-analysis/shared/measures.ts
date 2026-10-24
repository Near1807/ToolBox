// Measures computed from an analysis, for the whole file or any part of it
// (sections, comparison windows): the same code on the backend (summaries,
// assistant, export) and in the interface (sections edited by hand, zoom).
// Informative only: numbers and differences, never an opinion.
import {
  BANDS,
  BLOCK,
  FINE,
  type Analysis,
  type Marker,
  type Measures,
  type Platform,
  type PlatformResult,
  type Section,
} from './types';

export const lufsOf = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : null);
export const dbOf = (power: number) => (power > 0 ? 10 * Math.log10(power) : null);
export const dbAmpOf = (amplitude: number) => (amplitude > 0 ? 20 * Math.log10(amplitude) : null);

const clampRange = (a: Analysis, from: number, to: number): [number, number] => [
  Math.max(0, Math.min(a.blocks, Math.floor(from))),
  Math.max(0, Math.min(a.blocks, Math.ceil(to))),
];

/** Mean of `power[i-k+1..i]` (sliding window of k blocks), for i from k-1. */
function windows(power: Float32Array, from: number, to: number, k: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = from; i < to; i++) {
    sum += power[i]!;
    if (i - from >= k) sum -= power[i - k]!;
    if (i - from >= k - 1) out.push(sum / k);
  }
  return out;
}

/** Integrated loudness (BS.1770-4): 400 ms blocks, 75 % overlap, gates −70 LUFS and −10 LU. */
export function integrated(a: Analysis, from = 0, to = a.blocks): number | null {
  const [f, t] = clampRange(a, from, to);
  const blocks = windows(a.power, f, t, 4).filter((z) => (lufsOf(z) ?? -Infinity) > -70);
  if (blocks.length === 0) return null;
  const relative = (lufsOf(blocks.reduce((s, z) => s + z, 0) / blocks.length) ?? -Infinity) - 10;
  const gated = blocks.filter((z) => (lufsOf(z) ?? -Infinity) > relative);
  return gated.length ? lufsOf(gated.reduce((s, z) => s + z, 0) / gated.length) : null;
}

/** Loudness range (EBU Tech 3342): short-term 3 s, gates −70 LUFS and −20 LU, P95 − P10. */
export function loudnessRange(a: Analysis, from = 0, to = a.blocks): number | null {
  const [f, t] = clampRange(a, from, to);
  const shortTerm = windows(a.power, f, t, 30).filter((z) => (lufsOf(z) ?? -Infinity) > -70);
  if (shortTerm.length < 2) return null;
  const relative = (lufsOf(shortTerm.reduce((s, z) => s + z, 0) / shortTerm.length) ?? 0) - 20;
  const values = shortTerm
    .map((z) => lufsOf(z)!)
    .filter((l) => l > relative)
    .sort((x, y) => x - y);
  if (values.length < 2) return 0;
  const at = (p: number) => {
    const position = (values.length - 1) * p;
    const lo = Math.floor(position);
    const hi = Math.min(values.length - 1, lo + 1);
    return values[lo]! + (values[hi]! - values[lo]!) * (position - lo);
  };
  return at(0.95) - at(0.1);
}

/** Momentary (400 ms) or short-term (3 s) loudness at each block (null before the window is full or in silence). */
export function loudnessCurve(a: Analysis, window: 'momentary' | 'short'): (number | null)[] {
  const k = window === 'momentary' ? 4 : 30;
  const values = windows(a.power, 0, a.blocks, k).map((z) => {
    const l = lufsOf(z);
    return l === null || l < -70 ? null : l;
  });
  return [...Array<null>(Math.min(a.blocks, k - 1)).fill(null), ...values];
}

const sumRange = (array: Float32Array, f: number, t: number) => {
  let s = 0;
  for (let i = f; i < t; i++) s += array[i]!;
  return s;
};
const maxRange = (array: Float32Array, f: number, t: number) => {
  let m = 0;
  for (let i = f; i < t; i++) if (array[i]! > m) m = array[i]!;
  return m;
};

/** Every global measure, for blocks [from, to). */
export function measures(a: Analysis, from = 0, to = a.blocks): Measures {
  const [f, t] = clampRange(a, from, to);
  const n = Math.max(1, t - f);
  const whole = f === 0 && t === a.blocks;
  const integratedValue = integrated(a, f, t);
  const tp = whole ? a.truePeakMax : maxRange(a.truePeak, f, t);
  const sp = whole ? a.samplePeak : maxRange(a.peak, f, t);
  const meanSquare = sumRange(a.meanSquare, f, t) / n;
  const rms = dbOf(meanSquare);
  const mid = sumRange(a.mid, f, t);
  const side = sumRange(a.side, f, t);
  // Correlation weighted by the energy of the blocks (silence does not count).
  let weighted = 0;
  let weights = 0;
  for (let i = f; i < t; i++) {
    const w = a.meanSquare[i]!;
    if (w <= 1e-10) continue;
    weighted += a.correlation[i]! * w;
    weights += w;
  }
  const bandTotals = BANDS.map((_, b) => ({
    mid: sumRange(a.bandMid[b]!, f, t) / n,
    side: sumRange(a.bandSide[b]!, f, t) / n,
  }));
  return {
    integrated: integratedValue,
    lra: loudnessRange(a, f, t),
    truePeak: dbAmpOf(tp),
    samplePeak: dbAmpOf(sp),
    plr: integratedValue !== null && tp > 0 ? dbAmpOf(tp)! - integratedValue : null,
    crest: rms !== null && sp > 0 ? dbAmpOf(sp)! - rms : null,
    rms,
    correlation: weights > 0 ? weighted / weights : null,
    width: mid + side > 0 ? side / (mid + side) : null,
    monoLoss: mid + side > 0 ? dbOf(mid / (mid + side)) : null,
    bands: BANDS.map((band, b) => {
      const { mid: bm, side: bs } = bandTotals[b]!;
      const level = dbOf(bm + bs);
      return {
        id: band.id,
        db: level,
        relative: level !== null && integratedValue !== null ? level - integratedValue : null,
        width: bm + bs > 0 ? bs / (bm + bs) : null,
        monoLoss: bm + bs > 0 ? dbOf(bm / (bm + bs)) : null,
      };
    }),
    density: sumRange(a.density, f, t) / n,
  };
}

/** Blocks of a time range (seconds). */
export const blocksOf = (start: number, end: number): [number, number] => [
  Math.round(start / BLOCK),
  Math.round(end / BLOCK),
];

/**
 * Markers of the timeline: true peak above `threshold` (dBTP), clipping,
 * phase problems (correlation below −0.2 for 300 ms with sound), silences
 * (below −60 dBFS for at least 500 ms).
 */
export function markers(a: Analysis, threshold = -1): Marker[] {
  const list: Marker[] = [];
  const limit = 10 ** (threshold / 20);
  let start = -1;
  let max = 0;
  const fine = a.truePeakFine;
  for (let i = 0; i <= fine.length; i++) {
    const v = i < fine.length ? fine[i]! : 0;
    if (v > limit) {
      if (start < 0) start = i;
      if (v > max) max = v;
    } else if (start >= 0) {
      const last = list.at(-1);
      // Overs closer than 50 ms are one.
      if (last?.kind === 'over' && start * FINE - last.end < 0.05) {
        last.end = i * FINE;
        last.value = Math.max(last.value!, dbAmpOf(max)!);
      } else list.push({ kind: 'over', start: start * FINE, end: i * FINE, value: dbAmpOf(max) });
      start = -1;
      max = 0;
    }
  }
  for (const c of a.clipping)
    list.push({
      kind: 'clip',
      start: c.time,
      end: c.time + Math.max(FINE, c.samples / a.file.sampleRate),
      value: c.samples,
      channel: c.channel,
    });
  const runs = (
    test: (i: number) => boolean,
    min: number,
    kind: Marker['kind'],
    value: (f: number, t: number) => number | null,
  ) => {
    let s = -1;
    for (let i = 0; i <= a.blocks; i++) {
      if (i < a.blocks && test(i)) {
        if (s < 0) s = i;
      } else if (s >= 0) {
        if ((i - s) * BLOCK >= min)
          list.push({ kind, start: s * BLOCK, end: i * BLOCK, value: value(s, i) });
        s = -1;
      }
    }
  };
  if (a.file.analysedChannels === 2)
    runs(
      (i) => a.correlation[i]! < -0.2 && a.meanSquare[i]! > 1e-4,
      0.3,
      'phase',
      (f, t) => {
        let m = 1;
        for (let i = f; i < t; i++) m = Math.min(m, a.correlation[i]!);
        return m;
      },
    );
  runs(
    (i) => a.meanSquare[i]! < 1e-6 && a.peak[i]! < 0.001,
    0.5,
    'silence',
    () => null,
  );
  return list.sort((x, y) => x.start - y.start);
}

/**
 * Platform normalisation: the gain each service applies at playback (it never
 * changes the file). Turned down above the target; turned up below it only on
 * services that do, and only as far as the true peak stays under the ceiling.
 */
export function normalisation(m: Measures, platforms: Platform[]): PlatformResult[] {
  return platforms.map((p) => {
    if (m.integrated === null)
      return { ...p, gain: 0, result: 0, note: 'mesure impossible (silence)' };
    const wanted = p.target - m.integrated;
    let gain = wanted;
    let note: string;
    if (wanted < 0) note = 'baissé';
    else if (p.mode === 'down') {
      gain = 0;
      note = 'jamais monté sur ce service';
    } else {
      const room = m.truePeak === null ? wanted : p.ceiling - m.truePeak;
      gain = Math.max(0, Math.min(wanted, room));
      note = gain < wanted ? `monté, limité par la crête (${p.ceiling} dBTP)` : 'monté';
    }
    if (Math.abs(wanted) < 0.05) note = 'déjà au niveau visé';
    return { ...p, gain, result: m.integrated + gain, note };
  });
}

/**
 * Platforms from the setting « Nom:cible:mode:plafond; … » (mode « both » or
 * « down »). Invalid entries are skipped.
 */
export function parsePlatforms(text: string): Platform[] {
  return text
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, target, mode, ceiling] = entry.split(':').map((s) => s.trim());
      return {
        name: name ?? '',
        target: Number(target),
        mode: mode === 'down' ? ('down' as const) : ('both' as const),
        ceiling: ceiling !== undefined && ceiling !== '' ? Number(ceiling) : -1,
      };
    })
    .filter((p) => p.name && Number.isFinite(p.target) && Number.isFinite(p.ceiling));
}

/**
 * Default targets. Spotify (−14, both ways, 1 dB kept for lossy codecs) and
 * SoundCloud (−14) are stated in their help pages; YouTube (−14, only down),
 * Apple Music (−16, Sound Check) and Deezer (−15) are not published officially
 * and come from measures of the trade: they can be changed in the settings.
 */
export const DEFAULT_PLATFORMS =
  'Spotify:-14:both:-1; YouTube:-14:down:-1; Apple Music:-16:both:-1; SoundCloud:-14:both:-1; Deezer:-15:down:-1';

/** Per-block series for the timeline. */
export function bandCurve(a: Analysis, band: number, smooth = 5): (number | null)[] {
  const out: (number | null)[] = [];
  const m = a.bandMid[band]!;
  const s = a.bandSide[band]!;
  let sum = 0;
  for (let i = 0; i < a.blocks; i++) {
    sum += m[i]! + s[i]!;
    if (i >= smooth) sum -= m[i - smooth]! + s[i - smooth]!;
    const v = sum / Math.min(i + 1, smooth);
    const d = dbOf(v);
    out.push(d === null || d < -100 ? null : d);
  }
  return out;
}

export function widthCurve(a: Analysis, band: number | null, smooth = 5): (number | null)[] {
  const m = band === null ? a.mid : a.bandMid[band]!;
  const s = band === null ? a.side : a.bandSide[band]!;
  const out: (number | null)[] = [];
  let sm = 0;
  let ss = 0;
  for (let i = 0; i < a.blocks; i++) {
    sm += m[i]!;
    ss += s[i]!;
    if (i >= smooth) {
      sm -= m[i - smooth]!;
      ss -= s[i - smooth]!;
    }
    out.push(sm + ss > 1e-9 ? ss / (sm + ss) : null);
  }
  return out;
}

export function monoLossCurve(a: Analysis, smooth = 5): (number | null)[] {
  return widthCurve(a, null, smooth).map((w) => (w === null ? null : dbOf(1 - w)));
}

/** Crest factor over 1 s (sample peak − RMS) and PLR over 3 s (true peak − short-term loudness). */
export function dynamicsCurves(a: Analysis): { crest: (number | null)[]; plr: (number | null)[] } {
  const crest: (number | null)[] = [];
  const plr: (number | null)[] = [];
  const short = loudnessCurve(a, 'short');
  for (let i = 0; i < a.blocks; i++) {
    const f1 = Math.max(0, i - 9);
    const ms = sumRange(a.meanSquare, f1, i + 1) / (i + 1 - f1);
    const pk = maxRange(a.peak, f1, i + 1);
    crest.push(ms > 1e-9 && pk > 0 ? dbAmpOf(pk)! - dbOf(ms)! : null);
    const f3 = Math.max(0, i - 29);
    const tp = maxRange(a.truePeak, f3, i + 1);
    plr.push(short[i] !== null && tp > 0 ? dbAmpOf(tp)! - short[i]! : null);
  }
  return { crest, plr };
}

/** Measures of each section, and how each one differs from the whole track. */
export function sectionMeasures(a: Analysis, sections: Section[]) {
  const whole = measures(a);
  return sections.map((s) => {
    const [f, t] = blocksOf(s.start, s.end);
    const m = measures(a, f, t);
    return {
      section: s,
      measures: m,
      vsTrack: difference(whole, m),
    };
  });
}

/** b − a for every number of the measures (null when either is missing). */
export function difference(a: Measures, b: Measures) {
  const d = (x: number | null, y: number | null) => (x === null || y === null ? null : y - x);
  return {
    integrated: d(a.integrated, b.integrated),
    lra: d(a.lra, b.lra),
    truePeak: d(a.truePeak, b.truePeak),
    plr: d(a.plr, b.plr),
    crest: d(a.crest, b.crest),
    correlation: d(a.correlation, b.correlation),
    width: d(a.width, b.width),
    monoLoss: d(a.monoLoss, b.monoLoss),
    density: d(a.density, b.density),
    bands: a.bands.map((band, i) => ({
      id: band.id,
      db: d(band.db, b.bands[i]!.db),
      relative: d(band.relative, b.bands[i]!.relative),
      width: d(band.width, b.bands[i]!.width),
    })),
  };
}
export type Difference = ReturnType<typeof difference>;

/** Loudness envelope in dB (−70 floor), z-scored, for the alignment. */
function envelope(power: Float32Array, k: number): Float64Array {
  const values = windows(power, 0, power.length, k).map((z) => Math.max(-70, lufsOf(z) ?? -70));
  const mean = values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
  const sd =
    Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, values.length)) || 1;
  return Float64Array.from(values, (v) => (v - mean) / sd);
}

/** Lag of y against x with the highest Pearson correlation over their overlap (at least half). */
function bestLag(x: Float64Array, y: Float64Array, from: number, to: number) {
  let best = { lag: 0, score: -Infinity };
  for (let lag = from; lag <= to; lag++) {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let count = 0;
    for (let i = Math.max(0, -lag); i < x.length && i + lag < y.length; i++) {
      const u = x[i]!;
      const v = y[i + lag]!;
      sx += u;
      sy += v;
      sxx += u * u;
      syy += v * v;
      sxy += u * v;
      count++;
    }
    if (count < Math.min(x.length, y.length) * 0.5) continue;
    const cov = sxy - (sx * sy) / count;
    const den = Math.sqrt((sxx - (sx * sx) / count) * (syy - (sy * sy) / count));
    // A slight preference for small offsets when two lags are as good (repetitive music).
    const score = (den > 0 ? cov / den : 0) - Math.abs(lag) * 1e-5;
    if (score > best.score) best = { lag, score };
  }
  return best;
}

/**
 * Time offset of version b against version a (seconds; b at t + offset
 * sounds like a at t): cross-correlation of the loudness envelopes at 100 ms,
 * refined at 10 ms on the waveform envelope. `confidence`: 0…1.
 */
export function align(
  a: Analysis,
  b: Analysis,
  maxSeconds = 30,
): { offset: number; confidence: number } {
  const ea = envelope(a.power, 2);
  const eb = envelope(b.power, 2);
  const range = Math.round(maxSeconds / BLOCK);
  const coarse = bestLag(ea, eb, -range, range);
  const fineOf = (x: Analysis) => {
    const v = Float64Array.from(x.waveMax, (hi, i) =>
      Math.max(-70, dbAmpOf(Math.max(hi, -x.waveMin[i]!)) ?? -70),
    );
    const mean = v.reduce((s, y) => s + y, 0) / Math.max(1, v.length);
    const sd = Math.sqrt(v.reduce((s, y) => s + (y - mean) ** 2, 0) / Math.max(1, v.length)) || 1;
    return v.map((y) => (y - mean) / sd);
  };
  const fa = fineOf(a);
  const fb = fineOf(b);
  const centre = Math.round((coarse.lag * BLOCK) / FINE);
  const fine = bestLag(fa, fb, centre - 15, centre + 15);
  return {
    offset: Math.round(fine.lag * FINE * 1000) / 1000,
    confidence: Math.max(0, Math.min(1, coarse.score)),
  };
}

/**
 * Differences over time between two versions (b − a, b shifted by `offset`):
 * per second, the loudness and each band (dB). Null where either is silent.
 */
export function differenceMap(a: Analysis, b: Analysis, offset: number) {
  const seconds = Math.floor(a.blocks * BLOCK);
  const shift = Math.round(offset / BLOCK);
  const level = (x: Analysis, f: number, t: number, band: number | null) => {
    if (f < 0 || t > x.blocks || t <= f) return null;
    if (band === null) {
      const p = sumRange(x.power, f, t) / (t - f);
      const l = lufsOf(p);
      return l !== null && l > -70 ? l : null;
    }
    const p = (sumRange(x.bandMid[band]!, f, t) + sumRange(x.bandSide[band]!, f, t)) / (t - f);
    const d = dbOf(p);
    return d !== null && d > -90 ? d : null;
  };
  const cell = (s: number, band: number | null) => {
    const f = Math.round(s / BLOCK);
    const t = f + 10;
    const va = level(a, f, t, band);
    const vb = level(b, f + shift, t + shift, band);
    return va === null || vb === null ? null : vb - va;
  };
  return {
    seconds,
    loudness: Array.from({ length: seconds }, (_, s) => cell(s, null)),
    bands: BANDS.map((_, band) => Array.from({ length: seconds }, (__, s) => cell(s, band))),
  };
}

/** Version comparison: global, per section of a (b shifted by the offset), over time. */
export function compareVersions(a: Analysis, b: Analysis, offset: number, sections: Section[]) {
  const shift = Math.round(offset / BLOCK);
  return {
    offset,
    global: difference(measures(a), measures(b)),
    sections: sections.map((s) => {
      const [f, t] = blocksOf(s.start, s.end);
      return {
        section: s,
        difference: difference(measures(a, f, t), measures(b, f + shift, t + shift)),
      };
    }),
    map: differenceMap(a, b, offset),
  };
}

/**
 * Comparison with references at equal loudness: the levels of the
 * references are brought to the loudness of the track (only for the
 * comparison). Tonal balance per band and third of an octave, per section
 * (a section of the reference with the same name, otherwise its whole), global.
 */
export function compareReferences(
  track: { analysis: Analysis; sections: Section[] },
  references: { name: string; analysis: Analysis; sections: Section[] }[],
) {
  const m = measures(track.analysis);
  const refs = references.map((r) => ({ name: r.name, measures: measures(r.analysis), r }));
  const mean = (values: (number | null)[]) => {
    const v = values.filter((x): x is number => x !== null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const relativeBand = (x: Measures, b: number) => x.bands[b]!.relative;
  const third = track.analysis.thirdOctave.map((p, i) => {
    const own = m.integrated === null ? null : p.db - m.integrated;
    const others = mean(
      refs.map((r) => {
        const q = r.r.analysis.thirdOctave[i];
        return q && r.measures.integrated !== null ? q.db - r.measures.integrated : null;
      }),
    );
    return {
      f: p.f,
      track: own,
      references: others,
      difference: own !== null && others !== null ? own - others : null,
    };
  });
  return {
    gainToMatch: refs.map((r) => ({
      name: r.name,
      // Playback gain of the reference for A/B at equal loudness (only the reference's playback).
      gain:
        m.integrated !== null && r.measures.integrated !== null
          ? m.integrated - r.measures.integrated
          : 0,
    })),
    global: {
      track: m,
      references: refs.map((r) => ({ name: r.name, measures: r.measures })),
      lra: { track: m.lra, references: mean(refs.map((r) => r.measures.lra)) },
      plr: { track: m.plr, references: mean(refs.map((r) => r.measures.plr)) },
      width: { track: m.width, references: mean(refs.map((r) => r.measures.width)) },
      correlation: {
        track: m.correlation,
        references: mean(refs.map((r) => r.measures.correlation)),
      },
      integrated: { track: m.integrated, references: mean(refs.map((r) => r.measures.integrated)) },
      truePeak: { track: m.truePeak, references: mean(refs.map((r) => r.measures.truePeak)) },
    },
    bands: BANDS.map((band, b) => {
      const own = relativeBand(m, b);
      const others = mean(refs.map((r) => relativeBand(r.measures, b)));
      return {
        id: band.id,
        label: band.label,
        track: own,
        references: others,
        difference: own !== null && others !== null ? own - others : null,
      };
    }),
    thirdOctave: third,
    sections: track.sections.map((s) => {
      const [f, t] = blocksOf(s.start, s.end);
      const own = measures(track.analysis, f, t);
      const others = refs.map((r) => {
        const same = r.r.sections.find((x) => x.label.toLowerCase() === s.label.toLowerCase());
        if (!same) return r.measures;
        const [rf, rt] = blocksOf(same.start, same.end);
        return measures(r.r.analysis, rf, rt);
      });
      return {
        section: s,
        integrated: { track: own.integrated, references: mean(others.map((o) => o.integrated)) },
        width: { track: own.width, references: mean(others.map((o) => o.width)) },
        plr: { track: own.plr, references: mean(others.map((o) => o.plr)) },
        bands: BANDS.map((band, b) => {
          const x = own.bands[b]!.relative;
          const y = mean(others.map((o) => o.bands[b]!.relative));
          return { id: band.id, difference: x !== null && y !== null ? x - y : null };
        }),
      };
    }),
  };
}

/**
 * Playback levels (dB, ≤ 0) for the A/B: `gain` is what the reference would
 * need to reach the master's loudness; the louder side is lowered instead.
 */
export function abLevels(gain: number): { master: number; reference: number } {
  if (!Number.isFinite(gain)) return { master: 0, reference: 0 };
  return gain > 0 ? { master: -gain, reference: 0 } : { master: 0, reference: gain };
}
