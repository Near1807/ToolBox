// Storage of the Instagram packs: one pack per track (post + up to 4 Reels),
// with the chosen excerpts, the captions and the publication tracking.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { HttpError, type ModuleContext } from '@hub/sdk/backend';

export const MAX_REELS = 4;

export interface PackRow {
  id: number;
  track_id: number;
  clip_duration: number;
  caption: string;
  per_reel_captions: number;
  folder: string;
  created_at: string;
  updated_at: string;
}

export interface ItemRow {
  id: number;
  pack_id: number;
  kind: 'post' | 'reel';
  /** 0 = post, 1..4 = Reels. */
  position: number;
  start_sec: number | null;
  duration_sec: number | null;
  caption: string | null;
  file_path: string | null;
  thumbnail_path: string | null;
  job_id: string | null;
  error: string | null;
  rendered_start_sec: number | null;
  rendered_duration_sec: number | null;
  rendered_at: string | null;
  published_at: string | null;
  /** Look of the engine used for the file (RENDER_VERSION); null = before v0.8. */
  render_version: number | null;
}

/**
 * draft: never rendered · rendering: queued or running · ready · outdated:
 * excerpt changed since the render, or made with an older look of the engine ·
 * failed · missing: file moved or deleted outside the app.
 */
export type ItemState = 'draft' | 'rendering' | 'ready' | 'outdated' | 'failed' | 'missing';

export const migrationV2 = `
  CREATE TABLE instagram_video__packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL UNIQUE,
    clip_duration REAL NOT NULL,
    caption TEXT NOT NULL,
    per_reel_captions INTEGER NOT NULL DEFAULT 0,
    folder TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE instagram_video__pack_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pack_id INTEGER NOT NULL REFERENCES instagram_video__packs (id),
    kind TEXT NOT NULL,
    position INTEGER NOT NULL,
    start_sec REAL,
    duration_sec REAL,
    caption TEXT,
    file_path TEXT,
    thumbnail_path TEXT,
    job_id TEXT,
    error TEXT,
    rendered_start_sec REAL,
    rendered_duration_sec REAL,
    rendered_at TEXT,
    published_at TEXT,
    UNIQUE (pack_id, position)
  );
`;

// v0.7: one style per Reel (and the hook phrase of « Phrase d'accroche »).
export const migrationV3 = `
  ALTER TABLE instagram_video__pack_items ADD COLUMN style TEXT;
  ALTER TABLE instagram_video__pack_items ADD COLUMN hook_text TEXT;
  ALTER TABLE instagram_video__pack_items ADD COLUMN rendered_style TEXT;
  ALTER TABLE instagram_video__pack_items ADD COLUMN rendered_hook_text TEXT;
`;

// v0.8: back to one sober look for every Reel (docs/DIRECTION-ARTISTIQUE.md).
// The style columns of v0.7 are dropped; files made before are « À régénérer ».
export const migrationV4 = `
  ALTER TABLE instagram_video__pack_items DROP COLUMN style;
  ALTER TABLE instagram_video__pack_items DROP COLUMN hook_text;
  ALTER TABLE instagram_video__pack_items DROP COLUMN rendered_style;
  ALTER TABLE instagram_video__pack_items DROP COLUMN rendered_hook_text;
  ALTER TABLE instagram_video__pack_items ADD COLUMN render_version INTEGER;
`;

/** Current look of the generated files: older files are shown « À régénérer ». */
export const RENDER_VERSION = 2;

export function itemLabel(position: number): string {
  return position === 0 ? 'Post' : `Reel ${position}`;
}

export class PackStore {
  private readonly packs: string;
  private readonly items: string;

  constructor(private readonly ctx: ModuleContext) {
    this.packs = ctx.db.table('packs');
    this.items = ctx.db.table('pack_items');
  }

  byTrack(trackId: number): PackRow | null {
    return (
      (this.ctx.db.prepare(`SELECT * FROM ${this.packs} WHERE track_id = ?`).get(trackId) as
        PackRow | undefined) ?? null
    );
  }

