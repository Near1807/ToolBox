// Storage of the release plans: one release per track, its planned elements,
// and the quota used per YouTube day.
import { HttpError, type ModuleContext } from '@hub/sdk/backend';
import type { ItemKind } from './plan';
import type { QuotaUsage } from './quota';
import { assertTransition, type ItemState } from './status';

/** v2: texts that follow the templates until edited (existing elements keep theirs). */
export const migrationV2 = `
  ALTER TABLE release_planner__items ADD COLUMN texts_custom INTEGER NOT NULL DEFAULT 1;
`;

export const migrationV1 = `
  CREATE TABLE release_planner__releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL UNIQUE,
    release_date TEXT NOT NULL,
    release_time TEXT NOT NULL,
    video_id INTEGER,
    thumbnail_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE release_planner__items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    release_id INTEGER NOT NULL REFERENCES release_planner__releases (id),
    kind TEXT NOT NULL,
    position INTEGER NOT NULL,
    scheduled_at TEXT NOT NULL,
    shifted_from TEXT,
    pack_item_id INTEGER,
    title TEXT,
    description TEXT,
    tags TEXT,
    visibility TEXT NOT NULL DEFAULT 'scheduled',
    state TEXT NOT NULL DEFAULT 'planned',
    upload_url TEXT,
    yt_video_id TEXT,
    yt_privacy TEXT,
    yt_publish_at TEXT,
    warning TEXT,
    error TEXT,
    job_id TEXT,
    not_before TEXT,
    reminded_at TEXT,
    checked_at TEXT,
    published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (release_id, kind, position)
  );
  CREATE INDEX release_planner__items_date ON release_planner__items (scheduled_at);
  CREATE TABLE release_planner__quota (
    day TEXT PRIMARY KEY,
    uploads INTEGER NOT NULL DEFAULT 0,
    units INTEGER NOT NULL DEFAULT 0,
    exhausted INTEGER NOT NULL DEFAULT 0
  );
`;

export interface ReleaseRow {
  id: number;
  track_id: number;
  release_date: string;
  release_time: string;
  /** youtube-video's video (null: no long video in this release). */
  video_id: number | null;
  thumbnail_path: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * "scheduled": private, then public at the planned time · "public": public as
 * soon as sent · "unlisted" · "private": stays private.
 */
export type Visibility = 'scheduled' | 'public' | 'unlisted' | 'private';
export const VISIBILITIES: Visibility[] = ['scheduled', 'public', 'unlisted', 'private'];

export interface ItemRow {
  id: number;
  release_id: number;
  kind: ItemKind;
  position: number;
  /** UTC instant. */
  scheduled_at: string;
  /** Day proposed by the template when the anti-congestion moved the element. */
  shifted_from: string | null;
  /** Instagram pack item (post, or Reel n; also the source of Short n). */
  pack_item_id: number | null;
  title: string | null;
  description: string | null;
  /** JSON array. */
  tags: string | null;
  /** 1: texts edited by the user; 0: they follow the templates (refreshed on display and upload). */
  texts_custom: number;
  visibility: Visibility;
  state: ItemState;
  /** Resumable session of an interrupted upload. */
  upload_url: string | null;
  yt_video_id: string | null;
  yt_privacy: string | null;
  yt_publish_at: string | null;
  warning: string | null;
  error: string | null;
  job_id: string | null;
  /** Quota: the upload waits until then. */
  not_before: string | null;
  reminded_at: string | null;
  checked_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

type ItemFields = Partial<Omit<ItemRow, 'id' | 'release_id' | 'kind' | 'position' | 'created_at'>>;

export class PlannerStore {
  private readonly releases: string;
  private readonly items: string;
  private readonly quota: string;

  constructor(private readonly ctx: ModuleContext) {
    this.releases = ctx.db.table('releases');
    this.items = ctx.db.table('items');
    this.quota = ctx.db.table('quota');
  }

  release(id: number): ReleaseRow | null {
    return (
      (this.ctx.db.prepare(`SELECT * FROM ${this.releases} WHERE id = ?`).get(id) as
        ReleaseRow | undefined) ?? null
    );
  }

  requireRelease(id: number): ReleaseRow {
    const release = this.release(id);
    if (!release) throw new HttpError(404, 'Sortie introuvable');
    return release;
  }

  releaseByTrack(trackId: number): ReleaseRow | null {
    return (
      (this.ctx.db.prepare(`SELECT * FROM ${this.releases} WHERE track_id = ?`).get(trackId) as
        ReleaseRow | undefined) ?? null
    );
  }

  allReleases(): ReleaseRow[] {
    return this.ctx.db
      .prepare(`SELECT * FROM ${this.releases} ORDER BY release_date`)
      .all() as ReleaseRow[];
  }

