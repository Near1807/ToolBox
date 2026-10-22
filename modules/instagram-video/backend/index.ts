// instagram-video: the Instagram pack of a track (4 vertical Reels, a 4:5 post
// image, an editable caption) and the tracking of what has been published.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { defineBackendModule, HttpError, type ModuleContext } from '@hub/sdk/backend';
import type { MusicLibraryService, Track } from '../../music-library/contract';
import type { VideoEngineService } from '../../video-engine/contract';
import {
  analyzeFile,
  clampExcerpt,
  downsamplePeaks,
  pickExcerpts,
  type AudioAnalysis,
} from './analysis';
import { INSTAGRAM_PACK_SERVICE, type InstagramPackService, type PackItem } from '../contract';
import { toTemplate } from '@hub/sdk/texts';
import { buildCaption, buildHashtags, itemFileName, packFolderName } from './caption';
import {
  itemLabel,
  MAX_REELS,
  migrationV2,
  migrationV3,
  migrationV4,
  PackStore,
  RENDER_VERSION,
  type ItemRow,
  type PackRow,
} from './packs';

const FORMAT = 'instagram' as const;
const MIN_CLIP = 15;
const MAX_CLIP = 60;
const FADE_SECONDS = 0.5;
const WAVEFORM_BARS = 400;
const run = promisify(execFile);

interface LegacyReelRow {
  id: number;
  track_id: number;
  file_path: string;
  start_sec: number;
  duration_sec: number;
  created_at: string;
}

function idParam(params: unknown): number {
  const id = Number((params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Identifiant invalide');
  return id;
}

function body(request: { body?: unknown }): Record<string, unknown> {
  return (request.body ?? {}) as Record<string, unknown>;
}

/** "2026-10-19" or a full ISO date → ISO string; throws a 400 otherwise. */
function parseDate(value: unknown): string {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime()))
    throw new HttpError(400, 'Date de publication invalide');
  return date.toISOString();
}