  pack(id: number): PackRow | null {
    return (
      (this.ctx.db.prepare(`SELECT * FROM ${this.packs} WHERE id = ?`).get(id) as
        PackRow | undefined) ?? null
    );
  }

  requirePack(id: number): PackRow {
    const pack = this.pack(id);
    if (!pack) throw new HttpError(404, 'Pack introuvable');
    return pack;
  }

  allPacks(): PackRow[] {
    return this.ctx.db.prepare(`SELECT * FROM ${this.packs}`).all() as PackRow[];
  }

  listItems(packId: number): ItemRow[] {
    return this.ctx.db
      .prepare(`SELECT * FROM ${this.items} WHERE pack_id = ? ORDER BY position`)
      .all(packId) as ItemRow[];
  }

  item(id: number): ItemRow | null {
    return (
      (this.ctx.db.prepare(`SELECT * FROM ${this.items} WHERE id = ?`).get(id) as
        ItemRow | undefined) ?? null
    );
  }

  requireItem(id: number): ItemRow {
    const item = this.item(id);
    if (!item) throw new HttpError(404, 'Élément du pack introuvable');
    return item;
  }

  create(input: {
    trackId: number;
    clipDuration: number;
    caption: string;
    folder: string;
    starts: number[];
  }): PackRow {
    const now = new Date().toISOString();
    return this.ctx.db.transaction(() => {
      const packId = Number(
        this.ctx.db
          .prepare(
            `INSERT INTO ${this.packs} (track_id, clip_duration, caption, folder, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(input.trackId, input.clipDuration, input.caption, input.folder, now, now)
          .lastInsertRowid,
      );
      const insert = this.ctx.db.prepare(
        `INSERT INTO ${this.items} (pack_id, kind, position, start_sec, duration_sec) VALUES (?, ?, ?, ?, ?)`,
      );
      insert.run(packId, 'post', 0, null, null);
      input.starts.forEach((start, index) =>
        insert.run(packId, 'reel', index + 1, start, input.clipDuration),
      );
      return this.pack(packId)!;
    });
  }

  /** Removes a pack and its items (the files are handled by ctx.outputs before). */
  deletePack(id: number): void {
    this.ctx.db.transaction(() => {
      this.ctx.db.prepare(`DELETE FROM ${this.items} WHERE pack_id = ?`).run(id);
      this.ctx.db.prepare(`DELETE FROM ${this.packs} WHERE id = ?`).run(id);
    });
  }

  allItems(): ItemRow[] {
    return this.ctx.db.prepare(`SELECT * FROM ${this.items}`).all() as ItemRow[];
  }

  updatePack(
    id: number,
    fields: Partial<Pick<PackRow, 'clip_duration' | 'caption' | 'per_reel_captions'>>,
  ): void {
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    this.ctx.db
      .prepare(
        `UPDATE ${this.packs} SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      )
      .run(...entries.map(([, value]) => value), new Date().toISOString(), id);
  }

  updateItem(
    id: number,
    fields: Partial<Omit<ItemRow, 'id' | 'pack_id' | 'kind' | 'position'>>,
  ): void {
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    this.ctx.db
      .prepare(
        `UPDATE ${this.items} SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`,
      )
      .run(...entries.map(([, value]) => value), id);
  }

  state(item: ItemRow): ItemState {
    if (item.job_id) {
      const job = this.ctx.jobs.get(item.job_id);
      if (job && (job.status === 'queued' || job.status === 'running')) return 'rendering';
    }
    if (item.file_path) {
      if (!existsSync(item.file_path)) return 'missing';
      if (item.error) return 'failed';
      if (item.render_version !== RENDER_VERSION) return 'outdated';
      if (
        item.kind === 'reel' &&
        (item.rendered_start_sec !== item.start_sec ||
          item.rendered_duration_sec !== item.duration_sec)
      ) {
        return 'outdated';
      }
      return 'ready';
    }
    return item.error ? 'failed' : 'draft';
  }

  /** Path of an item's file in the pack folder: the existing one when regenerating. */
  outputPath(pack: PackRow, item: ItemRow, fileName: string): string {
    return item.file_path ?? path.join(pack.folder, fileName);
  }
}
