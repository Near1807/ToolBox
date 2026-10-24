// Synchronisation with YouTube: channel snapshot, list of the uploads, then
// day-by-day statistics of the channel and of each video (history caught up
// the first time, then only the last days again — YouTube revises them),
// retention curves and breakdowns refreshed every few days. Stops cleanly on a
// quota error (the next run continues where it stopped).
import type { BreakdownKind, ChannelDay, DayRow, RetentionPoint } from '../shared';
import { youtubeDay } from './dataset';
import { GoogleApiError, type GoogleClient, parseIsoDuration, type ReportRow } from './google';
import type { StatsStore, VideoRow } from './store';
import { addDay, dayDiff } from './stats';

export interface SyncOptions {
  /** Last day with (nearly) complete Analytics data. */
  lastDay: string;
  /** Days of history always fetched again (YouTube revises them). */
  refreshDays: number;
  /** Retention and breakdowns are refreshed after this many days. */
  detailsEveryDays: number;
  /**
   * Strict minimum (uploads due soon): the channel, the list of the videos and
   * the channel days only; the per-video statistics wait for the next sync.
   */
  minimal?: boolean;
  /**
   * The whole history of every video and of the channel again (after a CSV
   * created rows the sync took for known days, or after CSV data was deleted).
   */
  fullHistory?: boolean;
  /** Requests in flight at once for the per-video statistics (4 by default). */
  concurrency?: number;
  progress: (fraction: number, message: string) => void;
  signal: AbortSignal;
  log: (message: string) => void;
}

export interface SyncSummary {
  calls: number;
  videos: number;
  /** Day rows received from Analytics (videos). */
  dayRows: number;
  retention: number;
  breakdowns: number;
  warnings: string[];
  /** Period asked to Analytics (null: nothing asked, e.g. postponed). */
  requested?: { from: string; to: string } | null;
  /** Rows (video days + channel days) new or really different from what was stored. */
  changed?: number;
  /** Last day Analytics gave data for, before and after this sync. */
  previousLastDay?: string | null;
  lastAvailableDay?: string | null;
  /** Days of the channel received for the first time. */
  newDays?: number;
  /** Videos whose statistics were asked (the others had nothing to ask yet). */
  videosAsked?: number;
  fullHistory?: boolean;
  /** Milliseconds per step, and in all. */
  durations?: Record<string, number>;
  totalMs?: number;
}

const num = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0)) || 0;
const nullableNum = (value: unknown) =>
  value === undefined || value === null || value === '' ? null : Number(value);

const CORE_METRICS = [
  'views',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'likes',
  'comments',
  'shares',
  'subscribersGained',
  'subscribersLost',
];

function dayRow(videoId: string, r: ReportRow): DayRow {
  return {
    videoId,
    day: String(r.day),
    views: num(r.views),
    engagedViews: nullableNum(r.engagedViews),
    minutes: num(r.estimatedMinutesWatched),
    avgViewDuration: nullableNum(r.averageViewDuration),
    avgViewPct: nullableNum(r.averageViewPercentage),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares),
    subsGained: num(r.subscribersGained),
    subsLost: num(r.subscribersLost),
    impressions: nullableNum(r.videoThumbnailImpressions),
    ctr: nullableNum(r.videoThumbnailImpressionsClickRate),
  };
}

/** Chunks of an array. */
function chunks<T>(list: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, i * size + size),
  );
}

