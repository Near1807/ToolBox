// Statistics for small samples (a personal channel has a few dozen videos):
// non-parametric tests, bootstrap intervals, permutation p-values, robust
// anomaly detection, and the three confidence tiers shown everywhere.
// Pure functions, deterministic (seeded random numbers): same data, same answer.
import type { Confidence, Tier } from '../shared';

/** Small, fast, seeded random generator (mulberry32). */
export function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function mean(values: number[]): number {
  return values.length ? sum(values) / values.length : NaN;
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

/** Standard normal cumulative distribution (Abramowitz–Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const erf =
    1 -
    t *
      (0.254829592 +
        t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Average ranks (ties share their mean rank), 1-based. */
export function ranks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) result[order[k]!.index] = rank;
    i = j + 1;
  }
  return result;
}

export interface MannWhitney {
  u: number;
  /** Two-sided, normal approximation with tie and continuity corrections. */
  p: number;
  /** Rank-biserial correlation: +1 = every A above every B, -1 = the opposite. */
  r: number;
}

/** Mann-Whitney U test: are values of A generally higher than those of B? */
export function mannWhitney(a: number[], b: number[]): MannWhitney {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) return { u: NaN, p: 1, r: 0 };
  const all = ranks([...a, ...b]);
  const r1 = sum(all.slice(0, n1));
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const n = n1 + n2;
  // Tie correction of the variance.
  const counts = new Map<number, number>();
  for (const v of [...a, ...b]) counts.set(v, (counts.get(v) ?? 0) + 1);
  let ties = 0;
  for (const t of counts.values()) ties += t ** 3 - t;
  const variance = ((n1 * n2) / 12) * (n + 1 - ties / (n * (n - 1)));
  const meanU = (n1 * n2) / 2;
  if (variance <= 0) return { u: u1, p: 1, r: 0 };
  const z = (Math.abs(u1 - meanU) - 0.5) / Math.sqrt(variance);
  const p = Math.min(1, 2 * (1 - normalCdf(Math.max(0, z))));
  return { u: u1, p, r: (2 * u1) / (n1 * n2) - 1 };
}

export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

export interface Correlation {
  rho: number;
  /** Two-sided permutation p-value. */
  p: number;
  n: number;
  /** 95 % bootstrap interval of rho. */
  ci: [number, number] | null;
}

/** Spearman rank correlation, permutation p-value and bootstrap interval. */
export function spearman(x: number[], y: number[], seed = 7, iterations = 2000): Correlation {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { rho: NaN, p: 1, n, ci: null };
  const rx = ranks(x.slice(0, n));
  const ry = ranks(y.slice(0, n));
  const rho = pearson(rx, ry);
  if (!Number.isFinite(rho)) return { rho: 0, p: 1, n, ci: null };
  const random = rng(seed);
  let extreme = 0;
  const shuffled = [...ry];
  for (let i = 0; i < iterations; i++) {
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1));
      [shuffled[k], shuffled[j]] = [shuffled[j]!, shuffled[k]!];
    }
    if (Math.abs(pearson(rx, shuffled)) >= Math.abs(rho) - 1e-12) extreme++;
  }
  const boot: number[] = [];
  for (let i = 0; i < iterations / 2; i++) {
    const idx = Array.from({ length: n }, () => Math.floor(random() * n));
    const value = pearson(ranks(idx.map((k) => x[k]!)), ranks(idx.map((k) => y[k]!)));
    if (Number.isFinite(value)) boot.push(value);
  }
  return {
    rho,
    p: (extreme + 1) / (iterations + 1),
    n,
    ci: boot.length > 20 ? [quantile(boot, 0.025), quantile(boot, 0.975)] : null,
  };
}

export interface BootstrapDiff {
  /** statistic(A) − statistic(B) (or ratio when `ratio`). */
  estimate: number;
  ci95: [number, number];
  ci80: [number, number];
}

/**
 * Percentile bootstrap of the difference of medians (or of their ratio) of
 * two independent samples.
 */
