// The Labo: cross-analyses of the statistics with what ToolBox knows (tracks,
// Shorts, excerpts, effects, publication times, energy of the music). Every
// comparison carries its confidence tier; nothing is presented as certain.
import {
  AUDIO_MODE_LABELS,
  EFFECT_LABELS,
  INTENSITY_LABELS,
  WEEKDAYS,
  type Confidence,
  type StatVideo,
  type VideoKind,
} from '../shared';
import { AGES, type Dataset, Indexed, youtubeDay, zoned } from './dataset';
import {
  retentionBySection,
  retentionEvents,
  sections,
  segmentEnergy,
  type RetentionEvent,
  type Section,
  type SectionLabel,
} from './music';
import {
  anomalies as findAnomalies,
  bootstrapDiff,
  confidence,
  dayDiff,
  evergreen,
  halfLife,
  holm,
  laggedCorrelation,
  mannWhitney,
  mean,
  median,
  spearman,
  sum,
  type LagResult,
} from './stats';

export interface VideoPerf {
  id: string;
  title: string;
  kind: VideoKind;
  trackId: number | null;
  label: string | null;
  publishedAt: string;
  age: number;
  views: number;
  viewsAt: Record<number, number | null>;
  index: Record<number, number | null>;
  /** Index at the oldest available reference age (J+30, J+7, J+3, J+1). */
  verdict: { age: number; index: number } | null;
  halfLife: number | null;
  /** Share of the J+7 views already made at J+1. */
  startSpeed: number | null;
  evergreen: boolean;
  evergreenRatio: number | null;
  avgViewPct: number | null;
  subsPer1000: number | null;
  likeRate: number | null;
  shareRate: number | null;
  weekday: number;
  hour: number;
}

/** Index of a video vs the usual, as a sentence part: « ×1,8 », « −40 % ». */
export function verdictWord(index: number): string {
  if (index >= 1.15) return 'mieux que d’habitude';
  if (index <= 0.85) return 'moins bien que d’habitude';
  return 'comme d’habitude';
}

export function videoPerf(ix: Indexed, video: StatVideo): VideoPerf {
  const series = ix.series(video);
  const views = sum(series);
  const viewsAt: Record<number, number | null> = {};
  const index: Record<number, number | null> = {};
  for (const age of AGES) {
    viewsAt[age] = ix.viewsAt(video, age);
    index[age] = ix.relativeIndex(video, age);
  }
  const ref = [...AGES].reverse().find((age) => index[age] !== null);
  const subs = ix.total(video, 'subsGained') - ix.total(video, 'subsLost');
  const likes = ix.total(video, 'likes');
  const shares = ix.total(video, 'shares');
  const green = evergreen(series);
  const local = zoned(video.publishedAt, ix.data.timeZone);
  return {
    id: video.id,
    title: video.title,
    kind: video.kind,
    trackId: video.origin.trackId,
    label: video.origin.label,
    publishedAt: video.publishedAt,
    age: ix.age(video),
    views,
    viewsAt,
    index,
    verdict: ref !== undefined ? { age: ref, index: index[ref]! } : null,
    halfLife: halfLife(series),
    startSpeed:
      viewsAt[7] && viewsAt[7] > 0 && viewsAt[1] !== null ? viewsAt[1]! / viewsAt[7]! : null,
    evergreen: green.evergreen,
    evergreenRatio: green.ratio,
    avgViewPct: ix.avgViewPct(video),
    subsPer1000: views >= 50 ? (subs / views) * 1000 : null,
    likeRate: views >= 50 ? (likes / views) * 100 : null,
    shareRate: views >= 50 ? (shares / views) * 1000 : null,
    weekday: local.weekday,
    hour: local.hour,
  };
}

// ---------------------------------------------------------------------------
// Music of a video (energy of the track or of the Short's excerpt)
// ---------------------------------------------------------------------------

export interface VideoMusic {
  energy: number[];
  sections: Section[];
  /** What the energy covers, in seconds of the track. */
  start: number;
  duration: number;
}

export function musicOf(data: Dataset, video: StatVideo): VideoMusic | null {
  const track = data.tracks.find((t) => t.id === video.origin.trackId);
  if (!track?.peaks || !track.durationSec) return null;
  let start = 0;
  let duration = track.durationSec;
  if (video.kind === 'short') {
    if (video.origin.excerptStart === null) return null;
    start = video.origin.excerptStart;
    duration = video.origin.excerptDuration ?? video.durationSec;
  }
  const energy = segmentEnergy(track.peaks, track.durationSec, start, duration, 100);
  return { energy, sections: sections(energy), start, duration };
}