export async function syncChannel(
  client: GoogleClient,
  store: StatsStore,
  options: SyncOptions,
): Promise<SyncSummary> {
  const started = Date.now();
  const durations: Record<string, number> = {};
  let mark = started;
  const step = (name: string) => {
    const now = Date.now();
    durations[name] = (durations[name] ?? 0) + now - mark;
    mark = now;
  };
  const summary: SyncSummary = {
    calls: 0,
    videos: 0,
    dayRows: 0,
    retention: 0,
    breakdowns: 0,
    warnings: [],
    requested: null,
    changed: 0,
    previousLastDay: store.lastChannelDay(),
    lastAvailableDay: null,
    newDays: 0,
    videosAsked: 0,
    fullHistory: Boolean(options.fullHistory),
    durations,
    totalMs: 0,
  };
  const finish = (message: string) => {
    summary.calls = client.calls;
    summary.lastAvailableDay = store.lastChannelDay();
    summary.totalMs = Date.now() - started;
    options.progress(1, message);
    return summary;
  };
  const ask = (from: string) => {
    if (!summary.requested) summary.requested = { from, to: options.lastDay };
    else if (from < summary.requested.from) summary.requested.from = from;
  };
  const check = () => {
    if (options.signal.aborted) throw new Error('Synchronisation annulée');
  };
  const { lastDay } = options;
  const today = new Date().toISOString().slice(0, 10);

  // 1. Channel and its live counters.
  options.progress(0.02, 'Chaîne…');
  const channels = await client.data<{
    items?: {
      id: string;
      snippet?: { title?: string };
      statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }[];
  }>('channels', { part: 'snippet,statistics,contentDetails', mine: 'true' });
  const channel = channels.items?.[0];
  if (!channel) throw new Error('Aucune chaîne YouTube sur ce compte Google');
  store.setMeta('channel', { id: channel.id, title: channel.snippet?.title ?? '' });
  store.snapshot({
    day: today,
    subscribers: num(channel.statistics?.subscriberCount),
    views: num(channel.statistics?.viewCount),
    videos: num(channel.statistics?.videoCount),
  });

  // 2. Uploads (public, unlisted, private, scheduled: everything of the channel).
  options.progress(0.05, 'Liste des vidéos…');
  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  const ids: string[] = [];
  if (uploads) {
    let pageToken: string | undefined;
    do {
      check();
      const page = await client.data<{
        items?: { contentDetails?: { videoId?: string } }[];
        nextPageToken?: string;
      }>('playlistItems', {
        part: 'contentDetails',
        playlistId: uploads,
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of page.items ?? [])
        if (item.contentDetails?.videoId) ids.push(item.contentDetails.videoId);
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  for (const group of chunks(ids, 50)) {
    check();
    const page = await client.data<{
      items?: {
        id: string;
        snippet?: {
          title?: string;
          publishedAt?: string;
          thumbnails?: Record<string, { url?: string }>;
        };
        contentDetails?: { duration?: string };
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
        status?: { privacyStatus?: string; publishAt?: string };
      }[];
    }>('videos', {
      part: 'snippet,contentDetails,statistics,status',
      id: group.join(','),
      maxResults: '50',
    });
    for (const v of page.items ?? []) {
      const duration = parseIsoDuration(v.contentDetails?.duration);
      store.upsertVideo({
        id: v.id,
        title: v.snippet?.title ?? v.id,
        published_at:
          v.status?.publishAt && v.status.privacyStatus === 'private'
            ? v.status.publishAt
            : (v.snippet?.publishedAt ?? new Date().toISOString()),
        duration_sec: duration,
        // Until Analytics says (creatorContentType), up to 3 min is guessed a Short.
        kind: duration > 0 && duration <= 180 ? 'short' : 'video',
        kind_source: 'duration',
        thumbnail_url:
          v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? null,
        privacy: v.status?.privacyStatus ?? null,
        total_views: num(v.statistics?.viewCount),
        total_likes: num(v.statistics?.likeCount),
        total_comments: num(v.statistics?.commentCount),
      });
    }
  }
  step('videos');
  const videos = store.videos().filter((v) => ids.includes(v.id));
  summary.videos = videos.length;
  // Only videos already published have statistics.
  const live = videos.filter(
    (v) => youtubeDay(v.published_at) <= lastDay && v.privacy !== 'private',
  );

  // 3. Channel days (history caught up, then the last days again).
  check();
  options.progress(0.1, 'Statistiques de la chaîne…');
  const firstPublished = live.map((v) => youtubeDay(v.published_at)).sort()[0];
  const lastChannelDay = options.fullHistory ? null : store.lastChannelDay();
  const channelFrom = lastChannelDay
    ? addDay(lastChannelDay, -options.refreshDays)
    : firstPublished;
  if (channelFrom && channelFrom <= lastDay) {
    ask(channelFrom);
    const rows = await client.report({
      startDate: channelFrom,
      endDate: lastDay,
      dimensions: ['day'],
      metrics: [
        'views',
        'estimatedMinutesWatched',
        'likes',
        'comments',
        'shares',
        'subscribersGained',
        'subscribersLost',
      ],
      sort: 'day',
    });
    const previous = summary.previousLastDay;
    summary.newDays = rows.filter((r) => !previous || String(r.day) > previous).length;
    summary.changed! += store.upsertChannelDays(
      rows.map((r): ChannelDay => ({
        day: String(r.day),
        views: num(r.views),
        minutes: num(r.estimatedMinutesWatched),
        subsGained: num(r.subscribersGained),
        subsLost: num(r.subscribersLost),
        likes: num(r.likes),
        comments: num(r.comments),
        shares: num(r.shares),
      })),
    );
    // Subscribers before today: rebuilt backwards from today's count (first sync only).
    if (!summary.previousLastDay) {
      let subscribers = num(channel.statistics?.subscriberCount);
      let views = num(channel.statistics?.viewCount);
      const sorted = [...rows].sort((a, b) => String(b.day).localeCompare(String(a.day)));
      for (const r of sorted) {
        store.snapshot({ day: String(r.day), subscribers, views, videos: live.length });
        subscribers -= num(r.subscribersGained) - num(r.subscribersLost);
        views -= num(r.views);
      }
    }
  }

  step('channel');
  if (options.minimal) {
    summary.warnings.push(
      'Synchronisation minimale : des envois YouTube sont prévus dans les 24 h (le Planning passe en premier). Le détail par vidéo suivra.',
    );
    return finish('Synchronisation minimale terminée');
  }

  // 4. Every video: kind, days, retention, breakdowns.
  let reach = store.meta<string>('reach');
  const reachCheckedAt = store.meta<string>('reachCheckedAt');
  if (
    reach === 'unavailable' &&
    (!reachCheckedAt || dayDiff(reachCheckedAt.slice(0, 10), today) >= 7)
  )
    reach = null;
  let engaged = store.meta<boolean>('engagedViews');
  let done = 0;
  const one = async (video: VideoRow) => {
    check();
    const published = youtubeDay(video.published_at);
    const last = options.fullHistory ? null : store.lastDayOf(video.id);
    const from = last ? addDay(last, -options.refreshDays) : published;
    const start = from < published ? published : from;
    if (start <= lastDay) {
      ask(start);
      summary.videosAsked!++;
      const query = {
        startDate: start,
        endDate: lastDay,
        dimensions: ['day'],
        metrics: CORE_METRICS,
        filters: `video==${video.id}`,
        sort: 'day',
      };
      const result = await client.reportWithFallback(
        query,
        engaged === false ? [] : ['engagedViews'],
      );
      if (engaged === null) {
        engaged = result.optional;
        store.setMeta('engagedViews', engaged);
      }
      summary.changed! += store.upsertDays(result.rows.map((r) => dayRow(video.id, r)));
      summary.dayRows += result.rows.length;
      // Impressions and click-through rate: only when Google accepts them in the API.
      if (reach !== 'unavailable') {
        try {
          const reachRows = await client.report({
            ...query,
            metrics: ['videoThumbnailImpressions', 'videoThumbnailImpressionsClickRate'],
          });
          store.upsertReach(
            reachRows.map((r) => dayRow(video.id, r)),
            { kind: 'api' },
          );
          if (reach !== 'api') {
            reach = 'api';
            store.setMeta('reach', 'api');
          }
        } catch (error) {
          if (!(error instanceof GoogleApiError) || error.kind !== 'unsupported') throw error;
          if (reach !== 'unavailable') {
            reach = 'unavailable';
            store.setMeta('reach', 'unavailable');
            store.setMeta('reachCheckedAt', new Date().toISOString());
            summary.warnings.push(
              'Impressions et taux de clics non fournis par l’API pour ta chaîne : importe l’export CSV de YouTube Studio pour les avoir.',
            );
          }
        }
      }
    }
    const due = (at: string | null) =>
      !at || dayDiff(at.slice(0, 10), today) >= options.detailsEveryDays;
    if (due(video.breakdowns_at)) {
      summary.breakdowns += await syncBreakdowns(client, store, video, lastDay);
      store.setVideoFields(video.id, { breakdowns_at: new Date().toISOString() });
    }
    if (due(video.retention_at)) {
      const points = await retentionOf(client, video, lastDay);
      if (points.length) {
        store.replaceRetention(video.id, points);
        summary.retention++;
      }
      store.setVideoFields(video.id, { retention_at: new Date().toISOString() });
    }
    done++;
    options.progress(
      0.15 + (0.8 * done) / Math.max(1, live.length),
      `Vidéo ${done} sur ${live.length} : ${video.title}`,
    );
  };
  // The first video alone (it tells which optional metrics Google accepts),
  // then a few at once: one after the other, a channel of 100 videos took minutes.
  const queue = [...live];
  const first = queue.shift();
  if (first) await one(first);
  const workers = Math.max(1, options.concurrency ?? 4);
  let failure: unknown = null;
  // Every worker ends before the sync answers (no request left writing after an error).
  await Promise.allSettled(
    Array.from({ length: Math.min(workers, queue.length) }, async () => {
      for (let video = queue.shift(); video && failure === null; video = queue.shift()) {
        try {
          await one(video);
        } catch (error) {
          failure ??= error;
        }
      }
    }),
  );
  if (failure !== null) throw failure;
  step('perVideo');

  // 5. Channel-wide breakdowns (whole history).
  check();
  options.progress(0.96, 'Répartitions de la chaîne…');
  if (firstPublished && firstPublished <= lastDay) {
    await channelBreakdowns(client, store, firstPublished, lastDay);
  }
  step('channelBreakdowns');
  return finish('Synchronisation terminée');
}

async function retentionOf(
  client: GoogleClient,
  video: VideoRow,
  lastDay: string,
): Promise<RetentionPoint[]> {
  try {
    const rows = await client.report({
      startDate: youtubeDay(video.published_at),
      endDate: lastDay,
      dimensions: ['elapsedVideoTimeRatio'],
      metrics: ['audienceWatchRatio', 'relativeRetentionPerformance'],
      filters: `video==${video.id}`,
      sort: 'elapsedVideoTimeRatio',
    });
    return rows.map((r) => ({
      ratio: num(r.elapsedVideoTimeRatio),
      watch: num(r.audienceWatchRatio),
      relative: nullableNum(r.relativeRetentionPerformance),
    }));
  } catch (error) {
    // Too few views: YouTube has no retention for this video yet.
    if (error instanceof GoogleApiError && error.kind === 'unsupported') return [];
    throw error;
  }
}

async function syncBreakdowns(
  client: GoogleClient,
  store: StatsStore,
  video: VideoRow,
  lastDay: string,
): Promise<number> {
  const base = {
    startDate: youtubeDay(video.published_at),
    endDate: lastDay,
    filters: `video==${video.id}`,
  };
  let count = 0;
  const save = (kind: BreakdownKind, rows: ReportRow[], key: string, pct = false) => {
    store.replaceBreakdowns(
      video.id,
      kind,
      rows.map((r) => ({
        key: String(r[key]),
        views: pct ? 0 : num(r.views),
        minutes: r.estimatedMinutesWatched === undefined ? null : num(r.estimatedMinutesWatched),
        pct: pct ? num(r.viewerPercentage) : null,
      })),
    );
    count += rows.length;
  };
  const tryReport = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      // A breakdown YouTube refuses (too few views, privacy threshold) is skipped.
      if (!(error instanceof GoogleApiError) || error.kind !== 'unsupported') throw error;
    }
  };
  await tryReport(async () => {
    const rows = await client.report({
      ...base,
      dimensions: ['creatorContentType'],
      metrics: ['views'],
    });
    save('content_type', rows, 'creatorContentType');
    const top = [...rows].sort((a, b) => num(b.views) - num(a.views))[0];
    if (top) {
      const kind = String(top.creatorContentType) === 'SHORTS' ? 'short' : 'video';
      store.setVideoFields(video.id, { kind, kind_source: 'api' });
    }
  });
  await tryReport(async () =>
    save(
      'traffic',
      await client.report({
        ...base,
        dimensions: ['insightTrafficSourceType'],
        metrics: ['views', 'estimatedMinutesWatched'],
      }),
      'insightTrafficSourceType',
    ),
  );
  await tryReport(async () =>
    save(
      'country',
      await client.report({
        ...base,
        dimensions: ['country'],
        metrics: ['views', 'estimatedMinutesWatched'],
        sort: '-views',
        maxResults: 25,
      }),
      'country',
    ),
  );
  await tryReport(async () =>
    save(
      'device',
      await client.report({
        ...base,
        dimensions: ['deviceType'],
        metrics: ['views', 'estimatedMinutesWatched'],
      }),
      'deviceType',
    ),
  );
  await tryReport(async () =>
    save(
      'playback',
      await client.report({
        ...base,
        dimensions: ['insightPlaybackLocationType'],
        metrics: ['views', 'estimatedMinutesWatched'],
      }),
      'insightPlaybackLocationType',
    ),
  );
  await tryReport(async () => {
    const rows = await client.report({
      ...base,
      dimensions: ['ageGroup', 'gender'],
      metrics: ['viewerPercentage'],
    });
    save(
      'age_gender',
      rows.map((r) => ({ ...r, key: `${r.ageGroup}|${r.gender}` })),
      'key',
      true,
    );
  });
  // Suggested videos that sent viewers here (finds the track's own Shorts).
  await tryReport(async () =>
    save(
      'related',
      await client.report({
        ...base,
        dimensions: ['insightTrafficSourceDetail'],
        metrics: ['views'],
        filters: `video==${video.id};insightTrafficSourceType==RELATED_VIDEO`,
        sort: '-views',
        maxResults: 25,
      }),
      'insightTrafficSourceDetail',
    ),
  );
  return count;
}

async function channelBreakdowns(
  client: GoogleClient,
  store: StatsStore,
  from: string,
  lastDay: string,
): Promise<void> {
  const base = { startDate: from, endDate: lastDay };
  const run = async (
    kind: BreakdownKind,
    dimension: string,
    extra: Record<string, unknown> = {},
  ) => {
    try {
      const rows = await client.report({
        ...base,
        dimensions: [dimension],
        metrics: ['views', 'estimatedMinutesWatched'],
        ...extra,
      });
      store.replaceBreakdowns(
        '',
        kind,
        rows.map((r) => ({
          key: String(r[dimension]),
          views: num(r.views),
          minutes: num(r.estimatedMinutesWatched),
          pct: null,
        })),
      );
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.kind !== 'unsupported') throw error;
    }
  };
  await run('traffic', 'insightTrafficSourceType');
  await run('country', 'country', { sort: '-views', maxResults: 25 });
  await run('device', 'deviceType');
  await run('playback', 'insightPlaybackLocationType');
  await run('content_type', 'creatorContentType');
  try {
    const rows = await client.report({
      ...base,
      dimensions: ['ageGroup', 'gender'],
      metrics: ['viewerPercentage'],
    });
    store.replaceBreakdowns(
      '',
      'age_gender',
      rows.map((r) => ({
        key: `${r.ageGroup}|${r.gender}`,
        views: 0,
        minutes: null,
        pct: num(r.viewerPercentage),
      })),
    );
  } catch (error) {
    if (!(error instanceof GoogleApiError) || error.kind !== 'unsupported') throw error;
  }
}
