// custom-reels: Reels 9:16 made from the user's own videos, on an excerpt of a
// track. The videos are copied into ToolBox (like the library's tracks); the
// render is done by the video engine (renderVideoReel). Every Reel is attached
// to its track (ctx.outputs subject) and can be published, tracked and planned.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  defineBackendModule,
  ELEMENT_STATES,
  HttpError,
  idParam,
  listPhrase,
  matchByName,
  type ModuleContext,
  NotFoundError,
  requestBody,
} from '@hub/sdk/backend';
import { fillTemplate, toTemplate } from '@hub/sdk/texts';
import type { MusicLibraryService, Track } from '../../music-library/contract';
import type { VideoEffectId, VideoEngineService } from '../../video-engine/contract';
import {
  CUSTOM_REELS_SERVICE,
  type CustomReel,
  type CustomReelState,
  type CustomReelsService,
} from '../contract';
import { clampExcerpt, suggestStarts } from './excerpts';
import {
  fitPassages,
  MAX_PASSAGES,
  PassageError,
  readPassages,
  toSegments,
  type Passage,
} from './passages';

const execFileAsync = promisify(execFile);
const MAX_REELS = 4;
const MIN_CLIP = 15;
const MAX_CLIP = 60;
const EFFECTS: VideoEffectId[] = ['raw', 'calm', 'rhythm', 'cine', 'camera'];
/** Sound and intensity of a Reel. */
const AUDIO_MODES = ['track', 'video', 'synced'] as const;
const INTENSITIES = ['light', 'medium', 'max'] as const;
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'];
const DEFAULT_CAPTION = '{titre} — {artiste}\n\nNouveau son 🎧 lien en bio\n\n{hashtags}';

interface SourceRow {
  id: number;
  track_id: number;
  file_path: string;
  name: string;
  duration_sec: number;
  width: number;
  height: number;
  created_at: string;
  /** Size of the copy, kept after it is deleted (to say what was freed). */
  size_bytes: number | null;
  /** The copy was deleted to free disk space (the Reels made with it stay). */
  removed_at: string | null;
  /** « Garder » answered: the cleanup is not offered again. */
  keep_copy: number;
}

export interface Segment {
  sourceId: number;
  start: number;
  end: number;
}

interface ReelRow {
  id: number;
  track_id: number;
  position: number;
  start_sec: number;
  duration_sec: number;
  /** JSON Segment[] */
  segments: string;
  framing: 'fit' | 'fill';
  focus_x: number;
  focus_y: number;
  effect: VideoEffectId;
  caption: string | null;
  file_path: string | null;
  thumbnail_path: string | null;
  /** Parameters of the rendered file: different from the current ones = « À régénérer ». */
  render_key: string | null;
  rendered_at: string | null;
  looped: number;
  error: string | null;
  job_id: string | null;
  published_at: string | null;
  /** « track » | « video » | « synced ». */
  audio_mode: (typeof AUDIO_MODES)[number];
  intensity: (typeof INTENSITIES)[number];
  overlay_text: string | null;
  /** JSON PassageSync[]: where the track plays in each passage (« Morceau synchronisé »). */
  sync: string | null;
  created_at: string;
  updated_at: string;
}

const subject = (trackId: number) => `music-library:track:${trackId}`;

/** Text safe for a Windows file or folder name. */
function safeName(text: string, fallback: string): string {
  const clean = text
    // eslint-disable-next-line no-control-regex -- control characters are invalid in Windows file names
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 100);
  return clean || fallback;
}

