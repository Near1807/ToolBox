// Local storage of the statistics (tables of the module): everything is kept,
// so trends can be computed over years even if YouTube changes its API. The
// real dataset is built from these tables + what the other modules know.
import type { MigrationDatabase, ModuleContext } from '@hub/sdk/backend';
import type { CustomReelsService } from '../../custom-reels/contract';
import type { InstagramPackService } from '../../instagram-video/contract';
import type { MusicLibraryService } from '../../music-library/contract';
import type { PlannedYouTubeItem, ReleasePlannerService } from '../../release-planner/contract';
import type {
  BreakdownKind,
  BreakdownRow,
  ChannelDay,
  DayRow,
  RetentionPoint,
  Snapshot,
  StatTrack,
  StatVideo,
  VideoOrigin,
} from '../shared';
import type { Dataset } from './dataset';
import type { JournalEntry } from './theories';

export const MIGRATION_V1 = `
  CREATE TABLE youtube_stats__videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    published_at TEXT NOT NULL,
    duration_sec REAL NOT NULL DEFAULT 0,
    kind TEXT NOT NULL,
    kind_source TEXT NOT NULL DEFAULT 'duration',
    thumbnail_url TEXT,
    privacy TEXT,
    total_views INTEGER NOT NULL DEFAULT 0,
    total_likes INTEGER NOT NULL DEFAULT 0,
    total_comments INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER,
    ctr REAL,
    link_mode TEXT,
    manual_track_id INTEGER,
    retention_at TEXT,
    breakdowns_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE youtube_stats__days (
    video_id TEXT NOT NULL,
    day TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    engaged_views INTEGER,
    minutes REAL NOT NULL DEFAULT 0,
    avg_view_duration REAL,
    avg_view_pct REAL,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    subs_gained INTEGER NOT NULL DEFAULT 0,
    subs_lost INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER,
    ctr REAL,
    PRIMARY KEY (video_id, day)
  );
  CREATE TABLE youtube_stats__channel_days (
    day TEXT PRIMARY KEY,
    views INTEGER NOT NULL DEFAULT 0,
    minutes REAL NOT NULL DEFAULT 0,
    subs_gained INTEGER NOT NULL DEFAULT 0,
    subs_lost INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE youtube_stats__snapshots (
    day TEXT PRIMARY KEY,
    subscribers INTEGER NOT NULL,
    views INTEGER NOT NULL,
    videos INTEGER NOT NULL
  );
  CREATE TABLE youtube_stats__breakdowns (
    video_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    minutes REAL,
    pct REAL,
    PRIMARY KEY (video_id, kind, key)
  );
  CREATE TABLE youtube_stats__retention (
    video_id TEXT NOT NULL,
    ratio REAL NOT NULL,
    watch REAL NOT NULL,
    relative REAL,
    PRIMARY KEY (video_id, ratio)
  );
  CREATE TABLE youtube_stats__waveforms (
    track_id INTEGER PRIMARY KEY,
    duration_sec REAL NOT NULL,
    peaks TEXT NOT NULL,
    computed_at TEXT NOT NULL
  );
  CREATE TABLE youtube_stats__imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    kind TEXT NOT NULL,
    rows INTEGER NOT NULL,
    matched INTEGER NOT NULL,
    columns TEXT NOT NULL
  );
  CREATE TABLE youtube_stats__journal (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE youtube_stats__meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/**
 * Provenance of every number (v0.18): `api_at` = when the Analytics API last
 * wrote the core metrics of a day (NULL: a row only a CSV created, with no
 * views of its own); `reach_source` / `import_id` = where impressions and CTR
 * come from ('api', 'csv' + its import, 'unknown' when it cannot be told).
 * Rows of before are labelled from what can be known for sure (see ADR 0033).
 */
export function migrationV2(db: MigrationDatabase): void {
  const t = (name: string) => db.table(name);
  db.exec(`
    ALTER TABLE ${t('days')} ADD COLUMN api_at TEXT;
    ALTER TABLE ${t('days')} ADD COLUMN reach_source TEXT;
    ALTER TABLE ${t('days')} ADD COLUMN import_id INTEGER;
    ALTER TABLE ${t('videos')} ADD COLUMN reach_import_id INTEGER;
    ALTER TABLE ${t('imports')} ADD COLUMN period_from TEXT;
    ALTER TABLE ${t('imports')} ADD COLUMN period_to TEXT;
    ALTER TABLE ${t('imports')} ADD COLUMN metrics TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE ${t('imports')} ADD COLUMN legacy INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${t('imports')} ADD COLUMN days INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX ${t('days_import')} ON ${t('days')} (import_id);
  `);
  // The API always gives an average view duration; a CSV row never has one.
  db.exec(`UPDATE ${t('days')} SET api_at = 'avant-0.18' WHERE avg_view_duration IS NOT NULL`);
  const imports = db.prepare(`SELECT id, kind FROM ${t('imports')} ORDER BY id`).all() as {
    id: number;
    kind: string;
  }[];
  db.exec(`UPDATE ${t('imports')} SET legacy = 1`);
  const meta = db.prepare(`SELECT value FROM ${t('meta')} WHERE key = 'reach'`).get() as
    { value: string } | undefined;
  const apiReach = meta?.value === '"api"';
  const daily = imports.filter((i) => i.kind === 'daily');
  const totals = imports.filter((i) => i.kind === 'totals');
  const withReach = `impressions IS NOT NULL OR ctr IS NOT NULL`;
  if (daily.length === 0) {
    // No daily import: impressions of the days can only come from the API.
    db.exec(`UPDATE ${t('days')} SET reach_source = 'api' WHERE ${withReach}`);
  } else if (!apiReach && daily.length === 1) {
    // The API never gave them and a single daily import exists: they are its own.
    db.prepare(
      `UPDATE ${t('days')} SET reach_source = 'csv', import_id = ? WHERE ${withReach}`,
    ).run(daily[0]!.id);
  } else {
    // Several imports, or the API and CSV both wrote them: not attributable for sure.
    db.exec(
      `UPDATE ${t('days')} SET reach_source = '${apiReach ? 'unknown' : 'csv'}' WHERE ${withReach}`,
    );
  }
  // Impressions of a whole video only come from a « totals » CSV.
  if (totals.length === 1)
    db.prepare(
      `UPDATE ${t('videos')} SET reach_import_id = ? WHERE impressions IS NOT NULL OR ctr IS NOT NULL`,
    ).run(totals[0]!.id);
  // Period and number of days of the imports that could be attributed.
  db.exec(`
    UPDATE ${t('imports')} SET
      period_from = (SELECT MIN(day) FROM ${t('days')} d WHERE d.import_id = ${t('imports')}.id),
      period_to = (SELECT MAX(day) FROM ${t('days')} d WHERE d.import_id = ${t('imports')}.id),
      days = (SELECT COUNT(*) FROM ${t('days')} d WHERE d.import_id = ${t('imports')}.id)
  `);
  // Rows only a CSV created made the sync believe those days were known (the
  // « numbers frozen after an import »): the next sync fetches the whole history again.
  const holes = db.prepare(`SELECT COUNT(*) AS n FROM ${t('days')} WHERE api_at IS NULL`).get() as {
    n: number;
  };
  if (holes.n > 0)
    db.exec(
      `INSERT INTO ${t('meta')} (key, value) VALUES ('fullResync', '"migration-0.18"')
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
}