export interface RetentionMusic {
  music: VideoMusic | null;
  events: RetentionEvent[];
  bySection: { label: SectionLabel; lossPer10: number; share: number }[];
  /** Spearman between the energy and the local retention change (per 1 %). */
  energyLink: { rho: number; n: number } | null;
}

export function retentionMusic(data: Dataset, video: StatVideo): RetentionMusic | null {
  const points = data.retention[video.id];
  if (!points || points.length < 10) return null;
  const music = musicOf(data, video);
  const list = music?.sections ?? [];
  let energyLink: RetentionMusic['energyLink'] = null;
  if (music) {
    const changes: number[] = [];
    const energies: number[] = [];
    for (let i = 1; i < points.length; i++) {
      if (points[i]!.ratio <= 0.05) continue;
      changes.push(points[i]!.watch - points[i - 1]!.watch);
      const position = Math.min(99, Math.floor(points[i]!.ratio * 100));
      energies.push(music.energy[position] ?? 0);
    }
    const corr = spearman(energies, changes, 3, 200);
    energyLink = Number.isFinite(corr.rho) ? { rho: corr.rho, n: corr.n } : null;
  }
  return {
    music,
    events: retentionEvents(points, list),
    bySection: music ? retentionBySection(points, list) : [],
    energyLink,
  };
}

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

export interface GroupStat {
  key: string;
  label: string;
  n: number;
  medianIndex: number | null;
  medianPct: number | null;
  /** This group vs all the others (index at J+7). */
  confidence: Confidence;
  /** Ratio of the medians of the index (group / rest) and its interval. */
  ratio: number | null;
}

export interface StyleFamily {
  family: 'effect' | 'intensity' | 'audioMode' | 'source';
  title: string;
  groups: GroupStat[];
}

export interface TrackLag {
  trackId: number;
  title: string;
  lag: LagResult | null;
  confidence: Confidence;
  shortsViews: number;
  longViews: number;
  /** Views of the long video that came from the track's own Shorts (suggestions). */
  fromOwnShorts: number;
  /** Daily series around the release, by date. */
  days: string[];
  shorts: number[];
  long: number[];
}

export interface Excerpt {
  videoId: string;
  title: string;
  label: string | null;
  trackId: number;
  trackTitle: string;
  start: number;
  duration: number;
  /** Where the excerpt starts in the track (0..1). */
  position: number;
  energy: number | null;
  index7: number | null;
  avgViewPct: number | null;
  views: number;
}

export interface HeatCell {
  weekday: number;
  bucket: number;
  n: number;
  medianIndex: number | null;
}

export interface AnomalyDay {
  day: string;
  value: number;
  expected: number;
  z: number;
  kind: 'spike' | 'dip';
  /** Publications of that day and of the 3 days before. */
  events: string[];
}

export interface LabResult {
  usual: { kind: VideoKind; age: number; median: number | null; n: number }[];
  videos: VideoPerf[];
  growth: {
    kind: VideoKind;
    usual: number[];
    curves: { id: string; title: string; points: number[] }[];
  }[];
  rabatteur: {
    tracks: TrackLag[];
    /** Mean correlation at the best lag over the tracks, tested by sign flips. */
    overall: { meanR: number | null; bestLag: number | null; confidence: Confidence };
  };
  excerpts: {
    list: Excerpt[];
    energyVsRetention: { rho: number; confidence: Confidence } | null;
    energyVsViews: { rho: number; confidence: Confidence } | null;
    positionVsViews: { rho: number; confidence: Confidence } | null;
  };
  styles: StyleFamily[];
  heatmap: { kind: VideoKind; cells: HeatCell[] }[];
  weekdays: { kind: VideoKind; groups: GroupStat[] }[];
  hours: { kind: VideoKind; groups: GroupStat[] }[];
  conversion: {
    byKind: {
      kind: VideoKind;
      n: number;
      subsPer1000: number | null;
      likeRate: number | null;
      shareRate: number | null;
    }[];
    shortsVsLong: { metric: 'subsPer1000'; ratio: number | null; confidence: Confidence } | null;
  };
  anomalies: AnomalyDay[];
  sections: { label: SectionLabel; lossPer10: number; n: number }[];
  sectionTest: { better: SectionLabel; worse: SectionLabel; confidence: Confidence } | null;
}

