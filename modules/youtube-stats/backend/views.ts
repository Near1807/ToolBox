// What each level of the interface shows, computed on a dataset: overview
// (key figures, records, what moved since the last visit, highlights), tracks
// (long video + Shorts together), video sheets.
import {
  METRICS,
  type BreakdownKind,
  type DayRow,
  type StatVideo,
  type VideoKind,
} from '../shared';
import { type Dataset, Indexed, youtubeDay } from './dataset';
import {
  retentionMusic,
  verdictWord,
  type LabResult,
  type RetentionMusic,
  type VideoPerf,
} from './lab';
import { addDay, anomalies, cumulative, dayDiff, median, sum } from './stats';
import type { Theory } from './theories';

export type KindFilter = VideoKind | 'all';

export interface Filters {
  /** Days back from the last complete day; null: everything. */
  period: number | null;
  kind: KindFilter;
  trackId: number | null;
}

export function parseFilters(query: Record<string, string | undefined>): Filters {
  const period = query.period === 'all' || !query.period ? null : Number(query.period);
  const kind = query.kind === 'short' || query.kind === 'video' ? query.kind : 'all';
  const trackId = query.track ? Number(query.track) : null;
  return {
    period: period && Number.isFinite(period) && period > 0 ? period : null,
    kind,
    trackId: trackId && Number.isFinite(trackId) ? trackId : null,
  };
}

const keep = (video: StatVideo, filters: Filters) =>
  (filters.kind === 'all' || video.kind === filters.kind) &&
  (filters.trackId === null || video.origin.trackId === filters.trackId);

/** First day of the period (inclusive), and of the previous one of same length. */
function window(ix: Indexed, filters: Filters) {
  const last = ix.data.lastDay;
  const first = filters.period ? addDay(last, -filters.period + 1) : ix.firstDay();
  const length = dayDiff(first, last) + 1;
  return { first, last, previousFirst: addDay(first, -length), previousLast: addDay(first, -1) };
}

function sumRows(rows: DayRow[], metric: keyof DayRow, from: string, to: string): number {
  let total = 0;
  for (const row of rows) if (row.day >= from && row.day <= to) total += Number(row[metric] ?? 0);
  return total;
}

/**
 * Impressions and CTR of a whole video, by priority: the days of the API, then
 * a « totals » CSV (frozen at its export), then the days of a CSV. CTR of days
 * is weighted by their impressions.
 */
export function reachTotals(
  video: StatVideo,
  rows: DayRow[],
): {
  impressions: number | null;
  ctr: number | null;
  source: 'api' | 'api+csv' | 'csv-totals' | 'csv' | null;
} {
  const withReach = rows.filter((r) => r.impressions !== null || r.ctr !== null);
  const fromApi = withReach.filter((r) => (r.reachSource ?? 'api') === 'api');
  const fromDays = (list: DayRow[]) => {
    let impressions = 0;
    let clicks = 0;
    let weighted = 0;
    for (const r of list) {
      impressions += r.impressions ?? 0;
      if (r.ctr !== null && r.impressions) {
        clicks += (r.ctr * r.impressions) / 100;
        weighted += r.impressions;
      }
    }
    return {
      impressions: list.some((r) => r.impressions !== null) ? impressions : null,
      ctr: weighted > 0 ? (clicks / weighted) * 100 : null,
    };
  };
  if (fromApi.length > 0)
    return {
      ...fromDays(withReach),
      source: fromApi.length === withReach.length ? 'api' : 'api+csv',
    };
  if (video.impressions !== null || video.ctr !== null)
    return { impressions: video.impressions, ctr: video.ctr, source: 'csv-totals' };
  if (withReach.length > 0) return { ...fromDays(withReach), source: 'csv' };
  return { impressions: null, ctr: null, source: null };
}

// ---------------------------------------------------------------------------
// Records and milestones
// ---------------------------------------------------------------------------

export interface RecordItem {
  key: string;
  label: string;
  value: string;
  date: string | null;
  videoId: string | null;
}

