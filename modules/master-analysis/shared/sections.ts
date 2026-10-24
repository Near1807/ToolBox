// Automatic split of a track into sections (intro, montée, drop, pause,
// outro…), from what changes over time: loudness, low and high bands, density,
// width. A starting point only: every boundary and name can be changed by hand.
import { BLOCK, type Analysis, type Section } from './types';
import { integrated, lufsOf } from './measures';

const SECOND = Math.round(1 / BLOCK);

interface Feature {
  loudness: number;
  low: number;
  high: number;
  density: number;
  width: number;
}

function featuresPerSecond(a: Analysis): Feature[] {
  const seconds = Math.floor(a.blocks / SECOND);
  const out: Feature[] = [];
  const level = (arrays: Float32Array[], f: number, t: number) => {
    let s = 0;
    for (const x of arrays) for (let i = f; i < t; i++) s += x[i]!;
    return Math.max(-90, 10 * Math.log10(s / (t - f) + 1e-12));
  };
  for (let s = 0; s < seconds; s++) {
    const f = s * SECOND;
    const t = f + SECOND;
    let p = 0;
    let mid = 0;
    let side = 0;
    let density = 0;
    for (let i = f; i < t; i++) {
      p += a.power[i]!;
      mid += a.mid[i]!;
      side += a.side[i]!;
      density += a.density[i]!;
    }
    out.push({
      loudness: Math.max(-70, lufsOf(p / SECOND) ?? -70),
      low: level([a.bandMid[0]!, a.bandSide[0]!, a.bandMid[1]!, a.bandSide[1]!], f, t),
      high: level([a.bandMid[5]!, a.bandSide[5]!, a.bandMid[6]!, a.bandSide[6]!], f, t),
      density: density / SECOND,
      width: mid + side > 0 ? side / (mid + side) : 0,
    });
  }
  return out;
}

const KEYS = ['loudness', 'low', 'high', 'density', 'width'] as const;
const WEIGHTS = { loudness: 1.5, low: 1.2, high: 1, density: 0.8, width: 0.5 };

/** Boundaries (seconds) where the features change the most. */
function boundaries(features: Feature[]): number[] {
  const n = features.length;
  if (n < 16) return [];
  const z = KEYS.map((key) => {
    const values = features.map((f) => f[key]);
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n) || 1;
    return values.map((v) => ((v - mean) / sd) * WEIGHTS[key]);
  });
  const K = 6;
  const novelty = new Array<number>(n).fill(0);
  for (let t = 4; t < n - 4; t++) {
    const k = Math.min(K, t, n - t);
    let distance = 0;
    for (const series of z) {
      let before = 0;
      let after = 0;
      for (let i = 1; i <= k; i++) {
        before += series[t - i]!;
        after += series[t + i - 1]!;
      }
      distance += ((after - before) / k) ** 2;
    }
    novelty[t] = Math.sqrt(distance);
  }
  const mean = novelty.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(novelty.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  const threshold = mean + 0.5 * sd;
  const peaks = [];
  for (let t = 4; t < n - 4; t++) {
    const v = novelty[t]!;
    if (v < threshold) continue;
    let isPeak = true;
    for (let i = Math.max(0, t - 4); i <= Math.min(n - 1, t + 4); i++)
      if (novelty[i]! > v || (novelty[i] === v && i < t)) isPeak = false;
    if (isPeak) peaks.push({ t, v });
  }
  // The strongest first, at least 6 s apart, at most 14 sections.
  const chosen: number[] = [];
  for (const p of peaks.sort((x, y) => y.v - x.v)) {
    if (chosen.length >= 13) break;
    if (chosen.every((c) => Math.abs(c - p.t) >= 6)) chosen.push(p.t);
  }
  return chosen.sort((x, y) => x - y);
}

/** Moves a boundary (seconds) to the strongest change of level within ±1 s (100 ms precision). */
function refine(a: Analysis, second: number): number {
  const around = (from: number, to: number) => {
    let s = 0;
    for (let i = Math.max(0, from); i < Math.min(a.blocks, to); i++) s += a.power[i]!;
    return 10 * Math.log10(s / Math.max(1, to - from) + 1e-12);
  };
  let best = second * SECOND;
  let bestJump = -1;
  for (let b = second * SECOND - SECOND; b <= second * SECOND + SECOND; b++) {
    if (b <= 3 || b >= a.blocks - 3) continue;
    const jump = Math.abs(around(b, b + 5) - around(b - 5, b));
    if (jump > bestJump) {
      bestJump = jump;
      best = b;
    }
  }
  return Math.round(best * BLOCK * 10) / 10;
}