export function bootstrapDiff(
  a: number[],
  b: number[],
  options: { ratio?: boolean; seed?: number; iterations?: number } = {},
): BootstrapDiff | null {
  if (a.length < 2 || b.length < 2) return null;
  const random = rng(options.seed ?? 11);
  const iterations = options.iterations ?? 2000;
  const compare = (x: number, y: number) => (options.ratio ? (y > 0 ? x / y : NaN) : x - y);
  const resample = (values: number[]) =>
    median(
      Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]!),
    );
  const values: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const value = compare(resample(a), resample(b));
    if (Number.isFinite(value)) values.push(value);
  }
  if (values.length < iterations / 2) return null;
  return {
    estimate: compare(median(a), median(b)),
    ci95: [quantile(values, 0.025), quantile(values, 0.975)],
    ci80: [quantile(values, 0.1), quantile(values, 0.9)],
  };
}

/** Holm–Bonferroni: adjusted p-values for a family of tests (same order). */
export function holm(pValues: number[]): number[] {
  const order = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(pValues.length);
  let previous = 0;
  order.forEach(({ p, index }, rank) => {
    const value = Math.min(1, Math.max(previous, p * (order.length - rank)));
    adjusted[index] = value;
    previous = value;
  });
  return adjusted;
}

// ---------------------------------------------------------------------------
// Confidence tiers
// ---------------------------------------------------------------------------

export const MIN_GROUP = 4;
export const SOLID_GROUP = 8;

const fmtP = (p: number) => (p < 0.001 ? 'p < 0,001' : `p = ${p.toFixed(3).replace('.', ',')}`);

/**
 * The three tiers, from the sizes of the groups, the (corrected) p-value and the
 * interval of the effect (`null` interval for correlations without bootstrap).
 * `strong`: the effect is large enough to matter (≥ 20 % or |r| ≥ 0,3).
 */
export function confidence(input: {
  n: number[];
  p: number | null;
  ci: [number, number] | null;
  /** Value of "no effect" for the interval (0 for a difference, 1 for a ratio). */
  nullValue?: number;
  strong: boolean;
}): Confidence {
  const { n, p, ci } = input;
  const smallest = Math.min(...n);
  const nullValue = input.nullValue ?? 0;
  const excludes = ci ? ci[0] > nullValue || ci[1] < nullValue : false;
  const base = { n, p, ci };
  const tier = (value: Tier, reason: string): Confidence => ({ ...base, tier: value, reason });
  if (!Number.isFinite(smallest) || smallest < MIN_GROUP) {
    return tier(
      'intuition',
      `Seulement ${Number.isFinite(smallest) ? smallest : 0} élément(s)${n.length > 1 ? ' d’un côté' : ''} : impossible de distinguer une tendance du hasard.`,
    );
  }
  if (p === null || !Number.isFinite(p)) {
    return tier('intuition', 'Pas de test possible sur ces données.');
  }
  const sizes = n.length > 1 ? `${smallest}+ vidéos de chaque côté` : `${smallest} éléments`;
  if (p < 0.05 && (ci === null || excludes) && smallest >= SOLID_GROUP && input.strong) {
    return tier(
      'solide',
      `${fmtP(p)} sur ${sizes}${ci ? ', et l’intervalle de confiance exclut l’absence d’effet' : ''}.`,
    );
  }
  if (p < 0.2) {
    const why =
      smallest < SOLID_GROUP
        ? `encore peu de données (${smallest}${n.length > 1 ? ' d’un côté' : ''})`
        : !input.strong
          ? 'effet petit'
          : ci && !excludes
            ? 'l’intervalle de confiance inclut encore l’absence d’effet'
            : 'pas encore assez net';
    return tier('piste', `${fmtP(p)} : tendance qui se dessine, mais ${why}.`);
  }
  return tier(
    'intuition',
    `${fmtP(p)} : l’écart observé est tout à fait compatible avec le hasard.`,
  );
}

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

/** Days between two "YYYY-MM-DD" dates. */
export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Daily values by age (0 = day of publication) from sparse day rows; missing
 * days count as 0, up to `lastDay` (last day with complete data).
 */
export function byAge(
  rows: { day: string; value: number }[],
  firstDay: string,
  lastDay: string,
): number[] {
  const length = dayDiff(firstDay, lastDay) + 1;
  if (length <= 0) return [];
  const series = new Array<number>(length).fill(0);
  for (const row of rows) {
    const age = dayDiff(firstDay, row.day);
    if (age >= 0 && age < length) series[age]! += row.value;
  }
  return series;
}

export function cumulative(series: number[]): number[] {
  let total = 0;
  return series.map((value) => (total += value));
}