export interface ImportRow {
  id: number;
  file_name: string;
  imported_at: string;
  kind: string;
  rows: number;
  matched: number;
  columns: string;
  metrics: string[];
  period_from: string | null;
  period_to: string | null;
  days: number;
  /** Videos whose whole-life impressions / CTR come from this import (« totals »). */
  videos: number;
  /** Made before v0.18: its data could not always be told from the others. */
  legacy: boolean;
}

export interface VideoRow {
  id: string;
  title: string;
  published_at: string;
  duration_sec: number;
  kind: 'video' | 'short';
  kind_source: 'api' | 'duration';
  thumbnail_url: string | null;
  privacy: string | null;
  total_views: number;
  total_likes: number;
  total_comments: number;
  impressions: number | null;
  ctr: number | null;
  reach_import_id: number | null;
  /** null: automatic (Planning) · 'manual': manual_track_id · 'none': not a track's. */
  link_mode: 'manual' | 'none' | null;
  manual_track_id: number | null;
  retention_at: string | null;
  breakdowns_at: string | null;
  updated_at: string;
}

interface DayDbRow {
  video_id: string;
  day: string;
  views: number;
  engaged_views: number | null;
  minutes: number;
  avg_view_duration: number | null;
  avg_view_pct: number | null;
  likes: number;
  comments: number;
  shares: number;
  subs_gained: number;
  subs_lost: number;
  impressions: number | null;
  ctr: number | null;
  api_at: string | null;
  reach_source: 'api' | 'csv' | 'unknown' | null;
  import_id: number | null;
}

