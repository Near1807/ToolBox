// instagram-video: a vertical 9:16 excerpt (Reel / YouTube Short) with a caption.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineBackendModule, HttpError, type ModuleContext } from '@hub/sdk/backend';
import type { MusicLibraryService, Track } from '../../music-library/contract';
import type { VideoEngineService } from '../../video-engine/contract';
import {
  analyzeFile,
  clampExcerpt,
  downsamplePeaks,
  suggestStart,
  type AudioAnalysis,
} from './analysis';
import { buildCaption, reelFileName } from './caption';

const FORMAT = 'instagram' as const;
const MIN_DURATION = 15;
const MAX_DURATION = 90;
const WAVEFORM_BARS = 400;

interface ReelRow {
  id: number;
  track_id: number;
  file_path: string;
  start_sec: number;
  duration_sec: number;
  created_at: string;
}

interface ExcerptBody {
  start?: unknown;
  duration?: unknown;
}

function uniquePath(file: string): string {
  if (!existsSync(file)) return file;
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length);
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
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
  ],

  register(ctx: ModuleContext) {
    const library = ctx.services.get<MusicLibraryService>('musicLibrary');
    const engine = ctx.services.get<VideoEngineService>('videoEngine');
    const reels = ctx.db.table('reels');

    const defaultDuration = () => ctx.settings.get<number>('defaultDuration') ?? 30;

    const requireTrack = (params: unknown): Track => {
      const id = Number((params as { id?: string }).id);
      const track = Number.isInteger(id) ? library.getTrack(id) : null;
      if (!track) throw new HttpError(404, 'Morceau introuvable');
      return track;
    };

    const requireCover = (track: Track): string => {
      if (!track.coverPath) {
        throw new HttpError(400, 'Ce morceau n’a pas de cover : ajoute-la dans la Bibliothèque');
      }
      return track.coverPath;
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

    /** Validates the requested excerpt and fits it inside the track. */
    const excerpt = (track: Track, body: ExcerptBody) => {
      const duration = Number(body.duration ?? defaultDuration());
      const start = Number(body.start ?? 0);
      if (!Number.isFinite(duration) || duration < MIN_DURATION || duration > MAX_DURATION) {
        throw new HttpError(
          400,
          `Durée de l’extrait : entre ${MIN_DURATION} et ${MAX_DURATION} secondes`,
        );
      }
      if (!Number.isFinite(start) || start < 0)
        throw new HttpError(400, 'Point de départ invalide');
      return clampExcerpt(start, duration, track.durationSec ?? duration);
    };

    const caption = (track: Track) =>
      buildCaption({
        title: track.title,
        artist: track.artist,
        tags: track.tags,
        callToAction: ctx.settings.get<string>('callToAction') ?? '',
        hashtags: ctx.settings.get<string>('hashtags') ?? '',
      });

    const listReels = (trackId: number) =>
      (
        ctx.db
          .prepare(`SELECT * FROM ${reels} WHERE track_id = ? ORDER BY created_at DESC, id DESC`)
          .all(trackId) as ReelRow[]
      ).map((row) => {
        const exists = existsSync(row.file_path);
        return {
          id: row.id,
          fileName: path.basename(row.file_path),
          startSec: row.start_sec,
          durationSec: row.duration_sec,
          createdAt: row.created_at,
          exists,
          url: exists ? ctx.files.mediaUrl(row.file_path) : null,
        };
      });

    const requireReel = (params: unknown): ReelRow => {
      const row = ctx.db
        .prepare(`SELECT * FROM ${reels} WHERE id = ?`)
        .get(Number((params as { id?: string }).id)) as ReelRow | undefined;
      if (!row) throw new HttpError(404, 'Reel introuvable');
      if (!existsSync(row.file_path))
        throw new HttpError(404, `Le fichier n’existe plus : ${row.file_path}`);
      return row;
    };

    ctx.jobs.define<
      { trackId: number; start: number; duration: number },
      { reelId: number; file: string }
    >('render', async (job) => {
      const track = library.getTrack(job.input.trackId);
      if (!track) throw new Error('Morceau introuvable (supprimé entre-temps ?)');
      const coverPath = requireCover(track);
      const outputPath = uniquePath(path.join(ctx.files.outputDir(), reelFileName(track)));
      const result = await engine.render(
        {
          format: FORMAT,
          audioPath: track.audioPath,
          coverPath,
          title: track.title,
          artist: track.artist,
          start: job.input.start,
          duration: job.input.duration,
          outputPath,
        },
        { signal: job.signal, onProgress: (fraction, message) => job.progress(fraction, message) },
      );
      const inserted = ctx.db
        .prepare(
          `INSERT INTO ${reels} (track_id, file_path, start_sec, duration_sec, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(track.id, result.file, job.input.start, result.durationSec, new Date().toISOString());
      library.recordOutput(track.id, {
        moduleId: ctx.id,
        kind: 'instagram',
        label: 'Reel Instagram / Short',
        filePath: result.file,
      });
      ctx.events.emit('video.created', { trackId: track.id, file: result.file });
      return { reelId: Number(inserted.lastInsertRowid), file: result.file };
    });

    ctx.routes.get('/tracks', () =>
      library.listTracks().map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec,
        coverUrl: track.coverPath ? ctx.files.mediaUrl(track.coverPath) : null,
      })),
    );

    ctx.routes.get('/tracks/:id', (request) => {
      const track = requireTrack(request.params);
      return {
        id: track.id,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec,
        coverUrl: track.coverPath ? ctx.files.mediaUrl(track.coverPath) : null,
        audioUrl: ctx.files.mediaUrl(track.audioPath),
        defaultDuration: Math.min(
          defaultDuration(),
          Math.max(MIN_DURATION, Math.floor(track.durationSec ?? 0)),
        ),
        caption: caption(track),
        reels: listReels(track.id),
      };
    });

    // Waveform for the excerpt picker, plus the suggested start for the default duration.
    ctx.routes.get('/tracks/:id/waveform', async (request) => {
      const track = requireTrack(request.params);
      const analysis = await analyze(track);
      return {
        durationSec: analysis.durationSec,
        peaks: downsamplePeaks(analysis.peaks, WAVEFORM_BARS),
        suggestedStart: suggestStart(analysis, defaultDuration()),
      };
    });

    ctx.routes.post('/tracks/:id/suggest', async (request) => {
      const track = requireTrack(request.params);
      const { duration } = excerpt(track, (request.body ?? {}) as ExcerptBody);
      const analysis = await analyze(track);
      return clampExcerpt(suggestStart(analysis, duration), duration, analysis.durationSec);
    });

    ctx.routes.post('/tracks/:id/preview', async (request) => {
      const track = requireTrack(request.params);
      const coverPath = requireCover(track);
      const { start } = excerpt(track, (request.body ?? {}) as ExcerptBody);
      const result = await engine.preview({
        format: FORMAT,
        audioPath: track.audioPath,
        coverPath,
        title: track.title,
        artist: track.artist,
        start,
        previewSeconds: 6,
      });
      return { url: ctx.files.mediaUrl(result.file) };
    });

    ctx.routes.post('/tracks/:id/render', (request) => {
      const track = requireTrack(request.params);
      requireCover(track);
      const { start, duration } = excerpt(track, (request.body ?? {}) as ExcerptBody);
      return ctx.jobs.enqueue(
        'render',
        { trackId: track.id, start, duration },
        { title: `Reel Instagram — ${track.title}` },
      );
    });

    ctx.routes.post('/reels/:id/open', async (request) => {
      await ctx.files.open(requireReel(request.params).file_path);
      return { ok: true };
    });

    ctx.routes.post('/reels/:id/reveal', (request) => {
      ctx.files.reveal(requireReel(request.params).file_path);
      return { ok: true };
    });

    ctx.routes.post('/open-output-folder', async () => {
      await ctx.files.open(ctx.files.outputDir());
      return { ok: true };
    });
  },
});