/** Cumulative value at an age (inclusive), or null when the video is younger. */
export function atAge(series: number[], age: number): number | null {
  if (series.length <= age) return null;
  let total = 0;
  for (let i = 0; i <= age; i++) total += series[i]!;
  return total;
}

/** Days to reach half of the current total; null for a young or empty video. */
export function halfLife(series: number[], minAge = 14): number | null {
  const total = sum(series);
  if (series.length < minAge || total <= 0) return null;
  let running = 0;
  for (let i = 0; i < series.length; i++) {
    running += series[i]!;
    if (running >= total / 2) return i;
  }
  return null;
}

/**
 * "Evergreen": a video at least 60 days old whose last 28 days still bring at
 * least 25 % of what its first 28 days brought.
 */
export function evergreen(series: number[]): { evergreen: boolean; ratio: number | null } {
  if (series.length < 60) return { evergreen: false, ratio: null };
  const first = sum(series.slice(0, 28));
  const last = sum(series.slice(-28));
  if (first <= 0) return { evergreen: last > 0, ratio: null };
  const ratio = last / first;
  return { evergreen: ratio >= 0.25, ratio };
}

export interface Anomaly {
  index: number;
  value: number;
  expected: number;
  /** Robust z-score (MAD). */
  z: number;
  kind: 'spike' | 'dip';
}

/**
 * Unusual days: robust z-score (median and MAD of the previous `window` days,
 * on log(1 + x) so that growth does not trip it) above `threshold`.
 */
export function anomalies(series: number[], window = 14, threshold = 3.5): Anomaly[] {
  const found: Anomaly[] = [];
  const logs = series.map((v) => Math.log1p(Math.max(0, v)));
  for (let i = window; i < series.length; i++) {
    const past = logs.slice(i - window, i);
    const center = median(past);
    const mad = median(past.map((v) => Math.abs(v - center)));
    const scale = Math.max(mad, 0.15);
    const z = (0.6745 * (logs[i]! - center)) / scale;
    if (Math.abs(z) >= threshold && Math.abs(series[i]! - Math.expm1(center)) >= 5) {
      found.push({
        index: i,
        value: series[i]!,
        expected: Math.expm1(center),
        z,
        kind: z > 0 ? 'spike' : 'dip',
      });
    }
  }
  return found;
}

export interface LagResult {
  /** Correlation at each lag 0..maxLag (y after x by `lag` days). */
  byLag: { lag: number; r: number }[];
  best: { lag: number; r: number };
  /** Permutation p-value of the best lag (circular shifts of x, max over lags). */
  p: number;
  n: number;
}

/**
 * Does y follow x a few days later? Pearson correlation of the day-to-day
 * changes of log(1 + views) at each lag, against a null distribution made by
 * shifting x in time (keeps its own autocorrelation).
 */
export function laggedCorrelation(
  x: number[],
  y: number[],
  maxLag = 7,
  seed = 5,
): LagResult | null {
  const n = Math.min(x.length, y.length);
  if (n < maxLag + 10) return null;
  const diff = (values: number[]) =>
    values
      .slice(1, n)
      .map((v, i) => Math.log1p(Math.max(0, v)) - Math.log1p(Math.max(0, values[i]!)));
  const dx = diff(x);
  const dy = diff(y);
  const corrAt = (series: number[], lag: number) =>
    pearson(series.slice(0, series.length - lag), dy.slice(lag));
  const scan = (series: number[]) =>
    Array.from({ length: maxLag + 1 }, (_, lag) => ({ lag, r: corrAt(series, lag) || 0 }));
  const byLag = scan(dx);
  const best = byLag.reduce((a, b) => (b.r > a.r ? b : a));
  const random = rng(seed);
  const trials = 500;
  let extreme = 0;
  for (let t = 0; t < trials; t++) {
    const shift = maxLag + 1 + Math.floor(random() * Math.max(1, dx.length - 2 * (maxLag + 1)));
    const shifted = dx.map((_, i) => dx[(i + shift) % dx.length]!);
    if (Math.max(...scan(shifted).map((e) => e.r)) >= best.r) extreme++;
  }
  return { byLag, best, p: (extreme + 1) / (trials + 1), n: dx.length };
}

/** Smooths with a centered moving average (odd window). */
export function smooth(values: number[], window = 5): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), i + half + 1);
    return mean(slice);
  });
}