export const HOUR_BUCKETS = [
  'Nuit (0–6 h)',
  'Matin (6–12 h)',
  'Après-midi (12–18 h)',
  'Soir (18–24 h)',
];
const bucketOf = (hour: number) => Math.min(3, Math.floor(hour / 6));

/** Compares a group to the rest of the videos, on the index at J+7. */
function groupVsRest(
  label: string,
  key: string,
  members: VideoPerf[],
  rest: VideoPerf[],
  seed: number,
): Omit<GroupStat, 'confidence'> & {
  p: number | null;
  ci: [number, number] | null;
  strong: boolean;
} {
  const values = (list: VideoPerf[]) =>
    list.map((v) => v.index[7]).filter((x): x is number => x !== null);
  const a = values(members);
  const b = values(rest);
  const pcts = members.map((v) => v.avgViewPct).filter((x): x is number => x !== null);
  const test = a.length && b.length ? mannWhitney(a, b) : null;
  const boot = bootstrapDiff(a, b, { ratio: true, seed });
  const ratio = a.length && b.length && median(b) > 0 ? median(a) / median(b) : null;
  return {
    key,
    label,
    n: a.length,
    medianIndex: a.length ? median(a) : null,
    medianPct: pcts.length ? median(pcts) : null,
    ratio,
    p: test ? test.p : null,
    ci: boot ? boot.ci95 : null,
    strong: ratio !== null && (ratio >= 1.2 || ratio <= 1 / 1.2),
  };
}

/** Group comparisons of one family, with Holm's correction across the family. */
function family(
  groups: { key: string; label: string; members: VideoPerf[] }[],
  all: VideoPerf[],
): GroupStat[] {
  const raw = groups
    .filter((g) => g.members.length > 0)
    .map((g, i) =>
      groupVsRest(
        g.label,
        g.key,
        g.members,
        all.filter((v) => !g.members.includes(v)),
        31 + i,
      ),
    );
  const adjusted = holm(raw.map((g) => g.p ?? 1));
  return raw.map((g, i) => {
    const restN = all.length - g.n;
    return {
      key: g.key,
      label: g.label,
      n: g.n,
      medianIndex: g.medianIndex,
      medianPct: g.medianPct,
      ratio: g.ratio,
      confidence: confidence({
        n: [g.n, restN],
        p: g.p === null ? null : adjusted[i]!,
        ci: g.ci,
        nullValue: 1,
        strong: g.strong,
      }),
    };
  });
}

/** Sign-flip permutation test: is the mean of these values different from 0? */
function signFlip(values: number[], seed = 13): number {
  if (values.length < 2) return 1;
  const observed = Math.abs(mean(values));
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  let extreme = 0;
  const trials = 2000;
  for (let t = 0; t < trials; t++) {
    const value = Math.abs(mean(values.map((v) => (random() < 0.5 ? -v : v))));
    if (value >= observed - 1e-12) extreme++;
  }
  return (extreme + 1) / (trials + 1);
}

function correlationConfidence(
  rho: number,
  p: number,
  n: number,
  ci: [number, number] | null,
): Confidence {
  return confidence({ n: [n], p, ci, strong: Math.abs(rho) >= 0.3 });
}