export interface LinkServices {
  library?: MusicLibraryService;
  planner?: ReleasePlannerService;
  packs?: InstagramPackService;
  customReels?: CustomReelsService;
  /** Media URL of a track cover. */
  coverUrl?: (path: string | null) => string | null;
}

const EMPTY_ORIGIN: VideoOrigin = {
  link: null,
  trackId: null,
  label: null,
  source: null,
  position: null,
  excerptStart: null,
  excerptDuration: null,
  effect: null,
  intensity: null,
  audioMode: null,
};

export class StatsStore {
  readonly t: Record<
    | 'videos'
    | 'days'
    | 'channelDays'
    | 'snapshots'
    | 'breakdowns'
    | 'retention'
    | 'waveforms'
    | 'imports'
    | 'journal'
    | 'meta',
    string
  >;

  constructor(private readonly ctx: ModuleContext) {
    const db = ctx.db;
    this.t = {
      videos: db.table('videos'),
      days: db.table('days'),
      channelDays: db.table('channel_days'),
      snapshots: db.table('snapshots'),
      breakdowns: db.table('breakdowns'),
      retention: db.table('retention'),
      waveforms: db.table('waveforms'),
      imports: db.table('imports'),
      journal: db.table('journal'),
      meta: db.table('meta'),
    };
  }

  // Meta ---------------------------------------------------------------------

