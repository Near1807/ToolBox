// The data every page and analysis works on: either the real channel (tables
// of the module) or the demo channel (generated, never stored). Same shape,
// same code, so the demo shows exactly what the real data will look like.
import type {
  BreakdownRow,
  ChannelDay,
  DayRow,
  RetentionPoint,
  Snapshot,
  StatTrack,
  StatVideo,
  VideoKind,
} from '../shared';
import { addDay, atAge, byAge, dayDiff, median } from './stats';

export interface Dataset {
  mode: 'real' | 'demo';
  /** Last day with complete Analytics data (YouTube is 2–3 days behind). */
  lastDay: string;
  channel: { id: string; title: string } | null;
  /** Time zone of the publication hours (heatmap). */
  timeZone: string;
  videos: StatVideo[];
  days: DayRow[];
  channelDays: ChannelDay[];
  snapshots: Snapshot[];
  breakdowns: BreakdownRow[];
  retention: Record<string, RetentionPoint[]>;
  tracks: StatTrack[];
  /** Where impressions / CTR come from. */
  reach: 'api' | 'csv' | 'none';
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const zonedCache = new Map<string, { day: string; hour: number; weekday: number }>();

/** Date and hour of an instant in a time zone (formatters and results cached: hot path). */
export function zoned(
  instant: string,
  timeZone: string,
): { day: string; hour: number; weekday: number } {
  const key = `${timeZone}|${instant}`;
  const cached = zonedCache.get(key);
  if (cached) return cached;
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
    formatters.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  const result = {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    weekday,
  };
  if (zonedCache.size > 50_000) zonedCache.clear();
  zonedCache.set(key, result);
  return result;
}

/** YouTube Analytics days are in Pacific time. */
export const youtubeDay = (instant: string) => zoned(instant, 'America/Los_Angeles').day;

/** Ages at which videos are compared to the channel's usual (J+1, J+3, J+7, J+30). */
export const AGES = [1, 3, 7, 30] as const;

/** Fast lookups over a dataset (built once per request). */
export class Indexed {
  readonly byVideo = new Map<string, DayRow[]>();
  readonly video = new Map<string, StatVideo>();
  private readonly seriesCache = new Map<string, number[]>();
  private readonly medianCache = new Map<string, number | null>();

  constructor(readonly data: Dataset) {
    for (const v of data.videos) {
      this.video.set(v.id, v);
      this.byVideo.set(v.id, []);
    }
    for (const row of data.days) this.byVideo.get(row.videoId)?.push(row);
    for (const rows of this.byVideo.values()) rows.sort((a, b) => a.day.localeCompare(b.day));
  }

  publishDay(video: StatVideo): string {
    return youtubeDay(video.publishedAt);
  }

  /** Age in days of a video at the last complete day. */
  age(video: StatVideo): number {
    return dayDiff(this.publishDay(video), this.data.lastDay);
  }

  /** Daily values by age (0 = publication day) up to the last complete day. */
  series(video: StatVideo, metric: keyof DayRow = 'views'): number[] {
    const key = `${video.id}:${String(metric)}`;
    let cached = this.seriesCache.get(key);
    if (!cached) {
      const rows = (this.byVideo.get(video.id) ?? []).map((r) => ({
        day: r.day,
        value: Number(r[metric] ?? 0),
      }));
      cached = byAge(rows, this.publishDay(video), this.data.lastDay);
      this.seriesCache.set(key, cached);
    }
    return cached;
  }

  /** Total of a metric over the video's life (Analytics days). */
  total(video: StatVideo, metric: keyof DayRow): number {
    let total = 0;
    for (const row of this.byVideo.get(video.id) ?? []) total += Number(row[metric] ?? 0);
    return total;
  }

  viewsAt(video: StatVideo, age: number): number | null {
    return atAge(this.series(video), age);
  }

  /**
   * Median views at an age among the OTHER videos of the same type that are old
   * enough (null with fewer than 3 of them).
   */
  usualAt(kind: VideoKind, age: number, except?: string): number | null {
    const key = `${kind}:${age}:${except ?? ''}`;
    if (this.medianCache.has(key)) return this.medianCache.get(key)!;
    const values = this.data.videos
      .filter((v) => v.kind === kind && v.id !== except)
      .map((v) => this.viewsAt(v, age))
      .filter((v): v is number => v !== null);
    const value = values.length >= 3 ? median(values) : null;
    this.medianCache.set(key, value);
    return value;
  }

  /** Views at an age divided by the usual at that age (1 = as usual). */
  relativeIndex(video: StatVideo, age: number): number | null {
    const views = this.viewsAt(video, age);
    const usual = this.usualAt(video.kind, age, video.id);
    if (views === null || usual === null) return null;
    return (views + 1) / (usual + 1);
  }

  /** Average % viewed over the life of the video (weighted by views). */
  avgViewPct(video: StatVideo): number | null {
    let weighted = 0;
    let views = 0;
    for (const row of this.byVideo.get(video.id) ?? []) {
      if (row.avgViewPct === null || row.views <= 0) continue;
      weighted += row.avgViewPct * row.views;
      views += row.views;
    }
    return views > 0 ? weighted / views : null;
  }

  /** Channel-wide daily views from the per-video rows, for a kind (dates as keys). */
  dailyByKind(kind: VideoKind | 'all'): Map<string, number> {
    const result = new Map<string, number>();
    for (const row of this.data.days) {
      const video = this.video.get(row.videoId);
      if (!video || (kind !== 'all' && video.kind !== kind)) continue;
      result.set(row.day, (result.get(row.day) ?? 0) + row.views);
    }
    return result;
  }

  /** Dates from `from` to the last complete day. */
  daysFrom(from: string): string[] {
    const count = dayDiff(from, this.data.lastDay) + 1;
    return Array.from({ length: Math.max(0, count) }, (_, i) => addDay(from, i));
  }

  firstDay(): string {
    const days = this.data.videos.map((v) => this.publishDay(v)).sort();
    return days[0] ?? this.data.lastDay;
  }
}