export function runLab(data: Dataset): LabResult {
  const ix = new Indexed(data);
  const perf = data.videos.map((v) => videoPerf(ix, v));
  const byId = new Map(perf.map((p) => [p.id, p]));
  const kinds: VideoKind[] = ['short', 'video'];

  const usual = kinds.flatMap((kind) =>
    AGES.map((age) => {
      const values = data.videos
        .filter((v) => v.kind === kind)
        .map((v) => ix.viewsAt(v, age))
        .filter((x): x is number => x !== null);
      return { kind, age, median: values.length >= 3 ? median(values) : null, n: values.length };
    }),
  );

  // Growth curves (cumulative views, normalised by the usual at J+7).
  const growth = kinds.map((kind) => {
    const norm = ix.usualAt(kind, 7) ?? 1;
    const curves = data.videos
      .filter((v) => v.kind === kind)
      .map((v) => {
        const series = ix.series(v).slice(0, 31);
        let running = 0;
        return {
          id: v.id,
          title: v.title,
          points: series.map((value) => (running += value) / Math.max(1, norm)),
        };
      });
    const usualCurve = Array.from({ length: 31 }, (_, age) => {
      const values = curves.map((c) => c.points[age]).filter((x): x is number => x !== undefined);
      return values.length >= 3 ? median(values) : NaN;
    });
    return { kind, usual: usualCurve, curves };
  });

  // Shorts → long video ("effet rabatteur").
  const trackIds = [
    ...new Set(data.videos.map((v) => v.origin.trackId).filter((x): x is number => x !== null)),
  ];
  const lagTracks: TrackLag[] = [];
  for (const trackId of trackIds) {
    const members = data.videos.filter((v) => v.origin.trackId === trackId);
    const long = members.find((v) => v.kind === 'video');
    const shorts = members.filter((v) => v.kind === 'short');
    if (!long || shorts.length === 0) continue;
    const start = [long, ...shorts].map((v) => ix.publishDay(v)).sort()[0]!;
    const days = ix.daysFrom(start).slice(0, 90);
    const valueOn = (video: StatVideo) => {
      const rows = new Map((ix.byVideo.get(video.id) ?? []).map((r) => [r.day, r.views]));
      return days.map((d) => rows.get(d) ?? 0);
    };
    const shortsSeries = days.map((_, i) => sum(shorts.map((s) => valueOn(s)[i]!)));
    const longSeries = valueOn(long);
    const lag = laggedCorrelation(shortsSeries, longSeries, 7, trackId);
    const ownShortIds = new Set(shorts.map((s) => s.id));
    const related = data.breakdowns.filter((b) => b.videoId === long.id && b.kind === 'related');
    const fromOwnShorts = sum(related.filter((b) => ownShortIds.has(b.key)).map((b) => b.views));
    const track = data.tracks.find((t) => t.id === trackId);
    lagTracks.push({
      trackId,
      title: track?.title ?? long.title,
      lag,
      confidence: lag
        ? confidence({ n: [lag.n], p: lag.p, ci: null, strong: lag.best.r >= 0.3 })
        : confidence({ n: [days.length], p: null, ci: null, strong: false }),
      shortsViews: sum(shortsSeries),
      longViews: sum(longSeries),
      fromOwnShorts,
      days,
      shorts: shortsSeries,
      long: longSeries,
    });
  }
  const lagged = lagTracks.filter((t) => t.lag && t.lag.best.lag >= 1);
  const rValues = lagTracks.filter((t) => t.lag).map((t) => t.lag!.best.r);
  const lagCounts = new Map<number, number>();
  for (const t of lagged) lagCounts.set(t.lag!.best.lag, (lagCounts.get(t.lag!.best.lag) ?? 0) + 1);
  const bestLag = [...lagCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const overallP = rValues.length >= 2 ? signFlip(rValues) : null;
  const overall = {
    meanR: rValues.length ? mean(rValues) : null,
    bestLag,
    confidence: confidence({
      n: [rValues.length],
      p: overallP,
      ci: null,
      strong: rValues.length > 0 && mean(rValues) >= 0.2,
    }),
  };

  // Excerpts of the Shorts.
  const excerptList: Excerpt[] = [];
  for (const video of data.videos) {
    if (
      video.kind !== 'short' ||
      video.origin.trackId === null ||
      video.origin.excerptStart === null
    )
      continue;
    const track = data.tracks.find((t) => t.id === video.origin.trackId);
    if (!track) continue;
    const music = musicOf(data, video);
    const p = byId.get(video.id)!;
    excerptList.push({
      videoId: video.id,
      title: video.title,
      label: video.origin.label,
      trackId: track.id,
      trackTitle: track.title,
      start: video.origin.excerptStart,
      duration: video.origin.excerptDuration ?? video.durationSec,
      position: track.durationSec ? video.origin.excerptStart / track.durationSec : 0,
      energy: music ? mean(music.energy) : null,
      index7: p.index[7] ?? null,
      avgViewPct: p.avgViewPct,
      views: p.views,
    });
  }
  const corrOf = (pairs: [number | null, number | null][], seed: number) => {
    const valid = pairs.filter(
      (pair): pair is [number, number] => pair[0] !== null && pair[1] !== null,
    );
    if (valid.length < 3) return null;
    const corr = spearman(
      valid.map((p) => p[0]),
      valid.map((p) => p[1]),
      seed,
    );
    return { rho: corr.rho, confidence: correlationConfidence(corr.rho, corr.p, corr.n, corr.ci) };
  };
  const excerpts = {
    list: excerptList,
    energyVsRetention: corrOf(
      excerptList.map((e) => [e.energy, e.avgViewPct]),
      41,
    ),
    energyVsViews: corrOf(
      excerptList.map((e) => [e.energy, e.index7]),
      43,
    ),
    positionVsViews: corrOf(
      excerptList.map((e) => [e.position, e.index7]),
      47,
    ),
  };

  // Styles of the Shorts (Reels of the pack vs Reels perso, effects, sound).
  const shortsPerf = perf.filter((p) => p.kind === 'short');
  const videoOf = (p: VideoPerf) => ix.video.get(p.id)!;
  const groupBy = (key: (v: StatVideo) => string | null, labels: Record<string, string>) => {
    const map = new Map<string, VideoPerf[]>();
    for (const p of shortsPerf) {
      const value = key(videoOf(p));
      if (value === null) continue;
      map.set(value, [...(map.get(value) ?? []), p]);
    }
    return [...map.entries()].map(([k, members]) => ({ key: k, label: labels[k] ?? k, members }));
  };
  const withStyle = shortsPerf.filter((p) => videoOf(p).origin.source === 'custom-reel');
  const styles: StyleFamily[] = [
    {
      family: 'source',
      title: 'Reel de la cover vs Reel perso',
      groups: family(
        groupBy((v) => (v.origin.source === 'video' ? null : v.origin.source), {
          'cover-reel': 'Reel de la cover (pack)',
          'custom-reel': 'Reel perso (tes vidéos)',
        }),
        shortsPerf.filter((p) => videoOf(p).origin.source !== null),
      ),
    },
    {
      family: 'effect',
      title: 'Effet du Reel perso',
      groups: family(
        groupBy((v) => (v.origin.source === 'custom-reel' ? v.origin.effect : null), EFFECT_LABELS),
        withStyle,
      ),
    },
    {
      family: 'intensity',
      title: 'Intensité',
      groups: family(
        groupBy(
          (v) => (v.origin.source === 'custom-reel' ? v.origin.intensity : null),
          INTENSITY_LABELS,
        ),
        withStyle,
      ),
    },
    {
      family: 'audioMode',
      title: 'Son du Reel perso',
      groups: family(
        groupBy(
          (v) => (v.origin.source === 'custom-reel' ? v.origin.audioMode : null),
          AUDIO_MODE_LABELS,
        ),
        withStyle,
      ),
    },
  ];

  // Publication day and hour.
  const heatmap = kinds.map((kind) => {
    const list = perf.filter((p) => p.kind === kind);
    const cells: HeatCell[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      for (let bucket = 0; bucket < 4; bucket++) {
        const values = list
          .filter((p) => p.weekday === weekday && bucketOf(p.hour) === bucket)
          .map((p) => p.index[7])
          .filter((x): x is number => x !== null);
        cells.push({
          weekday,
          bucket,
          n: values.length,
          medianIndex: values.length ? median(values) : null,
        });
      }
    }
    return { kind, cells };
  });
  const weekdays = kinds.map((kind) => {
    const list = perf.filter((p) => p.kind === kind && p.index[7] !== null);
    return {
      kind,
      groups: family(
        WEEKDAYS.map((name, weekday) => ({
          key: String(weekday),
          label: name,
          members: list.filter((p) => p.weekday === weekday),
        })),
        list,
      ),
    };
  });

  const hours = kinds.map((kind) => {
    const list = perf.filter((p) => p.kind === kind && p.index[7] !== null);
    return {
      kind,
      groups: family(
        HOUR_BUCKETS.map((name, bucket) => ({
          key: String(bucket),
          label: name,
          members: list.filter((p) => bucketOf(p.hour) === bucket),
        })),
        list,
      ),
    };
  });

  // Conversion.
  const byKind = kinds.map((kind) => {
    const list = perf.filter((p) => p.kind === kind);
    const med = (values: (number | null)[]) => {
      const valid = values.filter((x): x is number => x !== null);
      return valid.length ? median(valid) : null;
    };
    return {
      kind,
      n: list.length,
      subsPer1000: med(list.map((p) => p.subsPer1000)),
      likeRate: med(list.map((p) => p.likeRate)),
      shareRate: med(list.map((p) => p.shareRate)),
    };
  });
  const shortRates = perf
    .filter((p) => p.kind === 'short' && p.subsPer1000 !== null)
    .map((p) => p.subsPer1000!);
  const longRates = perf
    .filter((p) => p.kind === 'video' && p.subsPer1000 !== null)
    .map((p) => p.subsPer1000!);
  let shortsVsLong: LabResult['conversion']['shortsVsLong'] = null;
  if (shortRates.length && longRates.length) {
    const test = mannWhitney(longRates, shortRates);
    const boot = bootstrapDiff(longRates, shortRates, { seed: 53 });
    const ratio = median(shortRates) !== 0 ? median(longRates) / median(shortRates) : null;
    shortsVsLong = {
      metric: 'subsPer1000',
      ratio,
      confidence: confidence({
        n: [longRates.length, shortRates.length],
        p: test.p,
        ci: boot ? boot.ci95 : null,
        strong: Math.abs(test.r) >= 0.3,
      }),
    };
  }

  // Unusual days of the channel, annotated with the publications.
  const channelSeries = (() => {
    const first = data.channelDays[0]?.day ?? ix.firstDay();
    const map = new Map(data.channelDays.map((d) => [d.day, d.views]));
    const days = ix.daysFrom(first);
    return { days, values: days.map((d) => map.get(d) ?? 0) };
  })();
  const published = new Map<string, string[]>();
  for (const v of data.videos) {
    const day = youtubeDay(v.publishedAt);
    published.set(day, [
      ...(published.get(day) ?? []),
      `Publication : ${v.origin.label ? `${v.origin.label} — ` : ''}${v.title}`,
    ]);
  }
  const anomalies: AnomalyDay[] = findAnomalies(channelSeries.values).map((a) => {
    const day = channelSeries.days[a.index]!;
    // Publications of the day and of the 3 days before (a release lifts the following days).
    const events: string[] = [];
    for (let back = 0; back <= 3; back++) {
      const other = channelSeries.days[a.index - back];
      if (!other) continue;
      for (const text of published.get(other) ?? [])
        events.push(back === 0 ? text : `${text} (J-${back})`);
    }
    return { day, value: a.value, expected: a.expected, z: a.z, kind: a.kind, events };
  });

  // Retention by section of the music, over the videos with a known track.
  const sectionValues = new Map<SectionLabel, number[]>();
  for (const video of data.videos) {
    const result = retentionMusic(data, video);
    for (const s of result?.bySection ?? []) {
      if (s.share < 0.05) continue;
      sectionValues.set(s.label, [...(sectionValues.get(s.label) ?? []), s.lossPer10]);
    }
  }
  const sectionStats = [...sectionValues.entries()].map(([label, values]) => ({
    label,
    lossPer10: median(values),
    n: values.length,
  }));
  let sectionTest: LabResult['sectionTest'] = null;
  const drops = sectionValues.get('Drop') ?? [];
  const calm = [...(sectionValues.get('Pause') ?? []), ...(sectionValues.get('Intro') ?? [])];
  if (drops.length && calm.length) {
    const test = mannWhitney(drops, calm);
    const boot = bootstrapDiff(drops, calm, { seed: 61 });
    const dropsBetter = median(drops) > median(calm);
    sectionTest = {
      better: dropsBetter ? 'Drop' : 'Pause',
      worse: dropsBetter ? 'Pause' : 'Drop',
      confidence: confidence({
        n: [drops.length, calm.length],
        p: test.p,
        ci: boot ? boot.ci95 : null,
        strong: Math.abs(test.r) >= 0.3,
      }),
    };
  }

  return {
    usual,
    videos: perf,
    growth,
    rabatteur: { tracks: lagTracks, overall },
    excerpts,
    styles,
    heatmap,
    weekdays,
    hours,
    conversion: { byKind, shortsVsLong },
    anomalies,
    sections: sectionStats,
    sectionTest,
  };
}

/** Days since a video was published, by its id (for the theories' wording). */
export function ageDays(data: Dataset, video: StatVideo): number {
  return dayDiff(youtubeDay(video.publishedAt), data.lastDay);
}
