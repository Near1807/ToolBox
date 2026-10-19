// youtube-video: a 16:9 video of a whole track, plus a ready-to-copy description.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineBackendModule, HttpError, type ModuleContext } from '@hub/sdk/backend';
import type { MusicLibraryService, Track } from '../../music-library/contract';
import type { VideoEngineService } from '../../video-engine/contract';
import { buildDescription, buildHashtags, buildVideoTitle, videoFileName } from './description';
import { UPLOAD_AVAILABLE } from './upload';

const FORMAT = 'youtube' as const;

interface VideoRow {
  id: number;
  track_id: number;
  file_path: string;
  title: string;
  created_at: string;
  youtube_video_id: string | null;
  uploaded_at: string | null;
}

/** "file.mp4" → "file (2).mp4" while the name is taken. */
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
      description: 'generated videos (with columns ready for direct upload)',
      up: `
        CREATE TABLE youtube_video__videos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          track_id INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          youtube_video_id TEXT,
          uploaded_at TEXT
        );
        CREATE INDEX youtube_video__videos_track ON youtube_video__videos (track_id);
      `,
    },
  ],

  register(ctx: ModuleContext) {
    const library = ctx.services.get<MusicLibraryService>('musicLibrary');
    const engine = ctx.services.get<VideoEngineService>('videoEngine');
    const videos = ctx.db.table('videos');

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

    const texts = (track: Track) => {
      const input = {
        title: track.title,
        artist: track.artist,
        releaseDate: track.releaseDate,
        tags: track.tags,
        links: ctx.settings.get<string>('links') ?? '',
        hashtags: ctx.settings.get<string>('hashtags') ?? '',
      };
      return {
        videoTitle: buildVideoTitle(input),
        description: buildDescription(input),
        tags: buildHashtags(track.tags, input.hashtags).map((t) => t.slice(1)),
      };
    };

    const listVideos = (trackId: number) =>
      (
        ctx.db
          .prepare(`SELECT * FROM ${videos} WHERE track_id = ? ORDER BY created_at DESC, id DESC`)
          .all(trackId) as VideoRow[]
      ).map((row) => {
        const exists = existsSync(row.file_path);
        return {
          id: row.id,
          fileName: path.basename(row.file_path),
          createdAt: row.created_at,
          exists,
          url: exists ? ctx.files.mediaUrl(row.file_path) : null,
          youtubeVideoId: row.youtube_video_id,
        };
      });

    const requireVideo = (params: unknown): VideoRow => {
      const row = ctx.db
        .prepare(`SELECT * FROM ${videos} WHERE id = ?`)
        .get(Number((params as { id?: string }).id)) as VideoRow | undefined;
      if (!row) throw new HttpError(404, 'Vidéo introuvable');
      if (!existsSync(row.file_path))
        throw new HttpError(404, `Le fichier n’existe plus : ${row.file_path}`);
      return row;
    };

    // The render runs as a job of this module (progress + cancel in the Tâches page).
    ctx.jobs.define<{ trackId: number }, { videoId: number; file: string }>(
      'render',
      async (job) => {
        const track = library.getTrack(job.input.trackId);
        if (!track) throw new Error('Morceau introuvable (supprimé entre-temps ?)');
        const coverPath = requireCover(track);
        const outputPath = uniquePath(
          path.join(ctx.files.outputDir(), videoFileName(track, 'YouTube')),
        );

        const result = await engine.render(
          {
            format: FORMAT,
            audioPath: track.audioPath,
            coverPath,
            title: track.title,
            artist: track.artist,
            outputPath,
          },
          {
            signal: job.signal,
            onProgress: (fraction, message) => job.progress(fraction, message),
          },
        );

        const inserted = ctx.db
          .prepare(
            `INSERT INTO ${videos} (track_id, file_path, title, created_at) VALUES (?, ?, ?, ?)`,
          )
          .run(track.id, result.file, texts(track).videoTitle, new Date().toISOString());
        library.recordOutput(track.id, {
          moduleId: ctx.id,
          kind: 'youtube',
          label: 'Vidéo YouTube',
          filePath: result.file,
        });
        ctx.events.emit('video.created', { trackId: track.id, file: result.file });
        return { videoId: Number(inserted.lastInsertRowid), file: result.file };
      },
    );

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
        ...texts(track),
        videos: listVideos(track.id),
        uploadAvailable: UPLOAD_AVAILABLE,
      };
    });

    // A few low-resolution seconds from the middle of the track, before the full render.
    ctx.routes.post('/tracks/:id/preview', async (request) => {
      const track = requireTrack(request.params);
      const coverPath = requireCover(track);
      const duration = track.durationSec ?? 0;
      const result = await engine.preview({
        format: FORMAT,
        audioPath: track.audioPath,
        coverPath,
        title: track.title,
        artist: track.artist,
        start: Math.max(0, Math.min(duration * 0.3, duration - 6)),
        previewSeconds: 6,
      });
      return { url: ctx.files.mediaUrl(result.file) };
    });

    ctx.routes.post('/tracks/:id/render', (request) => {
      const track = requireTrack(request.params);
      requireCover(track);
      return ctx.jobs.enqueue(
        'render',
        { trackId: track.id },
        { title: `Vidéo YouTube — ${track.title}` },
      );
    });

    ctx.routes.post('/videos/:id/open', async (request) => {
      await ctx.files.open(requireVideo(request.params).file_path);
      return { ok: true };
    });

    ctx.routes.post('/videos/:id/reveal', (request) => {
      ctx.files.reveal(requireVideo(request.params).file_path);
      return { ok: true };
    });

    ctx.routes.post('/open-output-folder', async () => {
      await ctx.files.open(ctx.files.outputDir());
      return { ok: true };
    });
  },
});