/** Names given from the measures of each part (facts: louder, fuller, rising…). */
function label(a: Analysis, cuts: number[]): Section[] {
  const end = Math.round(a.blocks * BLOCK * 10) / 10;
  const edges = [0, ...cuts, end];
  const parts = edges.slice(0, -1).map((start, i) => {
    const stop = edges[i + 1]!;
    const f = Math.round(start / BLOCK);
    const t = Math.round(stop / BLOCK);
    const third = Math.max(1, Math.floor((t - f) / 3));
    const loud = integrated(a, f, t) ?? -70;
    const first = integrated(a, f, f + third) ?? -70;
    const last = integrated(a, t - third, t) ?? -70;
    let low = 0;
    for (const x of [a.bandMid[0]!, a.bandSide[0]!, a.bandMid[1]!, a.bandSide[1]!])
      for (let k = f; k < t; k++) low += x[k]!;
    return {
      start,
      end: stop,
      loud,
      rise: last - first,
      low: 10 * Math.log10(low / Math.max(1, t - f) + 1e-12),
    };
  });
  const track = integrated(a) ?? -70;
  const loudest = Math.max(...parts.map((p) => p.loud));
  const lowest = Math.max(...parts.map((p) => p.low));
  const names: string[] = parts.map((p, i) => {
    if (p.loud >= loudest - 1.5 && p.low >= lowest - 4 && p.loud >= track - 1) return 'Drop';
    if (i === 0 && p.loud < track - 3) return 'Intro';
    if (i === parts.length - 1 && parts.length > 1 && p.loud < track - 3) return 'Outro';
    return '';
  });
  parts.forEach((p, i) => {
    if (names[i]) return;
    if (names[i + 1] === 'Drop' && p.rise > 1.5) names[i] = 'Montée';
    else if (p.loud < track - 4) names[i] = 'Pause';
    else names[i] = 'Partie';
  });
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return parts.map((p, i) => {
    const name = names[i]!;
    const index = (seen.get(name) ?? 0) + 1;
    seen.set(name, index);
    return {
      start: p.start,
      end: p.end,
      label: (counts.get(name) ?? 0) > 1 ? `${name} ${index}` : name,
    };
  });
}

/** Slope (LU per second) of a least-squares line through values[from..to). */
function slope(values: number[], from: number, to: number): number {
  const n = to - from;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = from; i < to; i++) {
    const x = i - from;
    sx += x;
    sy += values[i]!;
    sxx += x * x;
    sxy += x * values[i]!;
  }
  const den = n * sxx - sx * sx;
  return den ? (n * sxy - sx * sy) / den : 0;
}

/**
 * A steady part followed by a long rise before a drop is one block for the
 * novelty (the rise grows into the drop): the start of the rise is looked for.
 */
function rampStart(loudness: number[], start: number, end: number): number | null {
  let best: { at: number; score: number } | null = null;
  for (let c = start + 3; c <= end - 3; c++) {
    const before = slope(loudness, start, c);
    const after = slope(loudness, c, end);
    const rise = after * (end - c);
    const flat = Math.abs(before * (c - start));
    if (rise < 4 || flat > 2) continue;
    const score = after - Math.abs(before);
    if (!best || score > best.score) best = { at: c, score };
  }
  return best?.at ?? null;
}

export function detectSections(a: Analysis): Section[] {
  const features = featuresPerSecond(a);
  const duration = a.blocks * BLOCK;
  const clean = (list: number[]) =>
    list
      .sort((x, y) => x - y)
      .filter((t, i, sorted) => t > 1 && t < duration - 1 && (i === 0 || t - sorted[i - 1]! >= 3));
  let cuts = clean(boundaries(features).map((s) => refine(a, s)));
  const first = label(a, cuts);
  const loudness = features.map((f) => f.loudness);
  const extra: number[] = [];
  first.forEach((section, i) => {
    const next = first[i + 1];
    if (!next?.label.startsWith('Drop') || section.label.startsWith('Montée')) return;
    if (section.end - section.start < 8) return;
    const at = rampStart(loudness, Math.ceil(section.start), Math.floor(section.end));
    if (at !== null) extra.push(at);
  });
  if (extra.length) cuts = clean([...cuts, ...extra]);
  return label(a, cuts);
}

/** Sections cleaned after an edit: sorted, inside the track, no gap and no overlap. */
export function normaliseSections(sections: Section[], duration: number): Section[] {
  const sorted = sections
    .map((s) => ({
      start: Math.max(0, Math.min(duration, Number(s.start))),
      end: Math.max(0, Math.min(duration, Number(s.end))),
      label:
        String(s.label ?? '')
          .trim()
          .slice(0, 40) || 'Partie',
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end))
    .sort((x, y) => x.start - y.start);
  if (sorted.length === 0) return [{ start: 0, end: duration, label: 'Morceau' }];
  sorted[0]!.start = 0;
  for (let i = 1; i < sorted.length; i++) sorted[i - 1]!.end = sorted[i]!.start;
  sorted.at(-1)!.end = duration;
  return sorted.filter((s) => s.end - s.start >= 0.1);
}