export default defineBackendModule({
  migrations: [
    {
      version: 1,
      description: 'generated reels',
      up: `
        CREATE TABLE instagram_video__reels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          track_id INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          start_sec REAL NOT NULL,
          duration_sec REAL NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX instagram_video__reels_track ON instagram_video__reels (track_id);
      `,
    },
    // v0.6: the pack (post + 4 Reels + caption + publication). The v1 table is kept as is.
    { version: 2, description: 'Instagram packs and publication tracking', up: migrationV2 },
    { version: 3, description: 'one style per Reel, hook phrase', up: migrationV3 },
    // v0.8: one sober look again; drops the style columns of v0.7 (explicit, see CHANGELOG).
    {
      version: 4,
      description: 'drop Reel styles and hook phrases, add render version',
      up: migrationV4,
    },
  ],

  register(ctx: ModuleContext) {
    const library = ctx.services.get<MusicLibraryService>('musicLibrary');
    const engine = ctx.services.get<VideoEngineService>('videoEngine');
    const store = new PackStore(ctx);
    const legacyReels = ctx.db.table('reels');

    const defaultClip = () => ctx.settings.get<number>('clipDuration') ?? 28;

    const requireTrack = (id: number): Track => {
      const track = library.getTrack(id);
      if (!track) throw new HttpError(404, 'Morceau introuvable');
      return track;
    };

    const requireCover = (track: Track): string => {
      if (!track.coverPath) {
        throw new HttpError(400, 'Ce morceau n’a pas de cover : ajoute-la dans la Bibliothèque');
      }
      return track.coverPath;
    };

    const clipParam = (value: unknown): number => {
      const clip = Number(value ?? defaultClip());
      if (!Number.isFinite(clip) || clip < MIN_CLIP || clip > MAX_CLIP) {
        throw new HttpError(400, `Durée d’un Reel : entre ${MIN_CLIP} et ${MAX_CLIP} secondes`);
      }
      return Math.round(clip);
    };

    const captionFor = (track: Track) =>
      buildCaption({
        template: ctx.settings.get<string>('captionTemplate') ?? '',
        title: track.title,
        artist: track.artist,
        tags: track.tags,
        hashtags: ctx.settings.get<string>('hashtags') ?? '',
      });
    const templateCaption = (trackId: number) => {
      const track = library.getTrack(trackId);
      return track ? captionFor(track) : null;
    };

    /** Analysis cached per track, invalidated when the audio file changes. */
    const analyze = async (track: Track): Promise<AudioAnalysis> => {
      const stats = statSync(track.audioPath);
      const key = `${stats.size}-${Math.round(stats.mtimeMs)}`;
      const cacheFile = ctx.files.dataPath('analysis', `${track.id}.json`);
      try {
        const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as {
          key: string;
          analysis: AudioAnalysis;
        };
        if (cached.key === key) return cached.analysis;
      } catch {
        // No cache yet.
      }
      const analysis = await analyzeFile(ctx.binaries.ffmpeg, track.audioPath);
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ key, analysis }));
      return analysis;
    };

    /** How many Reels fit: without overlap, and with a slight overlap. */
    const capacity = (analysis: AudioAnalysis, clipSec: number) => ({
      distinct: pickExcerpts(analysis, { count: MAX_REELS, clipSec }).starts.length,
      overlapping: pickExcerpts(analysis, { count: MAX_REELS, clipSec, allowOverlap: true }).starts
        .length,
    });

    const fileUrl = (file: string | null) => {
      if (!file || !existsSync(file)) return null;
      try {
        return ctx.files.mediaUrl(file);
      } catch {
        return null; // Moved outside the output folder.
      }
    };

    const itemDto = (
      pack: PackRow,
      item: ItemRow,
      records: Map<string, { id: number }> = outputsByRef(pack),
    ) => ({
      id: item.id,
      outputId: records.get(`item:${item.id}`)?.id ?? null,
      packId: pack.id,
      kind: item.kind,
      position: item.position,
      label: itemLabel(item.position),
      startSec: item.start_sec,
      durationSec: item.duration_sec,
      ownCaption: item.caption,
      caption: (pack.per_reel_captions && item.caption) || pack.caption,
      state: store.state(item),
      jobId: item.job_id,
      error: item.error,
      fileName: item.file_path ? path.basename(item.file_path) : null,
      url: fileUrl(item.file_path),
      thumbnailUrl: fileUrl(item.thumbnail_path),
      renderedAt: item.rendered_at,
      publishedAt: item.published_at,
    });

    const packDto = (pack: PackRow) => {
      const records = outputsByRef(pack);
      const items = store.listItems(pack.id).map((item) => itemDto(pack, item, records));
      return {
        id: pack.id,
        trackId: pack.track_id,
        clipDuration: pack.clip_duration,
        caption: pack.caption,
        /** The caption differs from the template text of the settings. */
        captionCustom: pack.caption !== templateCaption(pack.track_id),
        perReelCaptions: Boolean(pack.per_reel_captions),
        folder: pack.folder,
        items,
        published: items.filter((item) => item.publishedAt).length,
        total: items.length,
      };
    };

    // Every generated file goes through ctx.outputs (deletion, missing files).
    const subject = (trackId: number) => `music-library:track:${trackId}`;
    const registerItem = (pack: PackRow, item: ItemRow, createdAt?: string) =>
      item.file_path
        ? ctx.outputs.register({
            path: item.file_path,
            ref: `item:${item.id}`,
            parent: `pack:${pack.id}`,
            subject: subject(pack.track_id),
            label:
              item.kind === 'post' ? 'Post Instagram' : `${itemLabel(item.position)} Instagram`,
            kind: item.kind,
            createdAt: createdAt ?? item.rendered_at ?? undefined,
          })
        : null;
    const registerLegacy = (row: LegacyReelRow) =>
      ctx.outputs.register({
        path: row.file_path,
        ref: `legacy-reel:${row.id}`,
        parent: `track:${row.track_id}`,
        subject: subject(row.track_id),
        label: 'Reel Instagram (v0.5)',
        kind: 'reel',
        createdAt: row.created_at,
      });
    // Files made before v0.7 are registered at startup (idempotent, nothing deleted).
    for (const pack of store.allPacks()) {
      for (const item of store.listItems(pack.id)) registerItem(pack, item);
    }
    for (const row of ctx.db.prepare(`SELECT * FROM ${legacyReels}`).all() as LegacyReelRow[]) {
      registerLegacy(row);
    }
    /** Item without its file: back to « À générer », excerpt kept. */
    const resetItem = (id: number) => {
      const item = store.item(id);
      if (!item) return;
      if (item.thumbnail_path && item.thumbnail_path !== item.file_path) {
        rmSync(item.thumbnail_path, { force: true }); // private miniature
      }
      store.updateItem(id, {
        file_path: null,
        thumbnail_path: null,
        job_id: null,
        error: null,
        rendered_start_sec: null,
        rendered_duration_sec: null,
        render_version: null,
        rendered_at: null,
        published_at: null,
      });
    };
    ctx.outputs.onRemoved((records) => {
      for (const record of records) {
        const [kind, id] = record.ref.split(':');
        if (kind === 'item') resetItem(Number(id));
        if (kind === 'legacy-reel') {
          ctx.db.prepare(`DELETE FROM ${legacyReels} WHERE id = ?`).run(Number(id));
        }
      }
    });
    // « Sans projet » > Rattacher (one pack per track). The chosen track has no
    // pack: the whole pack follows (its other items too). It has one: each file
    // takes the same place in it (post, Reel n), refused if that place already
    // has a file. All inside the core's transaction: all or nothing.
    ctx.outputs.onReattach((records, newSubject) => {
      const trackId = library.trackIdOf(newSubject);
      if (trackId === null)
        throw new HttpError(409, 'Un élément Instagram se rattache à un morceau');
      const itemsTable = ctx.db.table('pack_items');
      for (const record of records) {
        const [kind, rawId] = record.ref.split(':');
        const id = Number(rawId);
        if (kind === 'legacy-reel') {
          const row = ctx.db.prepare(`SELECT * FROM ${legacyReels} WHERE id = ?`).get(id) as
            LegacyReelRow | undefined;
          if (!row) continue;
          ctx.db.prepare(`UPDATE ${legacyReels} SET track_id = ? WHERE id = ?`).run(trackId, id);
          registerLegacy({ ...row, track_id: trackId });
          continue;
        }
        if (kind !== 'item') continue;
        const item = store.item(id);
        const from = item ? store.pack(item.pack_id) : null;
        if (!item || !from || from.track_id === trackId) continue;
        let target = store.byTrack(trackId);
        if (!target) {
          // The whole pack is being attached (every item with a file): it moves as is.
          const reattached = new Set(records.map((r) => r.ref));
          const whole = store
            .listItems(from.id)
            .filter((i) => i.file_path)
            .every((i) => reattached.has(`item:${i.id}`));
          if (whole) {
            ctx.db
              .prepare(
                `UPDATE ${ctx.db.table('packs')} SET track_id = ?, updated_at = ? WHERE id = ?`,
              )
              .run(trackId, new Date().toISOString(), from.id);
            const moved = store.requirePack(from.id);
            for (const sibling of store.listItems(from.id)) registerItem(moved, sibling);
            continue;
          }
          // Only some items: an empty pack for the track (same settings), the item takes its place.
          const track = library.getTrack(trackId)!;
          target = store.create({
            trackId,
            clipDuration: from.clip_duration,
            caption: from.caption,
            folder: path.join(ctx.files.outputDir(), packFolderName(track)),
            starts: [],
          });
          if (from.per_reel_captions) store.updatePack(target.id, { per_reel_captions: 1 });
        }
        const slot = store.listItems(target.id).find((i) => i.position === item.position);
        if (slot?.file_path) {
          throw new HttpError(
            409,
            `Le pack de ce morceau a déjà un fichier pour « ${item.kind === 'post' ? 'Post' : itemLabel(item.position)} » : supprime-le d’abord`,
          );
        }
        const slotId =
          slot?.id ??
          Number(
            ctx.db
              .prepare(
                `INSERT INTO ${itemsTable} (pack_id, kind, position, start_sec, duration_sec) VALUES (?, ?, ?, ?, ?)`,
              )
              .run(target.id, item.kind, item.position, item.start_sec, item.duration_sec)
              .lastInsertRowid,
          );
        const carried = {
          start_sec: item.start_sec,
          duration_sec: item.duration_sec,
          caption: item.caption,
          file_path: item.file_path,
          thumbnail_path: item.thumbnail_path,
          rendered_start_sec: item.rendered_start_sec,
          rendered_duration_sec: item.rendered_duration_sec,
          rendered_at: item.rendered_at,
          published_at: item.published_at,
          render_version: item.render_version,
          error: null,
          job_id: null,
        };
        store.updateItem(slotId, carried);
        // The old place goes back to « À générer » (the file now belongs to the new one).
        store.updateItem(item.id, {
          file_path: null,
          thumbnail_path: null,
          job_id: null,
          error: null,
          rendered_start_sec: null,
          rendered_duration_sec: null,
          render_version: null,
          rendered_at: null,
          published_at: null,
        });
        registerItem(target, store.requireItem(slotId));
      }
    });
    const outputsByRef = (pack: PackRow) =>
      new Map(ctx.outputs.list({ parent: `pack:${pack.id}` }).map((r) => [r.ref, r]));

    // "Pack Instagram : 2/5 publiés" on the track page of the Library.
    library.registerTrackInfo({
      moduleId: ctx.id,
      label: 'Pack Instagram',
      get: (trackId) => {
        const pack = store.byTrack(trackId);
        if (!pack) return null;
        const items = store.listItems(pack.id);
        const published = items.filter((item) => item.published_at).length;
        return `${published}/${items.length} publiés`;
      },
    });

    // Project page of the library: ticked « Publié » = published.
    library.registerProjectStatus({
      moduleId: ctx.id,
      get: (trackId) => {
        const pack = store.byTrack(trackId);
        if (!pack) return [];
        return store
          .listItems(pack.id)
          .filter((item) => item.published_at)
          .map((item) => ({
            moduleId: ctx.id,
            ref: `item:${item.id}`,
            status: 'published' as const,
            detail: `Publié le ${new Date(item.published_at!).toLocaleDateString('fr-FR')}`,
          }));
      },
    });

    /** Small JPEG of a Reel for the lists ("À publier"). */
    const makeThumbnail = async (item: ItemRow, video: string): Promise<string | null> => {
      const file = ctx.files.dataPath('thumbnails', `${item.id}.jpg`);
      mkdirSync(path.dirname(file), { recursive: true });
      try {
        await run(ctx.binaries.ffmpeg, [
          ...['-v', 'error', '-y', '-ss', '3', '-i', video],
          ...['-frames:v', '1', '-vf', 'scale=270:-2', '-q:v', '4', file],
        ]);
        return file;
      } catch (error) {
        ctx.logger.warn('Miniature impossible', error);
        return null;
      }
    };

    ctx.jobs.define<{ itemId: number }, { file: string }>('render-item', async (job) => {
      const item = store.item(job.input.itemId);
      const pack = item ? store.pack(item.pack_id) : null;
      if (!item || !pack) throw new Error('Élément du pack introuvable');
      const track = library.getTrack(pack.track_id);
      if (!track) throw new Error('Morceau introuvable (supprimé entre-temps ?)');
      try {
        const coverPath = requireCover(track);
        const outputPath = store.outputPath(pack, item, itemFileName(track.title, item.position));
        let file: string;
        let thumbnail: string | null;
        if (item.kind === 'post') {
          job.progress(null, 'Création de l’image…');
          file = (
            await engine.renderPost({
              coverPath,
              title: track.title,
              artist: track.artist,
              outputPath,
            })
          ).file;
          thumbnail = file;
        } else {
          file = (
            await engine.render(
              {
                format: FORMAT,
                audioPath: track.audioPath,
                coverPath,
                title: track.title,
                artist: track.artist,
                start: item.start_sec ?? 0,
                duration: item.duration_sec ?? pack.clip_duration,
                fadeSeconds: FADE_SECONDS,
                outputPath,
              },
              {
                signal: job.signal,
                onProgress: (fraction, message) => job.progress(fraction, message),
              },
            )
          ).file;
          thumbnail = await makeThumbnail(item, file);
        }
        store.updateItem(item.id, {
          file_path: file,
          thumbnail_path: thumbnail,
          error: null,
          rendered_start_sec: item.start_sec,
          rendered_duration_sec: item.duration_sec,
          render_version: RENDER_VERSION[item.kind],
          rendered_at: new Date().toISOString(),
        });
        registerItem(pack, store.item(item.id)!, new Date().toISOString());
        ctx.events.emit(item.kind === 'post' ? 'post.created' : 'video.created', {
          trackId: track.id,
          file,
        });
        return { file };
      } catch (error) {
        store.updateItem(item.id, {
          error: job.signal.aborted ? 'Rendu annulé' : (error as Error).message,
        });
        throw error;
      }
    });

    const enqueueItem = (pack: PackRow, item: ItemRow, track: Track) => {
      const job = ctx.jobs.enqueue(
        'render-item',
        { itemId: item.id },
        { title: `Pack Insta — ${track.title} — ${itemLabel(item.position)}` },
      );
      store.updateItem(item.id, { job_id: job.id, error: null });
      return job;
    };

    const packOfItem = (item: ItemRow) => {
      const pack = store.requirePack(item.pack_id);
      return { pack, track: requireTrack(pack.track_id) };
    };

    const requireFile = (item: ItemRow): string => {
      if (!item.file_path || !existsSync(item.file_path)) {
        throw new HttpError(404, 'Le fichier n’existe pas (encore) : génère-le d’abord');
      }
      return item.file_path;
    };

    const trackSummary = (track: Track) => {
      const pack = store.byTrack(track.id);
      const items = pack ? store.listItems(pack.id) : [];
      return {
        id: track.id,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec,
        coverUrl: track.coverPath ? ctx.files.mediaUrl(track.coverPath) : null,
        pack: pack
          ? { published: items.filter((i) => i.published_at).length, total: items.length }
          : null,
      };
    };

    ctx.routes.get('/tracks', () => library.listTracks().map(trackSummary));

    ctx.routes.get('/tracks/:id', (request) => {
      const track = requireTrack(idParam(request.params));
      const pack = store.byTrack(track.id);
      const legacy = ctx.db
        .prepare(`SELECT * FROM ${legacyReels} WHERE track_id = ? ORDER BY created_at DESC`)
        .all(track.id) as LegacyReelRow[];
      const legacyRecords = new Map(
        ctx.outputs.list({ parent: `track:${track.id}` }).map((r) => [r.ref, r]),
      );
      return {
        ...trackSummary(track),
        audioUrl: ctx.files.mediaUrl(track.audioPath),
        defaultClip: defaultClip(),
        pack: pack ? packDto(pack) : null,
        legacyReels: legacy.map((row) => ({
          id: row.id,
          fileName: path.basename(row.file_path),
          startSec: row.start_sec,
          durationSec: row.duration_sec,
          createdAt: row.created_at,
          exists: existsSync(row.file_path),
          outputId: (legacyRecords.get(`legacy-reel:${row.id}`) ?? registerLegacy(row)).id,
        })),
      };
    });

    // Waveform, plus how many distinct excerpts fit for a clip length (?clip=28).
    ctx.routes.get('/tracks/:id/waveform', async (request) => {
      const track = requireTrack(idParam(request.params));
      const clip = clipParam((request.query as { clip?: string }).clip);
      const analysis = await analyze(track);
      return {
        durationSec: analysis.durationSec,
        peaks: downsamplePeaks(analysis.peaks, WAVEFORM_BARS),
        capacity: capacity(analysis, clip),
      };
    });

    // Draft pack with the excerpts chosen automatically (nothing is rendered yet).
    ctx.routes.post('/tracks/:id/pack', async (request) => {
      const track = requireTrack(idParam(request.params));
      if (store.byTrack(track.id)) throw new HttpError(409, 'Ce morceau a déjà un pack');
      const input = body(request);
      const clip = clipParam(input.clipDuration);
      const count = Math.round(Number(input.count ?? MAX_REELS));
      if (!Number.isInteger(count) || count < 1 || count > MAX_REELS) {
        throw new HttpError(400, `Nombre de Reels : entre 1 et ${MAX_REELS}`);
      }
      const analysis = await analyze(track);
      const { starts } = pickExcerpts(analysis, {
        count,
        clipSec: clip,
        allowOverlap: input.allowOverlap === true,
      });
      const pack = store.create({
        trackId: track.id,
        clipDuration: clip,
        caption: captionFor(track),
        folder: path.join(ctx.files.outputDir(), packFolderName(track)),
        starts,
      });
      return packDto(pack);
    });

    ctx.routes.patch('/packs/:id', (request) => {
      const pack = store.requirePack(idParam(request.params));
      const input = body(request);
      if (input.caption !== undefined && typeof input.caption !== 'string') {
        throw new HttpError(400, 'Légende invalide');
      }
      const clip = input.clipDuration === undefined ? undefined : clipParam(input.clipDuration);
      ctx.db.transaction(() => {
        store.updatePack(pack.id, {
          caption: input.caption as string | undefined,
          clip_duration: clip,
          per_reel_captions:
            input.perReelCaptions === undefined ? undefined : input.perReelCaptions ? 1 : 0,
        });
        if (clip !== undefined) {
          // Published Reels keep the length they were published with.
          const track = requireTrack(pack.track_id);
          for (const item of store.listItems(pack.id)) {
            if (item.kind !== 'reel' || item.published_at) continue;
            const fitted = clampExcerpt(item.start_sec ?? 0, clip, track.durationSec ?? clip);
            store.updateItem(item.id, { start_sec: fitted.start, duration_sec: fitted.duration });
          }
        }
        // Per-Reel captions start from the main caption.
        if (input.perReelCaptions === true) {
          const caption = store.pack(pack.id)!.caption;
          for (const item of store.listItems(pack.id)) {
            if (item.kind === 'reel' && item.caption === null) {
              store.updateItem(item.id, { caption });
            }
          }
        }
      });
      return packDto(store.pack(pack.id)!);
    });

    // Caption back to the template of the settings.
    ctx.routes.post('/packs/:id/caption/reset', (request) => {
      const pack = store.requirePack(idParam(request.params));
      store.updatePack(pack.id, { caption: captionFor(requireTrack(pack.track_id)) });
      return packDto(store.pack(pack.id)!);
    });

    // « Enregistrer comme modèle par défaut »: title, artist and hashtags become placeholders.
    ctx.routes.post('/packs/:id/caption/template', (request) => {
      const pack = store.requirePack(idParam(request.params));
      const track = requireTrack(pack.track_id);
      const caption = (request.body as { caption?: unknown } | null)?.caption;
      if (typeof caption !== 'string' || !caption.trim()) {
        throw new HttpError(400, 'Légende vide');
      }
      const hashtags = buildHashtags(track.tags, ctx.settings.get<string>('hashtags') ?? '');
      ctx.settings.set(
        'captionTemplate',
        toTemplate(caption, {
          titre: track.title,
          artiste: track.artist,
          hashtags: hashtags.join(' '),
        }),
      );
      store.updatePack(pack.id, { caption: captionFor(track) });
      return packDto(store.pack(pack.id)!);
    });

    // New automatic excerpts for the Reels not yet published.
    ctx.routes.post('/packs/:id/suggest', async (request) => {
      const pack = store.requirePack(idParam(request.params));
      const track = requireTrack(pack.track_id);
      const items = store.listItems(pack.id).filter((item) => item.kind === 'reel');
      const published = items.filter((item) => item.published_at);
      const open = items.filter((item) => !item.published_at);
      const { starts } = pickExcerpts(await analyze(track), {
        count: open.length,
        clipSec: pack.clip_duration,
        allowOverlap: body(request).allowOverlap === true,
        fixed: published.map((item) => item.start_sec ?? 0),
      });
      ctx.db.transaction(() =>
        open.forEach((item, index) => {
          if (starts[index] !== undefined) {
            store.updateItem(item.id, {
              start_sec: starts[index],
              duration_sec: pack.clip_duration,
            });
          }
        }),
      );
      return packDto(store.pack(pack.id)!);
    });

    ctx.routes.post('/packs/:id/render', (request) => {
      const pack = store.requirePack(idParam(request.params));
      const track = requireTrack(pack.track_id);
      requireCover(track);
      const todo = store
        .listItems(pack.id)
        .filter((item) => ['draft', 'outdated', 'failed', 'missing'].includes(store.state(item)));
      for (const item of todo) enqueueItem(pack, item, track);
      return { queued: todo.length, pack: packDto(store.pack(pack.id)!) };
    });

    ctx.routes.post('/packs/:id/open-folder', async (request) => {
      const pack = store.requirePack(idParam(request.params));
      mkdirSync(pack.folder, { recursive: true });
      await ctx.files.open(pack.folder);
      return { ok: true };
    });

    // « Supprimer le pack »: every file to the Recycle Bin, then the pack itself.
    ctx.routes.delete('/packs/:id', async (request) => {
      const pack = store.requirePack(idParam(request.params));
      if (store.listItems(pack.id).some((item) => store.state(item) === 'rendering')) {
        throw new HttpError(409, 'Un rendu de ce pack est en cours : annule-le d’abord');
      }
      const deleted = await ctx.outputs.delete({ parent: `pack:${pack.id}` });
      for (const item of store.listItems(pack.id)) {
        if (item.thumbnail_path && item.thumbnail_path !== item.file_path) {
          rmSync(item.thumbnail_path, { force: true });
        }
      }
      store.deletePack(pack.id);
      ctx.logger.info(`Pack #${pack.id} supprimé (${deleted} fichier(s) à la Corbeille)`);
      return { ok: true, deleted };
    });

    ctx.routes.patch('/items/:id', (request) => {
      const item = store.requireItem(idParam(request.params));
      const { track } = packOfItem(item);
      const input = body(request);
      const fields: Parameters<PackStore['updateItem']>[1] = {};
      if (input.startSec !== undefined) {
        if (item.kind !== 'reel') throw new HttpError(400, 'Seuls les Reels ont un extrait');
        const start = Number(input.startSec);
        if (!Number.isFinite(start) || start < 0) {
          throw new HttpError(400, 'Point de départ invalide');
        }
        const duration = item.duration_sec ?? defaultClip();
        fields.start_sec = clampExcerpt(start, duration, track.durationSec ?? duration).start;
      }
      if (input.caption !== undefined) {
        if (input.caption !== null && typeof input.caption !== 'string') {
          throw new HttpError(400, 'Légende invalide');
        }
        fields.caption = input.caption as string | null;
      }
      if (input.published !== undefined) {
        fields.published_at = input.published
          ? input.publishedAt
            ? parseDate(input.publishedAt)
            : (item.published_at ?? new Date().toISOString())
          : null;
      } else if (input.publishedAt !== undefined) {
        fields.published_at = input.publishedAt === null ? null : parseDate(input.publishedAt);
      }
      // updateItem skips undefined values only: explicit nulls are written.
      store.updateItem(item.id, fields);
      const updated = store.item(item.id)!;
      return itemDto(store.pack(updated.pack_id)!, updated);
    });

    // A few low-resolution seconds of a Reel, before rendering it.
    ctx.routes.post('/items/:id/preview', async (request) => {
      const item = store.requireItem(idParam(request.params));
      if (item.kind !== 'reel') throw new HttpError(400, 'Aperçu disponible pour les Reels');
      const { track } = packOfItem(item);
      const result = await engine.preview({
        format: FORMAT,
        audioPath: track.audioPath,
        coverPath: requireCover(track),
        title: track.title,
        artist: track.artist,
        start: item.start_sec ?? 0,
        previewSeconds: 6,
      });
      return { url: ctx.files.mediaUrl(result.file) };
    });

    // "Régénérer": a single item, without redoing the whole pack.
    ctx.routes.post('/items/:id/render', (request) => {
      const item = store.requireItem(idParam(request.params));
      if (store.state(item) === 'rendering') throw new HttpError(409, 'Rendu déjà en cours');
      const { pack, track } = packOfItem(item);
      requireCover(track);
      enqueueItem(pack, item, track);
      return itemDto(pack, store.item(item.id)!);
    });

    ctx.routes.post('/items/:id/open', async (request) => {
      await ctx.files.open(requireFile(store.requireItem(idParam(request.params))));
      return { ok: true };
    });

    ctx.routes.post('/items/:id/reveal', (request) => {
      ctx.files.reveal(requireFile(store.requireItem(idParam(request.params))));
      return { ok: true };
    });

    // Everything generated and not yet published, across all tracks.
    ctx.routes.get('/to-publish', () =>
      store.allPacks().flatMap((pack) => {
        const track = library.getTrack(pack.track_id);
        if (!track) return [];
        return store
          .listItems(pack.id)
          .filter((item) => !item.published_at && item.file_path && existsSync(item.file_path))
          .map((item) => ({
            track: { id: track.id, title: track.title, artist: track.artist },
            item: itemDto(pack, item),
          }));
      }),
    );

    // Service for the other modules (Planning de sortie: reminders, « Publié » in sync).
    const toPackItem = (pack: PackRow, item: ItemRow): PackItem => ({
      id: item.id,
      kind: item.kind,
      position: item.position,
      label: itemLabel(item.position),
      filePath: item.file_path,
      thumbnailPath: item.thumbnail_path,
      caption: (pack.per_reel_captions && item.caption) || pack.caption,
      state: store.state(item),
      durationSec: item.duration_sec,
      publishedAt: item.published_at,
    });
    const service: InstagramPackService = {
      getPack: (trackId) => {
        const pack = store.byTrack(trackId);
        if (!pack) return null;
        return {
          id: pack.id,
          trackId: pack.track_id,
          caption: pack.caption,
          items: store.listItems(pack.id).map((item) => toPackItem(pack, item)),
        };
      },
      getItem: (itemId) => {
        const item = store.item(itemId);
        const pack = item ? store.pack(item.pack_id) : null;
        return item && pack ? { ...toPackItem(pack, item), trackId: pack.track_id } : null;
      },
      setPublished: (itemId, published, at) => {
        const item = store.item(itemId);
        if (!item) throw new Error('Élément du pack introuvable');
        store.updateItem(item.id, {
          published_at: published ? (at ?? item.published_at ?? new Date().toISOString()) : null,
        });
        const updated = store.item(item.id)!;
        return toPackItem(store.pack(updated.pack_id)!, updated);
      },
      setCaption: (itemId, caption) => {
        const item = store.item(itemId);
        if (!item) throw new Error('Élément du pack introuvable');
        const { pack, track } = packOfItem(item);
        if (item.kind === 'post') {
          // The post carries the pack caption; null = back to the template.
          store.updatePack(pack.id, { caption: caption ?? captionFor(track) });
        } else if (caption === null) {
          store.updateItem(item.id, { caption: null });
        } else {
          if (!pack.per_reel_captions) {
            // Per-Reel captions start from the main caption.
            store.updatePack(pack.id, { per_reel_captions: 1 });
            for (const other of store.listItems(pack.id)) {
              if (other.kind === 'reel' && other.caption === null) {
                store.updateItem(other.id, { caption: pack.caption });
              }
            }
          }
          store.updateItem(item.id, { caption });
        }
        const updated = store.item(item.id)!;
        return toPackItem(store.pack(updated.pack_id)!, updated);
      },
      renderItem: (itemId) => {
        const item = store.item(itemId);
        if (!item) throw new Error('Élément du pack introuvable');
        if (store.state(item) === 'rendering') throw new Error('Rendu déjà en cours');
        const { pack, track } = packOfItem(item);
        if (!track.coverPath) throw new Error('Ce morceau n’a pas de cover');
        return { jobId: enqueueItem(pack, item, track).id };
      },
    };
    ctx.services.provide(INSTAGRAM_PACK_SERVICE, service);

    // Reels made by v0.5 (one per render, before the packs).
    const requireLegacy = (params: unknown): LegacyReelRow => {
      const row = ctx.db
        .prepare(`SELECT * FROM ${legacyReels} WHERE id = ?`)
        .get(idParam(params)) as LegacyReelRow | undefined;
      if (!row) throw new HttpError(404, 'Reel introuvable');
      if (!existsSync(row.file_path)) {
        throw new HttpError(404, `Le fichier n’existe plus : ${row.file_path}`);
      }
      return row;
    };

    ctx.routes.post('/reels/:id/open', async (request) => {
      await ctx.files.open(requireLegacy(request.params).file_path);
      return { ok: true };
    });

    ctx.routes.post('/reels/:id/reveal', (request) => {
      ctx.files.reveal(requireLegacy(request.params).file_path);
      return { ok: true };
    });
  },
});