  item(id: number): ItemRow | null {
    return (
      (this.ctx.db.prepare(`SELECT * FROM ${this.items} WHERE id = ?`).get(id) as
        ItemRow | undefined) ?? null
    );
  }

  requireItem(id: number): ItemRow {
    const item = this.item(id);
    if (!item) throw new HttpError(404, 'Élément du planning introuvable');
    return item;
  }

  itemsOf(releaseId: number): ItemRow[] {
    return this.ctx.db
      .prepare(`SELECT * FROM ${this.items} WHERE release_id = ? ORDER BY scheduled_at, id`)
      .all(releaseId) as ItemRow[];
  }

  allItems(): ItemRow[] {
    return this.ctx.db
      .prepare(`SELECT * FROM ${this.items} ORDER BY scheduled_at, id`)
      .all() as ItemRow[];
  }

  itemsInStates(states: ItemState[]): ItemRow[] {
    return this.ctx.db
      .prepare(
        `SELECT * FROM ${this.items} WHERE state IN (${states.map(() => '?').join(', ')})
         ORDER BY scheduled_at, id`,
      )
      .all(...states) as ItemRow[];
  }

  createRelease(input: {
    trackId: number;
    date: string;
    time: string;
    videoId: number | null;
    items: {
      kind: ItemKind;
      position: number;
      scheduledAt: string;
      shiftedFrom: string | null;
      packItemId: number | null;
      title: string | null;
      description: string | null;
      tags: string[] | null;
    }[];
  }): ReleaseRow {
    const now = new Date().toISOString();
    return this.ctx.db.transaction(() => {
      const id = Number(
        this.ctx.db
          .prepare(
            `INSERT INTO ${this.releases} (track_id, release_date, release_time, video_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(input.trackId, input.date, input.time, input.videoId, now, now).lastInsertRowid,
      );
      const insert = this.ctx.db.prepare(
        `INSERT INTO ${this.items} (release_id, kind, position, scheduled_at, shifted_from,
           pack_item_id, title, description, tags, texts_custom, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      );
      for (const item of input.items) {
        insert.run(
          id,
          item.kind,
          item.position,
          item.scheduledAt,
          item.shiftedFrom,
          item.packItemId,
          item.title,
          item.description,
          item.tags ? JSON.stringify(item.tags) : null,
          now,
          now,
        );
      }
      return this.release(id)!;
    });
  }

  updateRelease(
    id: number,
    fields: Partial<Pick<ReleaseRow, 'video_id' | 'thumbnail_path'>>,
  ): void {
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    this.ctx.db
      .prepare(
        `UPDATE ${this.releases} SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      )
      .run(...entries.map(([, value]) => value), new Date().toISOString(), id);
  }

  /** Updates an element; a change of `state` must be an allowed transition. */
  updateItem(id: number, fields: ItemFields): ItemRow {
    if (fields.state) assertTransition(this.requireItem(id).state, fields.state);
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.length > 0) {
      this.ctx.db
        .prepare(
          `UPDATE ${this.items} SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        )
        .run(...entries.map(([, value]) => value), new Date().toISOString(), id);
    }
    return this.requireItem(id);
  }

  deleteItem(id: number): void {
    this.ctx.db.prepare(`DELETE FROM ${this.items} WHERE id = ?`).run(id);
  }

  deleteRelease(id: number): void {
    this.ctx.db.transaction(() => {
      this.ctx.db.prepare(`DELETE FROM ${this.items} WHERE release_id = ?`).run(id);
      this.ctx.db.prepare(`DELETE FROM ${this.releases} WHERE id = ?`).run(id);
    });
  }

  quotaUsage(day: string): QuotaUsage {
    const row = this.ctx.db.prepare(`SELECT * FROM ${this.quota} WHERE day = ?`).get(day) as
      { day: string; uploads: number; units: number; exhausted: number } | undefined;
    return {
      day,
      uploads: row?.uploads ?? 0,
      units: row?.units ?? 0,
      exhausted: Boolean(row?.exhausted),
    };
  }

  addQuota(day: string, usage: { uploads?: number; units?: number; exhausted?: boolean }): void {
    this.ctx.db
      .prepare(
        `INSERT INTO ${this.quota} (day, uploads, units, exhausted) VALUES (?, ?, ?, ?)
         ON CONFLICT (day) DO UPDATE SET uploads = uploads + excluded.uploads,
           units = units + excluded.units, exhausted = MAX(exhausted, excluded.exhausted)`,
      )
      .run(day, usage.uploads ?? 0, usage.units ?? 0, usage.exhausted ? 1 : 0);
  }
}