export default defineBackendModule({
  migrations: [
    {
      version: 1,
      description: 'imported videos and Reels made from them',
      up: `
        CREATE TABLE custom_reels__sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          track_id INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          name TEXT NOT NULL,
          duration_sec REAL NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX custom_reels__sources_track ON custom_reels__sources (track_id);
        CREATE TABLE custom_reels__reels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          track_id INTEGER NOT NULL,
          position INTEGER NOT NULL,
          start_sec REAL NOT NULL,
          duration_sec REAL NOT NULL,
          segments TEXT NOT NULL DEFAULT '[]',
          framing TEXT NOT NULL DEFAULT 'fit',
          focus_x REAL NOT NULL DEFAULT 0.5,
          focus_y REAL NOT NULL DEFAULT 0.5,
          effect TEXT NOT NULL DEFAULT 'raw',
          caption TEXT,
          file_path TEXT,
          thumbnail_path TEXT,
          render_key TEXT,
          rendered_at TEXT,
          looped INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          job_id TEXT,
          published_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (track_id, position)
        );
      `,
    },
    {
      version: 2,
      description: 'size of the imported copies, copies deleted to free disk space',
      up: `
        ALTER TABLE custom_reels__sources ADD COLUMN size_bytes INTEGER;
        ALTER TABLE custom_reels__sources ADD COLUMN removed_at TEXT;
        ALTER TABLE custom_reels__sources ADD COLUMN keep_copy INTEGER NOT NULL DEFAULT 0;
      `,
    },
    // The sources' sync_* columns (whole-video sync of the v0.13 prototype) are no
    // longer read or written: the sync is per passage (reels.sync, v4). Kept in the
    // database, a published migration is never changed.
    {
      version: 3,
      description: 'EXPERIMENTAL: sound of a Reel, intensity, text on screen, track sync',
      up: `
        ALTER TABLE custom_reels__reels ADD COLUMN audio_mode TEXT NOT NULL DEFAULT 'track';
        ALTER TABLE custom_reels__reels ADD COLUMN intensity TEXT NOT NULL DEFAULT 'medium';
        ALTER TABLE custom_reels__reels ADD COLUMN overlay_text TEXT;
        ALTER TABLE custom_reels__sources ADD COLUMN sync_offset REAL;
        ALTER TABLE custom_reels__sources ADD COLUMN sync_score REAL;
        ALTER TABLE custom_reels__sources ADD COLUMN sync_ratio REAL;
        ALTER TABLE custom_reels__sources ADD COLUMN sync_reliable INTEGER;
      `,
    },
    {
      version: 4,
      description: 'track sync per passage (« Morceau synchronisé »)',
      up: `ALTER TABLE custom_reels__reels ADD COLUMN sync TEXT;`,
    },
  ],

  register(ctx: ModuleContext) {
    const library = ctx.services.get<MusicLibraryService>('musicLibrary');
    const engine = ctx.services.get<VideoEngineService>('videoEngine');
    const sources = ctx.db.table('sources');
    const reels = ctx.db.table('reels');

    const requireTrack = (id: number): Track => {
      const track = Number.isInteger(id) ? library.getTrack(id) : null;
      if (!track) throw new HttpError(404, 'Morceau introuvable');
      return track;
    };
    const defaultClip = () => ctx.settings.get<number>('clipDuration') ?? 28;
    // Store ------------------------------------------------------------------
    const source = (id: number) =>
      ctx.db.prepare(`SELECT * FROM ${sources} WHERE id = ?`).get(id) as SourceRow | undefined;
    const sourcesOf = (trackId: number) =>
      ctx.db
        .prepare(`SELECT * FROM ${sources} WHERE track_id = ? ORDER BY id`)
        .all(trackId) as SourceRow[];
    const reel = (id: number) =>
      ctx.db.prepare(`SELECT * FROM ${reels} WHERE id = ?`).get(id) as ReelRow | undefined;
    const requireReel = (id: number) => {
      const row = reel(id);
      if (!row) throw new HttpError(404, 'Reel introuvable');
      return row;
    };
    const reelsOf = (trackId: number) =>
      ctx.db
        .prepare(`SELECT * FROM ${reels} WHERE track_id = ? ORDER BY position`)
        .all(trackId) as ReelRow[];
    /** Writes the given fields (undefined ones are skipped, null is written). */
    const updateReel = (id: number, fields: Partial<ReelRow>) => {
      const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
      if (entries.length === 0) return;
      ctx.db
        .prepare(
          `UPDATE ${reels} SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        )
        .run(...entries.map(([, v]) => v as string | number | null), new Date().toISOString(), id);
    };
    /** Stored passages (start + duration), as saved. */
    const segmentsOf = (row: ReelRow) => readPassages(row.segments);
    const videoLength = (sourceId: number) => source(sourceId)?.duration_sec ?? 0;
    /**
     * Passages fitted to the Reel's duration (one passage = exactly the Reel's
     * duration; chained ones add up to it). An impossible chain is reported, not rendered.
     */
    const fittedOf = (
      row: ReelRow,
    ): { passages: Passage[]; loops: boolean; error: string | null } => {
      try {
        return { ...fitPassages(segmentsOf(row), row.duration_sec, videoLength), error: null };
      } catch (error) {
        if (!(error instanceof PassageError)) throw error;
        return { passages: segmentsOf(row), loops: false, error: error.message };
      }
    };

    // « Morceau synchronisé »: where the track plays in each passage ---------------
    interface PassageSync extends Passage {
      offset: number;
      score: number;
      ratio: number;
      salience: number;
      reliable: boolean;
    }
    const syncOf = (row: ReelRow): PassageSync[] =>
      row.sync ? (JSON.parse(row.sync) as PassageSync[]) : [];
    const samePassage = (a: Passage, b: Passage) =>
      a.sourceId === b.sourceId && a.start === b.start && a.duration === b.duration;
    /** Searches the passages not searched yet (all of them when `again`), and keeps the results. */
    const detectSync = async (row: ReelRow, again = false): Promise<void> => {
      const track = library.getTrack(row.track_id);
      const fitted = fittedOf(row);
      if (!track || fitted.error) return;
      const known = again ? [] : syncOf(row);
      const results: PassageSync[] = [];
      for (const passage of fitted.passages) {
        const done = known.find((m) => samePassage(m, passage));
        if (done) {
          results.push(done);
          continue;
        }
        const src = source(passage.sourceId);
        if (!src || src.removed_at || !existsSync(src.file_path)) continue;
        try {
          const found = await engine.findTrackInVideo(track.audioPath, src.file_path, passage);
          results.push({ ...passage, ...found });
          ctx.logger.info(
            `Synchro « ${src.name} » ${passage.start}–${passage.start + passage.duration} s : décalage ${found.offset} s, saillance ${found.salience}, rapport ${found.ratio}${found.reliable ? '' : ' (pas fiable)'}`,
          );
        } catch (error) {
          ctx.logger.warn(`Synchro impossible pour « ${src.name} »`, error);
          results.push({ ...passage, offset: 0, score: 0, ratio: 0, salience: 0, reliable: false });
        }
      }
      updateReel(row.id, { sync: JSON.stringify(results) });
    };

    // Texts --------------------------------------------------------------------
    const hashtags = (track: Track) => {
      const all = [...track.tags, ...(ctx.settings.get<string>('hashtags') ?? '').split(/[\s,]+/)]
        .map((tag) => tag.replace(/^#+/, '').replace(/\s+/g, '').trim())
        .filter(Boolean);
      const seen = new Set<string>();
      return all
        .filter((tag) => !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()))
        .slice(0, 15)
        .map((tag) => `#${tag}`)
        .join(' ');
    };
    const captionValues = (track: Track) => ({
      titre: track.title,
      artiste: track.artist,
      hashtags: hashtags(track),
    });
    const templateCaption = (track: Track) => {
      const template =
        (ctx.settings.get<string>('captionTemplate') ?? '').trim() || DEFAULT_CAPTION;
      // Without an artist, the separator before {artiste} disappears.
      const cleaned = track.artist
        ? template
        : template.replace(/[ \t]*[—–-][ \t]*\{artiste\}/g, '');
      return fillTemplate(cleaned, captionValues(track));
    };

    // Render state --------------------------------------------------------------
    /** What the file depends on: any change makes it « À régénérer ». */
    const renderKey = (row: ReelRow, track: Track) =>
      JSON.stringify({
        start: row.start_sec,
        duration: row.duration_sec,
        // Same shape as before v0.14 (start, end): an unchanged Reel stays « À jour ».
        segments: toSegments(fittedOf(row).passages),
        framing: row.framing,
        focus: row.framing === 'fill' ? [row.focus_x, row.focus_y] : null,
        effect: row.effect,
        title: track.title,
        artist: track.artist,
        // Options added in v0.13 (absent = as before: no « À régénérer »).
        ...(row.audio_mode !== 'track' ? { audio: row.audio_mode } : {}),
        ...(row.intensity !== 'medium' ? { intensity: row.intensity } : {}),
        ...(row.overlay_text ? { text: row.overlay_text } : {}),
      });
    const stateOf = (row: ReelRow, track: Track | null): CustomReelState => {
      if (row.job_id) {
        const job = ctx.jobs.get(row.job_id);
        if (job && (job.status === 'queued' || job.status === 'running')) return 'rendering';
      }
      if (row.file_path) {
        if (!existsSync(row.file_path)) return 'missing';
        if (row.error) return 'failed';
        if (track && row.render_key !== renderKey(row, track)) return 'outdated';
        return 'ready';
      }
      return row.error ? 'failed' : 'draft';
    };

    const label = (row: ReelRow) => `Reel perso ${row.position}`;
    const toReel = (row: ReelRow): CustomReel => {
      const track = library.getTrack(row.track_id);
      return {
        id: row.id,
        trackId: row.track_id,
        position: row.position,
        label: label(row),
        startSec: row.start_sec,
        durationSec: row.duration_sec,
        effect: row.effect,
        intensity: row.intensity,
        audioMode: row.audio_mode,
        state: stateOf(row, track),
        filePath: row.file_path,
        exists: Boolean(row.file_path && existsSync(row.file_path)),
        thumbnailPath: row.thumbnail_path,
        caption: row.caption ?? (track ? templateCaption(track) : ''),
        publishedAt: row.published_at,
      };
    };

    // Generated files (ctx.outputs): one record per Reel, attached to its track.
    const registerReel = (row: ReelRow, createdAt?: string) =>
      row.file_path
        ? ctx.outputs.register({
            path: row.file_path,
            ref: `reel:${row.id}`,
            subject: subject(row.track_id),
            label: label(row),
            kind: 'reel',
            createdAt: createdAt ?? row.rendered_at ?? undefined,
          })
        : null;
    for (const row of ctx.db.prepare(`SELECT * FROM ${reels}`).all() as ReelRow[])
      registerReel(row);
    // The imported copies too (kind « source »: material, not a deliverable), so
    // that deleting one goes to the Recycle Bin like any file of the app.
    const fileSize = (file: string) => {
      try {
        return statSync(file).size;
      } catch {
        return null;
      }
    };
    const registerSource = (row: SourceRow) =>
      row.removed_at || !row.file_path
        ? null
        : ctx.outputs.register({
            path: row.file_path,
            ref: `source:${row.id}`,
            parent: `sources:${row.track_id}`,
            subject: subject(row.track_id),
            label: `Vidéo importée — ${row.name}`,
            kind: 'source',
            createdAt: row.created_at,
          });
    for (const row of ctx.db.prepare(`SELECT * FROM ${sources}`).all() as SourceRow[]) {
      if (row.size_bytes === null && !row.removed_at) {
        ctx.db
          .prepare(`UPDATE ${sources} SET size_bytes = ? WHERE id = ?`)
          .run(fileSize(row.file_path), row.id);
      }
      registerSource(row);
    }
    // Deleted or removed from the lists: the Reel stays, without its file (to render again).
    // An imported copy gone (Recycle Bin, or missing): the video stays listed as
    // « Copie supprimée », the Reels made with it are kept.
    ctx.outputs.onRemoved((records) => {
      for (const record of records) {
        if (record.ref.startsWith('source:')) {
          const row = source(Number(record.ref.slice('source:'.length)));
          if (row && !existsSync(row.file_path)) {
            ctx.db
              .prepare(`UPDATE ${sources} SET removed_at = ? WHERE id = ?`)
              .run(new Date().toISOString(), row.id);
          }
          continue;
        }
        const id = Number(record.ref.replace(/^reel:/, ''));
        const row = Number.isInteger(id) ? reel(id) : undefined;
        if (!row) continue;
        if (row.thumbnail_path) rmSync(row.thumbnail_path, { force: true });
        updateReel(row.id, {
          file_path: null,
          thumbnail_path: null,
          render_key: null,
          rendered_at: null,
          published_at: null,
        });
      }
    });

    // « Sans projet » > Rattacher: the Reel moves to the chosen track (first free
    // place, at most 4), with the imported videos it uses (its old track is gone).
    ctx.outputs.onReattach((records, newSubject) => {
      const trackId = library.trackIdOf(newSubject);
      if (trackId === null) throw new HttpError(409, 'Un Reel perso se rattache à un morceau');
      for (const record of records) {
        const [kind, rawId] = record.ref.split(':');
        if (kind === 'source') {
          const src = source(Number(rawId));
          if (!src || src.track_id === trackId) continue;
          ctx.db.prepare(`UPDATE ${sources} SET track_id = ? WHERE id = ?`).run(trackId, src.id);
          registerSource({ ...src, track_id: trackId });
          continue;
        }
        if (kind !== 'reel') continue;
        const row = reel(Number(rawId));
        if (!row || row.track_id === trackId) continue;
        const taken = reelsOf(trackId).map((r) => r.position);
        const position = [1, 2, 3, 4].find((p) => !taken.includes(p));
        if (position === undefined) {
          throw new HttpError(
            409,
            `Ce morceau a déjà ${MAX_REELS} Reels perso : supprimes-en un d’abord`,
          );
        }
        updateReel(row.id, { track_id: trackId, position });
        for (const id of new Set(segmentsOf(row).map((segment) => segment.sourceId))) {
          ctx.db.prepare(`UPDATE ${sources} SET track_id = ? WHERE id = ?`).run(trackId, id);
          const src = source(id);
          if (src) registerSource(src);
        }
        registerReel(reel(row.id)!);
      }
    });

    const outputsByRef = (trackId: number) =>
      new Map(
        ctx.outputs
          .list({})
          .filter((r) => r.subject === subject(trackId))
          .map((r) => [r.ref, r]),
      );

    // DTOs ------------------------------------------------------------------------
    /** Reels using an imported video, with their state. */
    const usersOf = (row: SourceRow) => {
      const track = library.getTrack(row.track_id);
      return reelsOf(row.track_id)
        .filter((r) => segmentsOf(r).some((s) => s.sourceId === row.id))
        .map((r) => ({ label: label(r), state: stateOf(r, track) }));
    };
    const offerCleanup = () => ctx.settings.get<boolean>('offerCleanup') !== false;
    const sourceDto = (row: SourceRow) => {
      const users = usersOf(row);
      const removed = Boolean(row.removed_at);
      const allReady = users.length > 0 && users.every((u) => u.state === 'ready');
      return {
        id: row.id,
        name: row.name,
        durationSec: row.duration_sec,
        width: row.width,
        height: row.height,
        exists: !removed && existsSync(row.file_path),
        url: removed ? null : ctx.files.mediaUrlIfExists(row.file_path),
        sizeBytes: row.size_bytes,
        removedAt: row.removed_at,
        usedBy: users.map((u) => u.label),
        /** Every Reel using it is generated: the copy can go (it is needed again only to change them). */
        allReady,
        /** Offered after the render (setting), until « Garder ». */
        cleanupOffered: offerCleanup() && !removed && !row.keep_copy && allReady,
      };
    };
    /** Disk space of the imported copies (still on disk), for a track or all. */
    const storage = (trackId?: number) => {
      const rows = (
        trackId === undefined
          ? ctx.db.prepare(`SELECT * FROM ${sources}`).all()
          : ctx.db.prepare(`SELECT * FROM ${sources} WHERE track_id = ?`).all(trackId)
      ) as SourceRow[];
      const kept = rows.filter((r) => !r.removed_at);
      const freed = rows.filter((r) => r.removed_at);
      const sum = (list: SourceRow[]) => list.reduce((total, r) => total + (r.size_bytes ?? 0), 0);
      return {
        bytes: sum(kept),
        count: kept.length,
        freedBytes: sum(freed),
        freedCount: freed.length,
        folder: ctx.files.dataPath('videos'),
      };
    };
    const reelDto = (row: ReelRow, track: Track, records = outputsByRef(track.id)) => {
      const record = records.get(`reel:${row.id}`);
      const fitted = fittedOf(row);
      const segments = fitted.passages.map((p) => ({
        ...p,
        end: Math.round((p.start + p.duration) * 10) / 10,
      }));
      const videoSeconds = segments.reduce((sum, s) => sum + s.duration, 0);
      return {
        id: row.id,
        outputId: record?.id ?? null,
        position: row.position,
        label: label(row),
        startSec: row.start_sec,
        durationSec: row.duration_sec,
        segments,
        videoSeconds,
        /** The video is shorter than the Reel: it will be looped. */
        loops: fitted.loops,
        /** Chained passages that cannot add up to the Reel's duration (said, not rendered). */
        passagesError: fitted.error,
        /** « Morceau synchronisé »: the match of each passage (null: not searched yet). */
        sync: fitted.passages.map((p) => {
          const match = syncOf(row).find((m) => samePassage(m, p));
          return match
            ? {
                offset: match.offset,
                salience: match.salience,
                ratio: match.ratio,
                reliable: match.reliable,
              }
            : null;
        }),
        audioMode: row.audio_mode,
        intensity: row.intensity,
        overlayText: row.overlay_text ?? '',
        framing: row.framing,
        focus: { x: row.focus_x, y: row.focus_y },
        effect: row.effect,
        caption: row.caption ?? templateCaption(track),
        captionCustom: row.caption !== null && row.caption !== templateCaption(track),
        state: stateOf(row, track),
        jobId: row.job_id,
        error: row.error,
        fileName: row.file_path ? path.basename(row.file_path) : null,
        url: ctx.files.mediaUrlIfExists(row.file_path),
        thumbnailUrl: ctx.files.mediaUrlIfExists(row.thumbnail_path),
        renderedAt: row.rendered_at,
        publishedAt: row.published_at,
        included: record ? library.isIncluded(ctx.id, record.ref) : true,
      };
    };

    // Render ---------------------------------------------------------------------
    const renderRequest = (row: ReelRow, track: Track) => {
      const fitted = fittedOf(row);
      if (fitted.error) throw new Error(fitted.error);
      if (fitted.loops && row.audio_mode === 'synced') {
        throw new Error(
          'Vidéo plus courte que le Reel : impossible en « Morceau synchronisé » (raccourcis le Reel)',
        );
      }
      const segments = toSegments(fitted.passages).map((segment) => {
        const src = source(segment.sourceId);
        if (!src) throw new Error('Une vidéo de ce Reel a été retirée : choisis un autre passage');
        if (src.removed_at || !existsSync(src.file_path)) {
          throw new Error(
            `La copie de « ${src.name} » a été supprimée pour libérer de la place : réimporte-la (Tes vidéos › Réimporter) pour régénérer ce Reel`,
          );
        }
        return {
          source: src.file_path,
          start: segment.start,
          end: segment.end,
        } as { source: string; start: number; end: number; syncOffset?: number };
      });
      if (segments.length === 0) throw new Error('Choisis au moins un passage vidéo');
      // « Morceau synchronisé »: each passage needs a reliable match of its own.
      if (row.audio_mode === 'synced') {
        const found = syncOf(row);
        fitted.passages.forEach((passage, i) => {
          const match = found.find((m) => samePassage(m, passage));
          const name = source(passage.sourceId)?.name ?? 'la vidéo';
          if (!match) {
            throw new Error(
              `Morceau pas encore cherché dans ce passage de « ${name} » : clique « Retrouver le morceau »`,
            );
          }
          if (!match.reliable) {
            throw new Error(
              `Morceau pas retrouvé de façon fiable dans ce passage de « ${name} » : choisis « Son de la vidéo », ou un autre passage`,
            );
          }
          segments[i] = { ...segments[i]!, syncOffset: match.offset };
        });
      }
      return {
        audioMode: row.audio_mode,
        intensity: row.intensity,
        overlayText: row.overlay_text ?? undefined,
        audioPath: track.audioPath,
        start: row.start_sec,
        duration: row.duration_sec,
        segments,
        framing: row.framing,
        focus: { x: row.focus_x, y: row.focus_y },
        effect: row.effect,
        title: track.title,
        artist: track.artist,
      };
    };

    const makeThumbnail = async (row: ReelRow, video: string): Promise<string | null> => {
      const file = ctx.files.dataPath('thumbnails', `${row.id}.jpg`);
      mkdirSync(path.dirname(file), { recursive: true });
      try {
        await execFileAsync(
          ctx.binaries.ffmpeg,
          [
            ...['-v', 'error', '-y', '-ss', '2', '-i', video],
            ...['-frames:v', '1', '-vf', 'scale=270:-2', '-q:v', '4', file],
          ],
          { windowsHide: true, timeout: 30_000 },
        );
        return file;
      } catch (error) {
        ctx.logger.warn('Miniature impossible', error);
        return null;
      }
    };

    ctx.jobs.define<{ reelId: number }, { file: string }>('render', async (job) => {
      const row = reel(job.input.reelId);
      if (!row) throw new Error('Reel introuvable (supprimé entre-temps ?)');
      const track = library.getTrack(row.track_id);
      if (!track) throw new Error('Morceau introuvable (supprimé entre-temps ?)');
      try {
        const folder = path.join(
          ctx.files.outputDir(),
          safeName(track.artist ? `${track.artist} - ${track.title}` : track.title, 'Reels'),
        );
        const outputPath =
          row.file_path ??
          path.join(folder, `${safeName(track.title, 'Reel')} - ${label(row)}.mp4`);
        const result = await engine.renderVideoReel(
          { ...renderRequest(row, track), outputPath },
          {
            signal: job.signal,
            onProgress: (fraction, message) => job.progress(fraction, message),
          },
        );
        const thumbnail = await makeThumbnail(row, result.file);
        const now = new Date().toISOString();
        updateReel(row.id, {
          file_path: result.file,
          thumbnail_path: thumbnail,
          render_key: renderKey(row, track),
          rendered_at: now,
          looped: result.looped ? 1 : 0,
          error: null,
        });
        registerReel(reel(row.id)!, now);
        ctx.events.emit('video.created', { trackId: track.id, file: result.file });
        return { file: result.file };
      } catch (error) {
        updateReel(row.id, {
          error: job.signal.aborted ? 'Rendu annulé' : (error as Error).message,
        });
        throw error;
      }
    });

    const enqueue = (row: ReelRow, track: Track) => {
      renderRequest(row, track); // fails early, with a clear message, when a passage is missing
      const job = ctx.jobs.enqueue(
        'render',
        { reelId: row.id },
        { title: `${label(row)} — ${track.title}` },
      );
      updateReel(row.id, { job_id: job.id, error: null });
      return job;
    };

    // Routes --------------------------------------------------------------------
    ctx.routes.get('/effects', () => engine.videoEffects);

    ctx.routes.get('/tracks', () =>
      library.listTracks().map((track) => {
        const list = reelsOf(track.id);
        return {
          id: track.id,
          title: track.title,
          artist: track.artist,
          durationSec: track.durationSec,
          coverUrl: ctx.files.mediaUrlIfExists(track.coverPath),
          reels: list.length
            ? { total: list.length, published: list.filter((r) => r.published_at).length }
            : null,
        };
      }),
    );

    const trackDto = (track: Track) => {
      const records = outputsByRef(track.id);
      return {
        id: track.id,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec,
        coverUrl: ctx.files.mediaUrlIfExists(track.coverPath),
        audioUrl: ctx.files.mediaUrlIfExists(track.audioPath),
        defaultClip: defaultClip(),
        sources: sourcesOf(track.id).map(sourceDto),
        storage: { track: storage(track.id), all: storage() },
        reels: reelsOf(track.id).map((row) => reelDto(row, track, records)),
      };
    };

    ctx.routes.get('/tracks/:id', (request) => trackDto(requireTrack(idParam(request.params))));

    // Waveform of the track (cached, recomputed when the audio changes).
    const waveforms = new Map<string, { durationSec: number; peaks: number[] }>();
    ctx.routes.get('/tracks/:id/waveform', async (request) => {
      const track = requireTrack(idParam(request.params));
      const key = `${track.audioPath}:${statSync(track.audioPath).mtimeMs}`;
      let data = waveforms.get(key);
      if (!data) {
        data = await engine.waveform(track.audioPath, 400);
        waveforms.set(key, data);
      }
      return data;
    });

    // Import: the videos are copied into ToolBox (the originals are never touched).
    ctx.routes.post('/tracks/:id/sources', async (request) => {
      const track = requireTrack(idParam(request.params));
      const paths = requestBody(request).paths;
      if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== 'string')) {
        throw new HttpError(400, 'Aucune vidéo à importer');
      }
      const added: number[] = [];
      const errors: string[] = [];
      for (const file of paths as string[]) {
        const name = path.basename(file);
        if (!VIDEO_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
          errors.push(`Ignoré (pas une vidéo) : ${name}`);
          continue;
        }
        try {
          const info = await engine.probeVideo(file);
          const inserted = ctx.db
            .prepare(
              `INSERT INTO ${sources} (track_id, file_path, name, duration_sec, width, height, created_at)
               VALUES (?, '', ?, ?, ?, ?, ?)`,
            )
            .run(
              track.id,
              name,
              info.durationSec,
              info.width,
              info.height,
              new Date().toISOString(),
            );
          const id = Number(inserted.lastInsertRowid);
          const target = ctx.files.dataPath('videos', `${id}${path.extname(file).toLowerCase()}`);
          mkdirSync(path.dirname(target), { recursive: true });
          try {
            await copyFile(file, target);
          } catch (error) {
            ctx.db.prepare(`DELETE FROM ${sources} WHERE id = ?`).run(id);
            throw error;
          }
          ctx.db
            .prepare(`UPDATE ${sources} SET file_path = ?, size_bytes = ? WHERE id = ?`)
            .run(target, fileSize(target), id);
          registerSource(source(id)!);
          added.push(id);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      return { added, errors, track: trackDto(track) };
    });

    const requireSource = (id: number) => {
      const row = source(id);
      if (!row) throw new HttpError(404, 'Vidéo introuvable');
      return row;
    };

    // Removes an imported video (its copy goes to the Recycle Bin), unless a Reel uses it.
    ctx.routes.delete('/sources/:id', async (request) => {
      const row = requireSource(idParam(request.params));
      const users = usersOf(row);
      if (users.length > 0) {
        throw new HttpError(
          409,
          `Cette vidéo est utilisée par ${users.map((u) => u.label).join(', ')} : retire d’abord ses passages`,
        );
      }
      await ctx.outputs.delete({ ref: `source:${row.id}` });
      ctx.db.prepare(`DELETE FROM ${sources} WHERE id = ?`).run(row.id);
      for (const strip of existsSync(ctx.files.dataPath('filmstrips'))
        ? readdirSync(ctx.files.dataPath('filmstrips')).filter(
            (f) => f === String(row.id) || f.startsWith(`${row.id}-`),
          )
        : []) {
        rmSync(ctx.files.dataPath('filmstrips', strip), { recursive: true, force: true });
      }
      for (const frame of existsSync(ctx.files.dataPath('frames'))
        ? readdirSync(ctx.files.dataPath('frames')).filter((f) => f.startsWith(`${row.id}-`))
        : []) {
        rmSync(ctx.files.dataPath('frames', frame), { force: true });
      }
      return trackDto(requireTrack(row.track_id));
    });

    // « Supprimer la copie » to free disk space once its Reels are generated: the
    // copy goes to the Recycle Bin (ctx.outputs), the video and its Reels stay.
    ctx.routes.post('/sources/:id/delete-copy', async (request) => {
      const row = requireSource(idParam(request.params));
      if (row.removed_at) return trackDto(requireTrack(row.track_id));
      const pending = usersOf(row).filter((u) => u.state !== 'ready');
      if (pending.length > 0) {
        throw new HttpError(
          409,
          `Encore nécessaire : ${pending.map((u) => u.label).join(', ')} pas encore généré(s) ou à régénérer`,
        );
      }
      await ctx.outputs.delete({ ref: `source:${row.id}` });
      if (!source(row.id)?.removed_at) {
        // Not registered (e.g. already missing): marked here.
        if (existsSync(row.file_path)) throw new HttpError(500, 'Copie non supprimée');
        ctx.db
          .prepare(`UPDATE ${sources} SET removed_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), row.id);
      }
      ctx.logger.info(`Copie de « ${row.name} » envoyée à la Corbeille (place libérée)`);
      return trackDto(requireTrack(row.track_id));
    });

    // « Garder » : the cleanup is not offered again for this video.
    ctx.routes.post('/sources/:id/keep', (request) => {
      const row = requireSource(idParam(request.params));
      ctx.db.prepare(`UPDATE ${sources} SET keep_copy = 1 WHERE id = ?`).run(row.id);
      return trackDto(requireTrack(row.track_id));
    });

    // « Réimporter » a video whose copy was deleted: same video, its Reels can change again.
    ctx.routes.post('/sources/:id/reimport', async (request) => {
      const row = requireSource(idParam(request.params));
      const file = requestBody(request).path;
      if (typeof file !== 'string' || !VIDEO_EXTENSIONS.includes(path.extname(file).toLowerCase()))
        throw new HttpError(400, 'Choisis une vidéo');
      const info = await engine.probeVideo(file);
      const target = ctx.files.dataPath('videos', `${row.id}${path.extname(file).toLowerCase()}`);
      mkdirSync(path.dirname(target), { recursive: true });
      await copyFile(file, target);
      ctx.db
        .prepare(
          `UPDATE ${sources} SET file_path = ?, size_bytes = ?, duration_sec = ?, width = ?, height = ?,
             removed_at = NULL, keep_copy = 0 WHERE id = ?`,
        )
        .run(target, fileSize(target), info.durationSec, info.width, info.height, row.id);
      registerSource(source(row.id)!);
      const warnings =
        Math.abs(info.durationSec - row.duration_sec) > 1
          ? [
              `Durée différente de l’originale (${Math.round(info.durationSec)} s au lieu de ${Math.round(row.duration_sec)} s) : vérifie les passages.`,
            ]
          : [];
      return { warnings, track: trackDto(requireTrack(row.track_id)) };
    });

    // « Retrouver le morceau » : searches every passage again.
    ctx.routes.post('/reels/:id/sync', async (request) => {
      const row = requireReel(idParam(request.params));
      await detectSync(row, true);
      return reelDto(requireReel(row.id), requireTrack(row.track_id));
    });

    // One frame of a video at `t` (s), 240 px high: first and last image of a passage (cached).
    ctx.routes.get('/sources/:id/frame', async (request) => {
      const row = requireSource(idParam(request.params));
      if (row.removed_at || !existsSync(row.file_path)) return { url: null };
      const raw = Number((request.query as { t?: string }).t);
      const t =
        Math.round(
          Math.min(
            Math.max(0, Number.isFinite(raw) ? raw : 0),
            Math.max(0, row.duration_sec - 0.05),
          ) * 10,
        ) / 10;
      const file = ctx.files.dataPath('frames', `${row.id}-${Math.round(t * 10)}.jpg`);
      if (!existsSync(file)) {
        mkdirSync(path.dirname(file), { recursive: true });
        await execFileAsync(
          ctx.binaries.ffmpeg,
          [
            ...['-v', 'error', '-y', '-ss', String(t), '-i', row.file_path],
            ...['-frames:v', '1', '-vf', 'scale=-2:240', '-q:v', '4', file],
          ],
          { windowsHide: true, timeout: 30_000 },
        );
      }
      return { url: existsSync(file) ? ctx.files.mediaUrl(file) : null };
    });

    // Frames of a video for its timeline (cached).
    ctx.routes.get('/sources/:id/filmstrip', async (request) => {
      const row = requireSource(idParam(request.params));
      // ?count=: more frames for the passage timeline (zoomable); 12 by default (focus picker).
      const asked = Math.round(Number((request.query as { count?: string }).count ?? 12));
      const count = Math.min(120, Math.max(4, Number.isFinite(asked) ? asked : 12));
      const dir = ctx.files.dataPath(
        'filmstrips',
        count === 12 ? String(row.id) : `${row.id}-${count}`,
      );
      let files: string[] = [];
      if (existsSync(dir)) {
        files = readdirSync(dir)
          .filter((f) => f.endsWith('.jpg'))
          .sort()
          .map((f) => path.join(dir, f));
      }
      if (files.length === 0) files = await engine.filmstrip(row.file_path, count, dir);
      return { frames: files.map((f) => ctx.files.mediaUrl(f)) };
    });

    // 1 to 4 Reels on the loudest passages, each with the first video by default.
    ctx.routes.post('/tracks/:id/reels', async (request) => {
      const track = requireTrack(idParam(request.params));
      const existing = reelsOf(track.id);
      const count = Math.round(Number(requestBody(request).count ?? 1));
      if (!Number.isInteger(count) || count < 1 || existing.length + count > MAX_REELS) {
        throw new HttpError(400, `De 1 à ${MAX_REELS} Reels par morceau`);
      }
      const videos = sourcesOf(track.id);
      if (videos.length === 0) throw new HttpError(400, 'Importe d’abord au moins une vidéo');
      const clip = Math.min(defaultClip(), Math.max(MIN_CLIP, Math.floor(track.durationSec ?? 60)));
      const wave = await engine.waveform(track.audioPath, 400);
      const taken = existing.map((r) => r.start_sec);
      const starts = suggestStarts(wave.peaks, wave.durationSec, clip, count + taken.length).filter(
        (s) => !taken.includes(s),
      );
      const effectSetting = ctx.settings.get<string>('defaultEffect');
      const effect = EFFECTS.includes(effectSetting as VideoEffectId) ? effectSetting : 'raw';
      const now = new Date().toISOString();
      const positions = [1, 2, 3, 4].filter((p) => !existing.some((r) => r.position === p));
      ctx.db.transaction(() => {
        for (let i = 0; i < count; i++) {
          // The videos in turn: Reel 1 with the first, Reel 2 with the second…
          const video = videos[(existing.length + i) % videos.length]!;
          // One passage from the start of the video, as long as the Reel.
          const segments: Passage[] = [{ sourceId: video.id, start: 0, duration: clip }];
          ctx.db
            .prepare(
              `INSERT INTO ${reels} (track_id, position, start_sec, duration_sec, segments, effect, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              track.id,
              positions[i],
              clampExcerpt(starts[i] ?? 0, clip, wave.durationSec),
              clip,
              JSON.stringify(segments),
              effect,
              now,
              now,
            );
        }
      });
      return trackDto(track);
    });

    ctx.routes.patch('/reels/:id', async (request) => {
      const row = requireReel(idParam(request.params));
      const track = requireTrack(row.track_id);
      const input = requestBody(request);
      const fields: Partial<ReelRow> = {};
      const audioDuration = track.durationSec ?? row.start_sec + row.duration_sec;
      if (input.durationSec !== undefined) {
        const clip = Math.round(Number(input.durationSec));
        if (!Number.isFinite(clip) || clip < MIN_CLIP || clip > MAX_CLIP) {
          throw new HttpError(400, `Durée d’un Reel : entre ${MIN_CLIP} et ${MAX_CLIP} secondes`);
        }
        fields.duration_sec = Math.min(clip, Math.floor(audioDuration));
      }
      const clip = fields.duration_sec ?? row.duration_sec;
      if (input.startSec !== undefined || fields.duration_sec !== undefined) {
        const start = Number(input.startSec ?? row.start_sec);
        if (!Number.isFinite(start)) throw new HttpError(400, 'Point de départ invalide');
        fields.start_sec = clampExcerpt(start, clip, audioDuration);
      }
      // Passages: a start (and, when chained, a duration); always fitted to the Reel's duration.
      if (input.segments !== undefined || fields.duration_sec !== undefined) {
        let passages = segmentsOf(row);
        if (input.segments !== undefined) {
          if (!Array.isArray(input.segments) || input.segments.length > MAX_PASSAGES) {
            throw new HttpError(400, 'Passages invalides');
          }
          passages = (input.segments as Record<string, unknown>[]).map((raw) => {
            const src = source(Number(raw.sourceId));
            if (!src || src.track_id !== row.track_id) throw new HttpError(400, 'Vidéo inconnue');
            const start = Number(raw.start);
            const duration =
              raw.duration !== undefined ? Number(raw.duration) : Number(raw.end) - start;
            if (!Number.isFinite(start)) throw new HttpError(400, 'Départ du passage invalide');
            return {
              sourceId: src.id,
              start,
              duration: Number.isFinite(duration) ? duration : clip,
            };
          });
        }
        try {
          fields.segments = JSON.stringify(fitPassages(passages, clip, videoLength).passages);
        } catch (error) {
          if (error instanceof PassageError) throw new HttpError(400, error.message);
          throw error;
        }
      }
      if (input.framing !== undefined) {
        if (input.framing !== 'fit' && input.framing !== 'fill') {
          throw new HttpError(400, 'Cadrage invalide');
        }
        fields.framing = input.framing;
      }
      for (const [key, column] of [
        ['focusX', 'focus_x'],
        ['focusY', 'focus_y'],
      ] as const) {
        if (input[key] === undefined) continue;
        const value = Number(input[key]);
        if (!Number.isFinite(value)) throw new HttpError(400, 'Point de cadrage invalide');
        fields[column] = Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
      }
      if (input.effect !== undefined) {
        if (!EFFECTS.includes(input.effect as VideoEffectId))
          throw new HttpError(400, 'Effet inconnu');
        fields.effect = input.effect as VideoEffectId;
      }
      if (input.audioMode !== undefined) {
        if (!AUDIO_MODES.includes(input.audioMode as never))
          throw new HttpError(400, 'Son invalide');
        fields.audio_mode = input.audioMode as ReelRow['audio_mode'];
      }
      if (input.intensity !== undefined) {
        if (!INTENSITIES.includes(input.intensity as never))
          throw new HttpError(400, 'Intensité invalide');
        fields.intensity = input.intensity as ReelRow['intensity'];
      }
      if (input.overlayText !== undefined) {
        if (input.overlayText !== null && typeof input.overlayText !== 'string')
          throw new HttpError(400, 'Texte invalide');
        const text = (input.overlayText ?? '')
          .replace(/[\r\n]+/g, ' ')
          .trim()
          .slice(0, 60);
        fields.overlay_text = text || null;
      }
      if (input.caption !== undefined) {
        if (input.caption !== null && typeof input.caption !== 'string') {
          throw new HttpError(400, 'Légende invalide');
        }
        // Equal to the template text: follows the template again.
        fields.caption =
          input.caption === null || input.caption === templateCaption(track) ? null : input.caption;
      }
      if (input.published !== undefined) {
        fields.published_at = input.published
          ? typeof input.publishedAt === 'string'
            ? new Date(input.publishedAt).toISOString()
            : (row.published_at ?? new Date().toISOString())
          : null;
      } else if (typeof input.publishedAt === 'string') {
        fields.published_at = new Date(input.publishedAt).toISOString();
      }
      updateReel(row.id, fields);
      // « Morceau synchronisé »: the passages are searched as soon as they are chosen.
      const updated = requireReel(row.id);
      if (updated.audio_mode === 'synced') await detectSync(updated);
      return reelDto(requireReel(row.id), track);
    });

    // « Enregistrer comme modèle par défaut »: title, artist and hashtags become placeholders.
    ctx.routes.post('/reels/:id/caption/template', (request) => {
      const row = requireReel(idParam(request.params));
      const track = requireTrack(row.track_id);
      const caption = requestBody(request).caption;
      if (typeof caption !== 'string' || !caption.trim()) throw new HttpError(400, 'Légende vide');
      ctx.settings.set('captionTemplate', toTemplate(caption, captionValues(track)));
      ctx.db.prepare(`UPDATE ${reels} SET caption = NULL WHERE id = ?`).run(row.id);
      return reelDto(requireReel(row.id), track);
    });

    // A few low-resolution seconds of the Reel (effect, framing), before rendering it.
    ctx.routes.post('/reels/:id/preview', async (request) => {
      const row = requireReel(idParam(request.params));
      const track = requireTrack(row.track_id);
      try {
        const result = await engine.previewVideoReel({
          ...renderRequest(row, track),
          previewSeconds: 4,
        });
        return { url: ctx.files.mediaUrl(result.file), looped: result.looped };
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
    });

    ctx.routes.post('/reels/:id/render', (request) => {
      const row = requireReel(idParam(request.params));
      if (stateOf(row, library.getTrack(row.track_id)) === 'rendering') {
        throw new HttpError(409, 'Rendu déjà en cours');
      }
      try {
        return enqueue(row, requireTrack(row.track_id));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, (error as Error).message);
      }
    });

    // Renders everything to do: new, changed, failed or missing.
    ctx.routes.post('/tracks/:id/render', (request) => {
      const track = requireTrack(idParam(request.params));
      const jobs = reelsOf(track.id)
        .filter((row) => ['draft', 'outdated', 'failed', 'missing'].includes(stateOf(row, track)))
        .map((row) => {
          try {
            return enqueue(row, track).id;
          } catch (error) {
            updateReel(row.id, { error: (error as Error).message });
            return null;
          }
        })
        .filter(Boolean);
      return { jobs };
    });

    // Deletes a Reel: its file to the Recycle Bin (after confirmation in the UI), then the Reel.
    ctx.routes.delete('/reels/:id', async (request) => {
      const row = requireReel(idParam(request.params));
      if (row.file_path) await ctx.outputs.delete({ ref: `reel:${row.id}` });
      if (row.thumbnail_path) rmSync(row.thumbnail_path, { force: true });
      ctx.db.prepare(`DELETE FROM ${reels} WHERE id = ?`).run(row.id);
      return trackDto(requireTrack(row.track_id));
    });

    const requireFile = (row: ReelRow) => {
      if (!row.file_path || !existsSync(row.file_path)) {
        throw new HttpError(404, 'Le fichier n’existe pas (encore) : génère-le d’abord');
      }
      return row.file_path;
    };
    ctx.routes.post('/reels/:id/open', async (request) => {
      await ctx.files.open(requireFile(requireReel(idParam(request.params))));
      return { ok: true };
    });
    ctx.routes.post('/reels/:id/reveal', (request) => {
      ctx.files.reveal(requireFile(requireReel(idParam(request.params))));
      return { ok: true };
    });

    // « À publier »: rendered and not published, every track.
    ctx.routes.get('/to-publish', () =>
      (ctx.db.prepare(`SELECT * FROM ${reels} WHERE published_at IS NULL`).all() as ReelRow[])
        .filter((row) => row.file_path && existsSync(row.file_path))
        .flatMap((row) => {
          const track = library.getTrack(row.track_id);
          return track ? [{ ...reelDto(row, track), trackTitle: track.title }] : [];
        }),
    );

    // Project page of the library: ticked « Publié » = published.
    library.registerProjectStatus({
      moduleId: ctx.id,
      get: (trackId) =>
        reelsOf(trackId)
          .filter((row) => row.published_at)
          .map((row) => ({
            moduleId: ctx.id,
            ref: `reel:${row.id}`,
            status: 'published' as const,
            detail: `Publié le ${new Date(row.published_at!).toLocaleDateString('fr-FR')}`,
          })),
    });
    library.registerTrackInfo({
      moduleId: ctx.id,
      label: 'Reels perso',
      get: (trackId) => {
        const list = reelsOf(trackId);
        return list.length
          ? `${list.filter((r) => r.published_at).length}/${list.length} publiés`
          : null;
      },
    });

    // Assistant (MODULES.md §5.15): read only.
    ctx.assistant.define({
      name: 'reels-status',
      description:
        'État des Reels perso (faits avec tes vidéos) d’un morceau : générés, à régénérer, publiés. Sans morceau : les morceaux qui ont des Reels perso pas encore publiés.',
      parameters: {
        track: { type: 'string', description: 'Nom du morceau, même approximatif (facultatif)' },
      },
      risk: 'read',
      run: (params) => {
        const describe = (trackId: number) =>
          reelsOf(trackId)
            .map(toReel)
            .map((r) => ({
              label: r.label,
              state: ELEMENT_STATES[r.state] ?? r.state,
              published: Boolean(r.publishedAt),
            }));
        if (params.track) {
          const match = matchByName(library.listTracks(), String(params.track), (t) => [
            t.title,
            ...(t.nicknames ?? []),
          ]);
          if (match.kind === 'none')
            throw new NotFoundError(
              'track',
              'le morceau',
              String(params.track),
              match.suggestions.map((t) => t.title),
            );
          if (match.kind === 'ambiguous') {
            throw new HttpError(
              409,
              `Plusieurs morceaux correspondent : ${listPhrase(match.items.slice(0, 4).map((t) => t.title))}. Lequel ?`,
            );
          }
          const list = describe(match.item.id);
          if (list.length === 0)
            return {
              message: `${match.item.title} n’a pas de Reel perso.`,
              data: { track: match.item.title, reels: [] },
            };
          return {
            message: `Reels perso de ${match.item.title} : ${listPhrase(list.map((r) => `${r.label} ${r.published ? 'publié' : r.state}`))}.`,
            data: { track: match.item.title, reels: list },
          };
        }
        const pending = library
          .listTracks()
          .map((t) => ({ track: t.title, reels: describe(t.id) }))
          .filter((t) => t.reels.some((r) => !r.published));
        return {
          message: pending.length
            ? `Reels perso pas encore publiés : ${listPhrase(pending.slice(0, 6).map((t) => `${t.track} (${t.reels.filter((r) => !r.published).length})`))}.`
            : 'Aucun Reel perso en attente de publication.',
          data: { tracks: pending.slice(0, 20) },
        };
      },
    });

    // Service (Planning de sortie) ------------------------------------------------
    const service: CustomReelsService = {
      listReels: (trackId) => reelsOf(trackId).map(toReel),
      getReel: (id) => {
        const row = reel(id);
        return row ? toReel(row) : null;
      },
      setPublished: (id, published, at) => {
        const row = reel(id);
        if (!row) throw new Error('Reel introuvable');
        updateReel(row.id, {
          published_at: published ? (at ?? row.published_at ?? new Date().toISOString()) : null,
        });
        return toReel(reel(row.id)!);
      },
      setCaption: (id, caption) => {
        const row = reel(id);
        if (!row) throw new Error('Reel introuvable');
        ctx.db
          .prepare(`UPDATE ${reels} SET caption = ?, updated_at = ? WHERE id = ?`)
          .run(caption, new Date().toISOString(), row.id);
        return toReel(reel(row.id)!);
      },
      renderReel: (id) => {
        const row = reel(id);
        if (!row) throw new Error('Reel introuvable');
        const track = library.getTrack(row.track_id);
        if (!track) throw new Error('Morceau introuvable');
        return { jobId: enqueue(row, track).id };
      },
    };
    ctx.services.provide(CUSTOM_REELS_SERVICE, service);
  },
});