export function records(data: Dataset, ix: Indexed, perf: VideoPerf[]): RecordItem[] {
  const list: RecordItem[] = [];
  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
  const bestDay = [...data.channelDays].sort((a, b) => b.views - a.views)[0];
  if (bestDay && bestDay.views > 0) {
    list.push({
      key: 'best-day',
      label: 'Meilleur jour de la chaîne',
      value: `${fmt(bestDay.views)} vues`,
      date: bestDay.day,
      videoId: null,
    });
  }
  const bestSubs = [...data.channelDays].sort(
    (a, b) => b.subsGained - b.subsLost - (a.subsGained - a.subsLost),
  )[0];
  if (bestSubs && bestSubs.subsGained - bestSubs.subsLost > 0) {
    list.push({
      key: 'best-subs-day',
      label: 'Plus d’abonnés gagnés en un jour',
      value: `+${fmt(bestSubs.subsGained - bestSubs.subsLost)}`,
      date: bestSubs.day,
      videoId: null,
    });
  }
  let bestVideoDay: { row: DayRow; video: StatVideo } | null = null;
  for (const row of data.days) {
    if (!bestVideoDay || row.views > bestVideoDay.row.views) {
      const video = ix.video.get(row.videoId);
      if (video) bestVideoDay = { row, video };
    }
  }
  if (bestVideoDay) {
    list.push({
      key: 'best-video-day',
      label: 'Meilleur jour d’une vidéo',
      value: `${fmt(bestVideoDay.row.views)} vues — ${bestVideoDay.video.title}`,
      date: bestVideoDay.row.day,
      videoId: bestVideoDay.video.id,
    });
  }
  for (const kind of ['short', 'video'] as const) {
    const best = perf
      .filter((p) => p.kind === kind && p.avgViewPct !== null && p.views >= 100)
      .sort((a, b) => b.avgViewPct! - a.avgViewPct!)[0];
    if (best) {
      list.push({
        key: `best-retention-${kind}`,
        label:
          kind === 'short'
            ? 'Meilleure rétention d’un Short'
            : 'Meilleure rétention d’une vidéo longue',
        value: `${Math.round(best.avgViewPct!)} % regardé — ${best.title}`,
        date: null,
        videoId: best.id,
      });
    }
    const top = perf.filter((p) => p.kind === kind).sort((a, b) => b.views - a.views)[0];
    if (top && top.views > 0) {
      list.push({
        key: `top-${kind}`,
        label: kind === 'short' ? 'Short le plus vu' : 'Vidéo longue la plus vue',
        value: `${fmt(top.views)} vues — ${top.title}`,
        date: null,
        videoId: top.id,
      });
    }
  }
  // Milestones: first video to reach 100 / 1 000 / 10 000 views, and when.
  for (const threshold of [100, 1000, 10000, 100000]) {
    let first: { day: string; video: StatVideo } | null = null;
    for (const video of data.videos) {
      const series = cumulative(ix.series(video));
      const age = series.findIndex((v) => v >= threshold);
      if (age < 0) continue;
      const day = addDay(ix.publishDay(video), age);
      if (!first || day < first.day) first = { day, video };
    }
    if (first) {
      list.push({
        key: `first-${threshold}`,
        label: `Première vidéo à ${fmt(threshold)} vues`,
        value: first.video.title,
        date: first.day,
        videoId: first.video.id,
      });
    }
  }
  // Subscriber milestones (from the daily snapshots).
  const snapshots = [...data.snapshots].sort((a, b) => a.day.localeCompare(b.day));
  for (const threshold of [10, 50, 100, 250, 500, 1000, 5000, 10000]) {
    const reached = snapshots.find((s) => s.subscribers >= threshold);
    if (reached) {
      list.push({
        key: `subs-${threshold}`,
        label: `${fmt(threshold)} abonnés`,
        value: 'atteint',
        date: reached.day,
        videoId: null,
      });
    }
  }
  return list;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface VisitMark {
  at: string;
  views: number;
  subscribers: number | null;
  perVideo: Record<string, number>;
  records: string[];
}

export function visitMark(data: Dataset, recordList: RecordItem[]): VisitMark {
  const perVideo: Record<string, number> = {};
  for (const v of data.videos) perVideo[v.id] = v.totalViews;
  const last = [...data.snapshots].sort((a, b) => a.day.localeCompare(b.day)).pop();
  return {
    at: new Date().toISOString(),
    views: sum(data.videos.map((v) => v.totalViews)),
    subscribers: last?.subscribers ?? null,
    perVideo,
    records: recordList.map((r) => `${r.key}=${r.value}`),
  };
}

export interface Highlight {
  title: string;
  text: string;
  tone: 'success' | 'warning' | 'accent' | 'neutral';
  videoId: string | null;
}

export function overview(
  data: Dataset,
  lab: LabResult,
  theories: Theory[],
  filters: Filters,
  lastVisit: VisitMark | null,
) {
  const ix = new Indexed(data);
  const { first, last, previousFirst, previousLast } = window(ix, filters);
  const videos = data.videos.filter((v) => keep(v, filters));
  const rows = data.days.filter((r) => videos.some((v) => v.id === r.videoId));
  const metric = (key: keyof DayRow, from = first, to = last) => sumRows(rows, key, from, to);
  const viewsNow = metric('views');
  const weightedPct = (() => {
    let weighted = 0;
    let views = 0;
    for (const r of rows) {
      if (r.day < first || r.day > last || r.avgViewPct === null) continue;
      weighted += r.avgViewPct * r.views;
      views += r.views;
    }
    return views ? weighted / views : null;
  })();
  const snapshots = [...data.snapshots].sort((a, b) => a.day.localeCompare(b.day));
  const latest = snapshots[snapshots.length - 1] ?? null;
  const atStart = [...snapshots].reverse().find((s) => s.day <= previousLast) ?? null;
  // Live counters (YouTube Data API, at the last sync): what YouTube shows now, estimated.
  const live = {
    subscribers: latest?.subscribers ?? null,
    views: latest?.views ?? null,
    likes: sum(data.videos.map((v) => v.totalLikes)),
    comments: sum(data.videos.map((v) => v.totalComments)),
    day: latest?.day ?? null,
  };
  const key = {
    subscribers: latest?.subscribers ?? null,
    subscribersDelta: latest && atStart ? latest.subscribers - atStart.subscribers : null,
    totalViews: sum(data.videos.map((v) => v.totalViews)),
    views: viewsNow,
    viewsPrevious: metric('views', previousFirst, previousLast),
    minutes: metric('minutes'),
    minutesPrevious: metric('minutes', previousFirst, previousLast),
    subsNet: metric('subsGained') - metric('subsLost'),
    subsNetPrevious:
      metric('subsGained', previousFirst, previousLast) -
      metric('subsLost', previousFirst, previousLast),
    likes: metric('likes'),
    shares: metric('shares'),
    comments: metric('comments'),
    avgViewPct: weightedPct,
    videos: videos.length,
    shorts: videos.filter((v) => v.kind === 'short').length,
    shortsViewShare: viewsNow
      ? sumRows(
          rows.filter((r) => ix.video.get(r.videoId)?.kind === 'short'),
          'views',
          first,
          last,
        ) / viewsNow
      : null,
  };
  // Daily series of the period: views (Shorts / long), subscribers.
  const days = ix.daysFrom(first);
  const byDay = (kind: VideoKind) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (ix.video.get(r.videoId)?.kind !== kind) continue;
      map.set(r.day, (map.get(r.day) ?? 0) + r.views);
    }
    return days.map((d) => map.get(d) ?? 0);
  };
  const snapByDay = new Map(snapshots.map((s) => [s.day, s.subscribers]));
  const publications = data.videos
    .filter((v) => keep(v, filters) && youtubeDay(v.publishedAt) >= first)
    .map((v) => ({
      day: youtubeDay(v.publishedAt),
      title: v.title,
      kind: v.kind,
      label: v.origin.label,
    }));
  const series = {
    days,
    shorts: byDay('short'),
    long: byDay('video'),
    subscribers: days.map((d) => snapByDay.get(d) ?? null),
    publications,
  };

  // Top tracks of the period.
  const tracks = new Map<number, { views: number; shorts: number; long: number }>();
  for (const r of rows) {
    if (r.day < first || r.day > last) continue;
    const video = ix.video.get(r.videoId);
    const trackId = video?.origin.trackId;
    if (!video || trackId === null || trackId === undefined) continue;
    const entry = tracks.get(trackId) ?? { views: 0, shorts: 0, long: 0 };
    entry.views += r.views;
    if (video.kind === 'short') entry.shorts += r.views;
    else entry.long += r.views;
    tracks.set(trackId, entry);
  }
  const topTracks = [...tracks.entries()]
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, 5)
    .map(([trackId, entry]) => ({
      trackId,
      title: data.tracks.find((t) => t.id === trackId)?.title ?? `Morceau ${trackId}`,
      ...entry,
    }));

  const recordList = records(data, ix, lab.videos);
  let sinceVisit: {
    at: string;
    items: { label: string; before: number; after: number }[];
    newRecords: RecordItem[];
  } | null = null;
  if (lastVisit) {
    const items: { label: string; before: number; after: number }[] = [];
    if (
      lastVisit.subscribers !== null &&
      key.subscribers !== null &&
      key.subscribers !== lastVisit.subscribers
    ) {
      items.push({ label: 'Abonnés', before: lastVisit.subscribers, after: key.subscribers });
    }
    if (key.totalViews !== lastVisit.views) {
      items.push({ label: 'Vues totales', before: lastVisit.views, after: key.totalViews });
    }
    const moved = data.videos
      .map((v) => ({ v, delta: v.totalViews - (lastVisit.perVideo[v.id] ?? 0) }))
      .filter((e) => e.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 5);
    for (const { v } of moved) {
      items.push({ label: v.title, before: lastVisit.perVideo[v.id] ?? 0, after: v.totalViews });
    }
    const known = new Set(lastVisit.records);
    sinceVisit = {
      at: lastVisit.at,
      items,
      newRecords: recordList.filter((r) => !known.has(`${r.key}=${r.value}`)),
    };
  }

  // Three highlights.
  const highlights: Highlight[] = [];
  const recent = lab.videos
    .filter((p) => p.verdict && p.age <= 45 && p.views >= 20)
    .sort((a, b) => Math.abs(Math.log(b.verdict!.index)) - Math.abs(Math.log(a.verdict!.index)));
  const star = recent.find((p) => p.verdict!.index >= 1.3);
  if (star) {
    highlights.push({
      title: 'Au-dessus de d’habitude',
      text: `« ${star.title} » fait ×${star.verdict!.index.toFixed(1).replace('.', ',')} par rapport à ta médiane à J+${star.verdict!.age} (${verdictWord(star.verdict!.index)}).`,
      tone: 'success',
      videoId: star.id,
    });
  }
  // A spike far from any release says more than the release itself.
  const spikes = lab.anomalies.filter((a) => dayDiff(a.day, last) <= 21 && a.kind === 'spike');
  const spike = spikes.filter((a) => a.events.length === 0).pop() ?? null;
  if (spike) {
    highlights.push({
      title: 'Pic inhabituel',
      text: `Le ${spike.day.split('-').reverse().join('/')} : ${Math.round(spike.value)} vues au lieu de ~${Math.round(spike.expected)}, sans publication ce jour-là ni les 3 jours avant (partage externe ? suggestion ?).`,
      tone: 'accent',
      videoId: null,
    });
  }
  const solid = theories.find((t) => t.confidence.tier === 'solide');
  if (solid) {
    highlights.push({
      title: 'Théorie solide',
      text: `${solid.text} (${solid.effect}).`,
      tone: 'success',
      videoId: null,
    });
  }
  const green = lab.videos.find((p) => p.evergreen);
  if (green && highlights.length < 3) {
    highlights.push({
      title: 'Vidéo qui dure',
      text: `« ${green.title} » vit encore : ses 28 derniers jours valent ${Math.round((green.evergreenRatio ?? 0) * 100)} % de ses 28 premiers.`,
      tone: 'neutral',
      videoId: green.id,
    });
  }
  const dip = recent.find((p) => p.verdict!.index <= 0.6);
  if (dip && highlights.length < 3) {
    highlights.push({
      title: 'En dessous de d’habitude',
      text: `« ${dip.title} » est à ${Math.round(dip.verdict!.index * 100)} % de ta médiane à J+${dip.verdict!.age}.`,
      tone: 'warning',
      videoId: dip.id,
    });
  }
  if (highlights.length === 0) {
    highlights.push({
      title: 'Rien d’inhabituel',
      text: 'Pas encore assez de vidéos ou d’historique pour repérer quelque chose de marquant.',
      tone: 'neutral',
      videoId: null,
    });
  }

  return {
    period: { first, last, previousFirst, previousLast },
    live,
    key,
    series,
    topTracks,
    records: recordList,
    sinceVisit,
    highlights: highlights.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Tracks (long video + Shorts together)
// ---------------------------------------------------------------------------

export function trackList(data: Dataset, lab: LabResult) {
  const ix = new Indexed(data);
  const perf = new Map(lab.videos.map((p) => [p.id, p]));
  const ids = [
    ...new Set(data.videos.map((v) => v.origin.trackId).filter((x): x is number => x !== null)),
  ];
  return ids
    .map((trackId) => {
      const track = data.tracks.find((t) => t.id === trackId);
      const videos = data.videos.filter((v) => v.origin.trackId === trackId);
      const views = sum(videos.map((v) => perf.get(v.id)?.views ?? 0));
      const release = videos.map((v) => ix.publishDay(v)).sort()[0] ?? null;
      const long = videos.find((v) => v.kind === 'video');
      return {
        trackId,
        title: track?.title ?? `Morceau ${trackId}`,
        artist: track?.artist ?? '',
        coverUrl: track?.coverUrl ?? null,
        release,
        views,
        longViews: long ? (perf.get(long.id)?.views ?? 0) : 0,
        shortViews: sum(
          videos.filter((v) => v.kind === 'short').map((v) => perf.get(v.id)?.views ?? 0),
        ),
        videos: videos.length,
        minutes: sum(videos.map((v) => ix.total(v, 'minutes'))),
        subsNet: sum(videos.map((v) => ix.total(v, 'subsGained') - ix.total(v, 'subsLost'))),
        likes: sum(videos.map((v) => ix.total(v, 'likes'))),
        index7: (() => {
          const values = videos
            .map((v) => perf.get(v.id)?.index[7])
            .filter((x): x is number => x !== null && x !== undefined);
          return values.length ? median(values) : null;
        })(),
      };
    })
    .sort((a, b) => (b.release ?? '').localeCompare(a.release ?? ''));
}

export function trackDetail(data: Dataset, lab: LabResult, trackId: number) {
  const ix = new Indexed(data);
  const track = data.tracks.find((t) => t.id === trackId) ?? null;
  const videos = data.videos
    .filter((v) => v.origin.trackId === trackId)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  if (videos.length === 0) return null;
  const perf = new Map(lab.videos.map((p) => [p.id, p]));
  const release = ix.publishDay(videos[0]!);
  const from = addDay(release, -2);
  const days = ix.daysFrom(from).slice(0, 45);
  const elements = videos.map((v) => {
    const rows = new Map((ix.byVideo.get(v.id) ?? []).map((r) => [r.day, r.views]));
    const p = perf.get(v.id)!;
    return {
      id: v.id,
      title: v.title,
      label: v.origin.label ?? (v.kind === 'short' ? 'Short' : 'Vidéo'),
      kind: v.kind,
      publishedAt: v.publishedAt,
      publishDay: ix.publishDay(v),
      origin: v.origin,
      views: p.views,
      index7: p.index[7],
      avgViewPct: p.avgViewPct,
      daily: days.map((d) => rows.get(d) ?? 0),
    };
  });
  const lag = lab.rabatteur.tracks.find((t) => t.trackId === trackId) ?? null;
  return {
    track: track
      ? { id: track.id, title: track.title, artist: track.artist, coverUrl: track.coverUrl }
      : null,
    release,
    days,
    elements,
    total: sum(elements.map((e) => e.views)),
    lag: lag
      ? { lag: lag.lag, confidence: lag.confidence, fromOwnShorts: lag.fromOwnShorts }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Video sheet
// ---------------------------------------------------------------------------

export function videoList(data: Dataset, lab: LabResult, filters: Filters) {
  const perf = new Map(lab.videos.map((p) => [p.id, p]));
  return data.videos
    .filter((v) => keep(v, filters))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .map((v) => ({ video: v, perf: perf.get(v.id)! }));
}

export function videoDetail(data: Dataset, lab: LabResult, id: string) {
  const ix = new Indexed(data);
  const video = ix.video.get(id);
  if (!video) return null;
  const perf = lab.videos.find((p) => p.id === id)!;
  const rows = ix.byVideo.get(id) ?? [];
  const days = ix.daysFrom(ix.publishDay(video));
  const map = new Map(rows.map((r) => [r.day, r]));
  const pick = (metric: keyof DayRow) =>
    days.map((d) => (map.get(d)?.[metric] ?? null) as number | null);
  const reach = reachTotals(video, rows);
  const totals: Record<string, number | null> = {
    views: ix.total(video, 'views'),
    engagedViews: rows.some((r) => r.engagedViews !== null)
      ? ix.total(video, 'engagedViews')
      : null,
    minutes: ix.total(video, 'minutes'),
    avgViewPct: perf.avgViewPct,
    avgViewDuration: (() => {
      const views = ix.total(video, 'views');
      return views > 0 ? (ix.total(video, 'minutes') * 60) / views : null;
    })(),
    likes: ix.total(video, 'likes'),
    comments: ix.total(video, 'comments'),
    shares: ix.total(video, 'shares'),
    subsGained: ix.total(video, 'subsGained'),
    subsLost: ix.total(video, 'subsLost'),
    impressions: reach.impressions,
    ctr: reach.ctr,
    subsPer1000: perf.subsPer1000,
    likeRate: perf.likeRate,
    shareRate: perf.shareRate,
    halfLife: perf.halfLife,
  };
  const breakdowns: Partial<
    Record<
      BreakdownKind,
      { key: string; views: number; minutes: number | null; pct: number | null }[]
    >
  > = {};
  for (const b of data.breakdowns) {
    if (b.videoId !== id) continue;
    (breakdowns[b.kind] ??= []).push({
      key: b.key,
      views: b.views,
      minutes: b.minutes,
      pct: b.pct,
    });
  }
  for (const list of Object.values(breakdowns))
    list?.sort((a, b) => (b.pct ?? b.views) - (a.pct ?? a.views));
  const viewsSeries = pick('views').map((v) => v ?? 0);
  const music: RetentionMusic | null = retentionMusic(data, video);
  return {
    video,
    perf,
    usual: Object.fromEntries(
      [1, 3, 7, 30].map((age) => [age, ix.usualAt(video.kind, age, video.id)]),
    ),
    days,
    series: {
      views: viewsSeries,
      minutes: pick('minutes'),
      subsNet: days.map((d) => {
        const r = map.get(d);
        return r ? r.subsGained - r.subsLost : null;
      }),
      avgViewPct: pick('avgViewPct'),
      impressions: pick('impressions'),
      ctr: pick('ctr'),
      /** Source of each day's impressions / CTR (hover). */
      reachSource: days.map((d) => {
        const r = map.get(d);
        return r && (r.impressions !== null || r.ctr !== null) ? (r.reachSource ?? 'api') : null;
      }),
    },
    reachSource: reach.source,
    anomalies: anomalies(viewsSeries, 10).map((a) => ({ day: days[a.index]!, ...a })),
    totals,
    metricHelp: METRICS,
    breakdowns,
    retention: data.retention[id] ?? null,
    music,
  };
}