  meta<T>(key: string): T | null {
    const row = this.ctx.db.prepare(`SELECT value FROM ${this.t.meta} WHERE key = ?`).get(key) as
      { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  setMeta(key: string, value: unknown): void {
    this.ctx.db
      .prepare(
        `INSERT INTO ${this.t.meta} (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value));
  }

  // Videos -------------------------------------------------------------------

  videos(): VideoRow[] {
    return this.ctx.db
      .prepare(`SELECT * FROM ${this.t.videos} ORDER BY published_at`)
      .all() as VideoRow[];
  }

  video(id: string): VideoRow | null {
    return (
      (this.ctx.db.prepare(`SELECT * FROM ${this.t.videos} WHERE id = ?`).get(id) as VideoRow) ??
      null
    );
  }

  upsertVideo(
    v: Omit<
      VideoRow,
      | 'link_mode'
      | 'manual_track_id'
      | 'retention_at'
      | 'breakdowns_at'
      | 'impressions'
      | 'ctr'
      | 'reach_import_id'
      | 'updated_at'
    >,
  ): void {
    this.ctx.db
      .prepare(
        `INSERT INTO ${this.t.videos} (id, title, published_at, duration_sec, kind, kind_source, thumbnail_url, privacy,
           total_views, total_likes, total_comments, updated_at)
         VALUES (@id, @title, @published_at, @duration_sec, @kind, @kind_source, @thumbnail_url, @privacy,
           @total_views, @total_likes, @total_comments, @now)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title, published_at = excluded.published_at,
           duration_sec = excluded.duration_sec, thumbnail_url = excluded.thumbnail_url, privacy = excluded.privacy,
           total_views = excluded.total_views, total_likes = excluded.total_likes,
           total_comments = excluded.total_comments, updated_at = excluded.updated_at,
           kind = CASE WHEN ${this.t.videos}.kind_source = 'api' THEN ${this.t.videos}.kind ELSE excluded.kind END,
           kind_source = CASE WHEN ${this.t.videos}.kind_source = 'api' THEN 'api' ELSE excluded.kind_source END`,
      )
      .run({ ...v, now: new Date().toISOString() });
  }

  setVideoFields(id: string, fields: Partial<VideoRow>): void {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    this.ctx.db
      .prepare(
        `UPDATE ${this.t.videos} SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`,
      )
      .run({ ...fields, id });
  }

  // Daily rows -----------------------------------------------------------------

  /**
   * Core metrics of days from the Analytics API (never impressions / CTR, see
   * upsertReach). Returns how many rows were new or really changed.
   */
  upsertDays(rows: DayRow[]): number {
    const statement = this.ctx.db.prepare(
      `INSERT INTO ${this.t.days} (video_id, day, views, engaged_views, minutes, avg_view_duration, avg_view_pct,
         likes, comments, shares, subs_gained, subs_lost, api_at)
       VALUES (@videoId, @day, @views, @engagedViews, @minutes, @avgViewDuration, @avgViewPct,
         @likes, @comments, @shares, @subsGained, @subsLost, @now)
       ON CONFLICT (video_id, day) DO UPDATE SET views = excluded.views, engaged_views = excluded.engaged_views,
         minutes = excluded.minutes, avg_view_duration = excluded.avg_view_duration,
         avg_view_pct = excluded.avg_view_pct, likes = excluded.likes, comments = excluded.comments,
         shares = excluded.shares, subs_gained = excluded.subs_gained, subs_lost = excluded.subs_lost,
         api_at = excluded.api_at
       WHERE ${this.t.days}.api_at IS NULL OR views IS NOT excluded.views
         OR engaged_views IS NOT excluded.engaged_views OR minutes IS NOT excluded.minutes
         OR avg_view_duration IS NOT excluded.avg_view_duration OR avg_view_pct IS NOT excluded.avg_view_pct
         OR likes IS NOT excluded.likes OR comments IS NOT excluded.comments OR shares IS NOT excluded.shares
         OR subs_gained IS NOT excluded.subs_gained OR subs_lost IS NOT excluded.subs_lost`,
    );
    const now = new Date().toISOString();
    let changed = 0;
    this.ctx.db.transaction(() => {
      for (const row of rows) changed += statement.run({ ...row, now }).changes;
    });
    return changed;
  }

  /**
   * Impressions and CTR of days. From the API they always win; from a CSV they
   * only fill what the API did not give (never over an API value), labelled
   * with their import. Returns the rows written and those kept from the API.
   */
  upsertReach(
    rows: { videoId: string; day: string; impressions: number | null; ctr: number | null }[],
    source: { kind: 'api' } | { kind: 'csv'; importId: number },
  ): { written: number; keptApi: number } {
    const importId = source.kind === 'csv' ? source.importId : null;
    const statement = this.ctx.db.prepare(
      `INSERT INTO ${this.t.days} (video_id, day, impressions, ctr, reach_source, import_id)
       VALUES (@videoId, @day, @impressions, @ctr, @source, @importId)
       ON CONFLICT (video_id, day) DO UPDATE SET impressions = excluded.impressions, ctr = excluded.ctr,
         reach_source = excluded.reach_source, import_id = excluded.import_id
       ${source.kind === 'csv' ? `WHERE ${this.t.days}.reach_source IS NOT 'api'` : ''}`,
    );
    let written = 0;
    this.ctx.db.transaction(() => {
      for (const row of rows)
        written += statement.run({ ...row, source: source.kind, importId }).changes;
    });
    return { written, keptApi: rows.length - written };
  }

  /** Last day the Analytics API gave for a video (rows a CSV created do not count). */
  lastDayOf(videoId: string): string | null {
    const row = this.ctx.db
      .prepare(
        `SELECT MAX(day) AS day FROM ${this.t.days} WHERE video_id = ? AND api_at IS NOT NULL`,
      )
      .get(videoId) as { day: string | null };
    return row.day;
  }

  /** Returns how many days were new or really changed. */
  upsertChannelDays(rows: ChannelDay[]): number {
    const statement = this.ctx.db.prepare(
      `INSERT INTO ${this.t.channelDays} (day, views, minutes, subs_gained, subs_lost, likes, comments, shares)
       VALUES (@day, @views, @minutes, @subsGained, @subsLost, @likes, @comments, @shares)
       ON CONFLICT (day) DO UPDATE SET views = excluded.views, minutes = excluded.minutes,
         subs_gained = excluded.subs_gained, subs_lost = excluded.subs_lost, likes = excluded.likes,
         comments = excluded.comments, shares = excluded.shares
       WHERE views IS NOT excluded.views OR minutes IS NOT excluded.minutes
         OR subs_gained IS NOT excluded.subs_gained OR subs_lost IS NOT excluded.subs_lost
         OR likes IS NOT excluded.likes OR comments IS NOT excluded.comments OR shares IS NOT excluded.shares`,
    );
    let changed = 0;
    this.ctx.db.transaction(() => {
      for (const row of rows) changed += statement.run(row).changes;
    });
    return changed;
  }

  lastChannelDay(): string | null {
    return (
      this.ctx.db.prepare(`SELECT MAX(day) AS day FROM ${this.t.channelDays}`).get() as {
        day: string | null;
      }
    ).day;
  }

  snapshot(s: Snapshot): void {
    this.ctx.db
      .prepare(
        `INSERT INTO ${this.t.snapshots} (day, subscribers, views, videos) VALUES (@day, @subscribers, @views, @videos)
         ON CONFLICT (day) DO UPDATE SET subscribers = excluded.subscribers, views = excluded.views, videos = excluded.videos`,
      )
      .run(s);
  }

  replaceBreakdowns(
    videoId: string,
    kind: BreakdownKind,
    rows: Omit<BreakdownRow, 'videoId' | 'kind'>[],
  ): void {
    this.ctx.db.transaction(() => {
      this.ctx.db
        .prepare(`DELETE FROM ${this.t.breakdowns} WHERE video_id = ? AND kind = ?`)
        .run(videoId, kind);
      const insert = this.ctx.db.prepare(
        `INSERT INTO ${this.t.breakdowns} (video_id, kind, key, views, minutes, pct) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      // Same key twice (never expected from Google, but harmless): summed.
      const merged = new Map<string, Omit<BreakdownRow, 'videoId' | 'kind'>>();
      for (const r of rows) {
        const previous = merged.get(r.key);
        merged.set(
          r.key,
          previous
            ? {
                key: r.key,
                views: previous.views + r.views,
                minutes:
                  previous.minutes === null && r.minutes === null
                    ? null
                    : (previous.minutes ?? 0) + (r.minutes ?? 0),
                pct:
                  previous.pct === null && r.pct === null
                    ? null
                    : (previous.pct ?? 0) + (r.pct ?? 0),
              }
            : r,
        );
      }
      for (const r of merged.values()) insert.run(videoId, kind, r.key, r.views, r.minutes, r.pct);
    });
  }

  replaceRetention(videoId: string, points: RetentionPoint[]): void {
    this.ctx.db.transaction(() => {
      this.ctx.db.prepare(`DELETE FROM ${this.t.retention} WHERE video_id = ?`).run(videoId);
      const insert = this.ctx.db.prepare(
        `INSERT INTO ${this.t.retention} (video_id, ratio, watch, relative) VALUES (?, ?, ?, ?)`,
      );
      for (const p of points) insert.run(videoId, p.ratio, p.watch, p.relative);
    });
  }

  waveform(trackId: number): { durationSec: number; peaks: number[] } | null {
    const row = this.ctx.db
      .prepare(`SELECT duration_sec, peaks FROM ${this.t.waveforms} WHERE track_id = ?`)
      .get(trackId) as { duration_sec: number; peaks: string } | undefined;
    return row ? { durationSec: row.duration_sec, peaks: JSON.parse(row.peaks) as number[] } : null;
  }

  setWaveform(trackId: number, durationSec: number, peaks: number[]): void {
    this.ctx.db
      .prepare(
        `INSERT INTO ${this.t.waveforms} (track_id, duration_sec, peaks, computed_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (track_id) DO UPDATE SET duration_sec = excluded.duration_sec, peaks = excluded.peaks,
           computed_at = excluded.computed_at`,
      )
      .run(
        trackId,
        durationSec,
        JSON.stringify(peaks.map((p) => Math.round(p * 1000) / 1000)),
        new Date().toISOString(),
      );
  }

  /** Records an import; its rows are then written with its id (upsertReach). */
  addImport(entry: {
    fileName: string;
    kind: string;
    rows: number;
    matched: number;
    columns: string[];
    metrics: string[];
  }): number {
    return Number(
      this.ctx.db
        .prepare(
          `INSERT INTO ${this.t.imports} (file_name, imported_at, kind, rows, matched, columns, metrics)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.fileName,
          new Date().toISOString(),
          entry.kind,
          entry.rows,
          entry.matched,
          JSON.stringify(entry.columns),
          JSON.stringify(entry.metrics),
        ).lastInsertRowid,
    );
  }

  /** Period and number of days an import still provides (after the API took over some). */
  refreshImportPeriod(id: number): void {
    this.ctx.db
      .prepare(
        `UPDATE ${this.t.imports} SET
           period_from = (SELECT MIN(day) FROM ${this.t.days} WHERE import_id = @id),
           period_to = (SELECT MAX(day) FROM ${this.t.days} WHERE import_id = @id),
           days = (SELECT COUNT(*) FROM ${this.t.days} WHERE import_id = @id)
         WHERE id = @id`,
      )
      .run({ id });
  }

  imports(): ImportRow[] {
    const rows = this.ctx.db
      .prepare(
        `SELECT i.*, (SELECT COUNT(*) FROM ${this.t.videos} v WHERE v.reach_import_id = i.id) AS videos
         FROM ${this.t.imports} i ORDER BY i.id DESC`,
      )
      .all() as (Omit<ImportRow, 'metrics' | 'legacy'> & { metrics: string; legacy: number })[];
    return rows.map((r) => ({
      ...r,
      metrics: JSON.parse(r.metrics) as string[],
      legacy: r.legacy === 1,
    }));
  }

  /** CSV data that cannot be tied to one import (imports of before v0.18). */
  unattributedCsv(): { days: number; videos: number } {
    const days = this.ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${this.t.days} WHERE reach_source IN ('csv', 'unknown') AND import_id IS NULL`,
      )
      .get() as { n: number };
    const videos = this.ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${this.t.videos} WHERE (impressions IS NOT NULL OR ctr IS NOT NULL) AND reach_import_id IS NULL`,
      )
      .get() as { n: number };
    return { days: days.n, videos: videos.n };
  }

  /**
   * What deleting an import removes: impressions / CTR of its days (rows the
   * CSV alone created go entirely: they hold nothing else) and of its videos.
   * Never a value of the API.
   */
  importFootprint(id: number | 'all'): { days: number; rowsRemoved: number; videos: number } {
    const where =
      id === 'all'
        ? `reach_source IN ('csv', 'unknown')`
        : `reach_source = 'csv' AND import_id = @id`;
    const get = (sql: string) => (this.ctx.db.prepare(sql).get({ id }) as { n: number }).n;
    return {
      days: get(`SELECT COUNT(*) AS n FROM ${this.t.days} WHERE ${where}`),
      rowsRemoved: get(
        `SELECT COUNT(*) AS n FROM ${this.t.days} WHERE ${where} AND api_at IS NULL`,
      ),
      videos: get(
        id === 'all'
          ? `SELECT COUNT(*) AS n FROM ${this.t.videos} WHERE impressions IS NOT NULL OR ctr IS NOT NULL`
          : `SELECT COUNT(*) AS n FROM ${this.t.videos} WHERE reach_import_id = @id`,
      ),
    };
  }

  /** Deletes an import's data (or every CSV datum) and its line in the list. */
  deleteImport(id: number | 'all'): { days: number; rowsRemoved: number; videos: number } {
    const footprint = this.importFootprint(id);
    const where =
      id === 'all'
        ? `reach_source IN ('csv', 'unknown')`
        : `reach_source = 'csv' AND import_id = @id`;
    this.ctx.db.transaction(() => {
      const db = this.ctx.db;
      db.prepare(`DELETE FROM ${this.t.days} WHERE ${where} AND api_at IS NULL`).run({ id });
      db.prepare(
        `UPDATE ${this.t.days} SET impressions = NULL, ctr = NULL, reach_source = NULL, import_id = NULL WHERE ${where}`,
      ).run({ id });
      db.prepare(
        id === 'all'
          ? `UPDATE ${this.t.videos} SET impressions = NULL, ctr = NULL, reach_import_id = NULL`
          : `UPDATE ${this.t.videos} SET impressions = NULL, ctr = NULL, reach_import_id = NULL WHERE reach_import_id = @id`,
      ).run({ id });
      db.prepare(
        id === 'all'
          ? `DELETE FROM ${this.t.imports}`
          : `DELETE FROM ${this.t.imports} WHERE id = @id`,
      ).run({ id });
    });
    return footprint;
  }

  /** Sources of the numbers, for the « Données » tab and the diagnostic. */
  sources(): {
    apiDays: number;
    csvOnlyDays: number;
    lastApiDay: string | null;
    reach: Record<string, number>;
  } {
    const db = this.ctx.db;
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    const reach: Record<string, number> = {};
    for (const r of db
      .prepare(
        `SELECT reach_source AS source, COUNT(*) AS n FROM ${this.t.days} WHERE reach_source IS NOT NULL GROUP BY reach_source`,
      )
      .all() as { source: string; n: number }[])
      reach[r.source] = r.n;
    return {
      apiDays: count(`SELECT COUNT(*) AS n FROM ${this.t.days} WHERE api_at IS NOT NULL`),
      csvOnlyDays: count(`SELECT COUNT(*) AS n FROM ${this.t.days} WHERE api_at IS NULL`),
      lastApiDay: (
        db.prepare(`SELECT MAX(day) AS day FROM ${this.t.days} WHERE api_at IS NOT NULL`).get() as {
          day: string | null;
        }
      ).day,
      reach,
    };
  }

  journal(): JournalEntry[] {
    return (
      this.ctx.db.prepare(`SELECT data FROM ${this.t.journal}`).all() as { data: string }[]
    ).map((r) => JSON.parse(r.data) as JournalEntry);
  }

  saveJournal(entries: JournalEntry[]): void {
    const statement = this.ctx.db.prepare(
      `INSERT INTO ${this.t.journal} (key, data) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET data = excluded.data`,
    );
    this.ctx.db.transaction(() => {
      for (const e of entries) statement.run(e.key, JSON.stringify(e));
    });
  }

  // Dataset ------------------------------------------------------------------

  /** Every track id a video could be linked to, from the Planning. */
  plannerItems(services: LinkServices): Map<string, PlannedYouTubeItem> {
    const map = new Map<string, PlannedYouTubeItem>();
    for (const item of services.planner?.listYouTubeItems() ?? []) {
      if (item.youtubeVideoId) map.set(item.youtubeVideoId, item);
    }
    return map;
  }

  originOf(
    row: VideoRow,
    planned: Map<string, PlannedYouTubeItem>,
    services: LinkServices,
  ): VideoOrigin {
    if (row.link_mode === 'none') return EMPTY_ORIGIN;
    if (row.link_mode === 'manual') {
      return { ...EMPTY_ORIGIN, link: 'manual', trackId: row.manual_track_id };
    }
    const item = planned.get(row.id);
    if (!item) return EMPTY_ORIGIN;
    const origin: VideoOrigin = {
      ...EMPTY_ORIGIN,
      link: 'planner',
      trackId: item.trackId,
      label: item.label,
      source: item.source.type,
      position: item.position,
    };
    if (item.source.type === 'cover-reel' && item.source.packItemId !== null) {
      const packItem = services.packs?.getItem(item.source.packItemId);
      if (packItem) {
        origin.excerptStart = packItem.startSec;
        origin.excerptDuration = packItem.durationSec;
      }
    } else if (item.source.type === 'custom-reel') {
      const reel = services.customReels?.getReel(item.source.customReelId);
      if (reel) {
        origin.excerptStart = reel.startSec;
        origin.excerptDuration = reel.durationSec;
        origin.effect = reel.effect;
        origin.intensity = reel.intensity;
        origin.audioMode = reel.audioMode;
      }
    }
    return origin;
  }

  dataset(services: LinkServices, options: { lastDay: string; timeZone: string }): Dataset {
    const db = this.ctx.db;
    const planned = this.plannerItems(services);
    const videos: StatVideo[] = this.videos().map((row) => ({
      id: row.id,
      title: row.title,
      publishedAt: row.published_at,
      durationSec: row.duration_sec,
      kind: row.kind,
      kindSource: row.kind_source,
      thumbnailUrl: row.thumbnail_url,
      privacy: row.privacy,
      origin: this.originOf(row, planned, services),
      totalViews: row.total_views,
      totalLikes: row.total_likes,
      totalComments: row.total_comments,
      impressions: row.impressions,
      ctr: row.ctr,
    }));
    const days = (db.prepare(`SELECT * FROM ${this.t.days}`).all() as DayDbRow[]).map(
      (r): DayRow => ({
        videoId: r.video_id,
        day: r.day,
        views: r.views,
        engagedViews: r.engaged_views,
        minutes: r.minutes,
        avgViewDuration: r.avg_view_duration,
        avgViewPct: r.avg_view_pct,
        likes: r.likes,
        comments: r.comments,
        shares: r.shares,
        subsGained: r.subs_gained,
        subsLost: r.subs_lost,
        impressions: r.impressions,
        ctr: r.ctr,
        reachSource: r.reach_source,
      }),
    );
    const channelDays = (
      db.prepare(`SELECT * FROM ${this.t.channelDays} ORDER BY day`).all() as {
        day: string;
        views: number;
        minutes: number;
        subs_gained: number;
        subs_lost: number;
        likes: number;
        comments: number;
        shares: number;
      }[]
    ).map((r) => ({
      day: r.day,
      views: r.views,
      minutes: r.minutes,
      subsGained: r.subs_gained,
      subsLost: r.subs_lost,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
    }));
    const snapshots = db
      .prepare(`SELECT * FROM ${this.t.snapshots} ORDER BY day`)
      .all() as Snapshot[];
    const breakdowns = (
      db.prepare(`SELECT * FROM ${this.t.breakdowns}`).all() as {
        video_id: string;
        kind: BreakdownKind;
        key: string;
        views: number;
        minutes: number | null;
        pct: number | null;
      }[]
    ).map((r) => ({
      videoId: r.video_id,
      kind: r.kind,
      key: r.key,
      views: r.views,
      minutes: r.minutes,
      pct: r.pct,
    }));
    const retention: Record<string, RetentionPoint[]> = {};
    for (const r of db
      .prepare(`SELECT * FROM ${this.t.retention} ORDER BY video_id, ratio`)
      .all() as {
      video_id: string;
      ratio: number;
      watch: number;
      relative: number | null;
    }[]) {
      (retention[r.video_id] ??= []).push({ ratio: r.ratio, watch: r.watch, relative: r.relative });
    }
    const trackIds = new Set(
      videos.map((v) => v.origin.trackId).filter((x): x is number => x !== null),
    );
    const tracks: StatTrack[] = [];
    for (const id of trackIds) {
      const track = services.library?.getTrack(id);
      const wave = this.waveform(id);
      tracks.push({
        id,
        title: track?.title ?? `Morceau ${id}`,
        artist: track?.artist ?? '',
        durationSec: track?.durationSec ?? wave?.durationSec ?? null,
        coverUrl: track ? (services.coverUrl?.(track.coverPath) ?? null) : null,
        peaks: wave?.peaks ?? null,
      });
    }
    const reach =
      this.meta<string>('reach') === 'api'
        ? 'api'
        : days.some((d) => d.reachSource === 'csv' || d.reachSource === 'unknown') ||
            videos.some((v) => v.impressions !== null || v.ctr !== null)
          ? 'csv'
          : 'none';
    return {
      mode: 'real',
      lastDay: options.lastDay,
      channel: this.meta<{ id: string; title: string }>('channel'),
      timeZone: options.timeZone,
      videos,
      days,
      channelDays,
      snapshots,
      breakdowns,
      retention,
      tracks,
      reach,
    };
  }
}
