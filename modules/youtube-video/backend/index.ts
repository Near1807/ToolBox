// youtube-video: a 16:9 video of a whole track, plus a ready-to-copy description.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineBackendModule, HttpError, requestBody, type ModuleContext } from '@hub/sdk/backend';
import type { MusicLibraryService, Track } from '../../music-library/contract';
import type { VideoEngineService } from '../../video-engine/contract';
import { fillTemplate, parseTags, toTemplate } from '@hub/sdk/texts';
import {
  buildDescription,
  buildHashtags,
  buildVideoTitle,
  templateValues,
  videoFileName,
  type DescriptionInput,
} from './description';
import {
  YOUTUBE_VIDEO_SERVICE,
  type YouTubeTexts,
  type YouTubeVideo,
  type YouTubeVideoService,
} from '../contract';

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
    {
      version: 2,
      description: 'texts of the video edited per track (null = template text)',
      up: `
        CREATE TABLE youtube_video__texts (
          track_id INTEGER PRIMARY KEY,
          title TEXT,
          description TEXT,
          tags TEXT,
          updated_at TEXT NOT NULL
        );
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

    const textsTable = ctx.db.table('texts');
    interface TextsRow {
      title: string | null;
      description: string | null;
      tags: string | null;
    }

    const descriptionInput = (track: Track): DescriptionInput => ({
      title: track.title,
      artist: track.artist,
      releaseDate: track.releaseDate,
      tags: track.tags,
      links: ctx.settings.get<string>('links') ?? '',
      hashtags: ctx.settings.get<string>('hashtags') ?? '',
    });

    /** Texts from the templates of the settings (built-in format when empty). */
    const templateTexts = (track: Track) => {
      const input = descriptionInput(track);
      const values = templateValues(input);
      const titleTemplate = (ctx.settings.get<string>('titleTemplate') ?? '').trim();
      const descriptionTemplate = (ctx.settings.get<string>('descriptionTemplate') ?? '').trim();
      return {
        videoTitle: titleTemplate ? fillTemplate(titleTemplate, values) : buildVideoTitle(input),
        description: descriptionTemplate
          ? fillTemplate(descriptionTemplate, values)
          : buildDescription(input),
        tags: buildHashtags(track.tags, input.hashtags).map((t) => t.slice(1)),
      };
    };

    /** Texts of the track's video: the edited ones, otherwise the template ones. */
    const texts = (track: Track): YouTubeTexts => {
      const defaults = templateTexts(track);
      const own = ctx.db
        .prepare(`SELECT title, description, tags FROM ${textsTable} WHERE track_id = ?`)
        .get(track.id) as TextsRow | undefined;
      const custom = Boolean(
        own && (own.title !== null || own.description !== null || own.tags !== null),
      );
      return {
        videoTitle: own?.title ?? defaults.videoTitle,
        description: own?.description ?? defaults.description,
        tags: own?.tags ? (JSON.parse(own.tags) as string[]) : defaults.tags,
        custom,
      };
    };

    /** Saves edited texts; a text equal to the template one is stored as « follow the template ». */
    const setTexts = (
      track: Track,
      change: { videoTitle?: string; description?: string; tags?: string[] } | null,
    ) => {
      if (change === null) {
        ctx.db.prepare(`DELETE FROM ${textsTable} WHERE track_id = ?`).run(track.id);
        return;
      }
      const defaults = templateTexts(track);
      const current = ctx.db
        .prepare(`SELECT title, description, tags FROM ${textsTable} WHERE track_id = ?`)
        .get(track.id) as TextsRow | undefined;
      const pick = (value: string | undefined, fallback: string, before: string | null) =>
        value === undefined ? before : value === fallback ? null : value;
      const tags =
        change.tags === undefined
          ? (current?.tags ?? null)
          : JSON.stringify(change.tags) === JSON.stringify(defaults.tags)
            ? null
            : JSON.stringify(change.tags);
      ctx.db
        .prepare(
          `INSERT INTO ${textsTable} (track_id, title, description, tags, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (track_id) DO UPDATE SET title = excluded.title,
             description = excluded.description, tags = excluded.tags, updated_at = excluded.updated_at`,
        )
        .run(
          track.id,
          pick(change.videoTitle, defaults.videoTitle, current?.title ?? null),
          pick(change.description, defaults.description, current?.description ?? null),
          tags,
          new Date().toISOString(),
        );
    };

    // Every video goes through ctx.outputs (deletion, missing files). Videos made
    // before v0.7 are registered at startup: idempotent, nothing is deleted.
    const subject = (trackId: number) => `music-library:track:${trackId}`;
    const registerVideo = (row: VideoRow) =>
      ctx.outputs.register({
        path: row.file_path,
        ref: `video:${row.id}`,
        parent: `track:${row.track_id}`,
        subject: subject(row.track_id),
        label: 'Vidéo YouTube',
        kind: 'video',
        createdAt: row.created_at,
      });
    for (const row of ctx.db.prepare(`SELECT * FROM ${videos}`).all() as VideoRow[]) {
      registerVideo(row);
    }
    // Deleted (Recycle Bin) or removed from the list: the video row goes too.
    ctx.outputs.onRemoved((records) => {
      const remove = ctx.db.prepare(`DELETE FROM ${videos} WHERE id = ?`);
      for (const record of records) {
        const id = Number(record.ref.replace(/^video:/, ''));
        if (Number.isInteger(id)) remove.run(id);
      }
    });

    // « Sans projet » > Rattacher: the video row follows its file to the chosen track.
    ctx.outputs.onReattach((records, newSubject) => {
      const trackId = library.trackIdOf(newSubject);
      if (trackId === null) throw new HttpError(409, 'Une vidéo YouTube se rattache à un morceau');
      const move = ctx.db.prepare(`UPDATE ${videos} SET track_id = ? WHERE id = ?`);
      for (const record of records) {
        const id = Number(record.ref.replace(/^video:/, ''));
        const row = ctx.db.prepare(`SELECT * FROM ${videos} WHERE id = ?`).get(id) as
          VideoRow | undefined;
        if (!row) continue;
        move.run(trackId, row.id);
        registerVideo({ ...row, track_id: trackId });
      }
    });

    const listVideos = (trackId: number) => {
      const records = new Map(
        ctx.outputs.list({ parent: `track:${trackId}` }).map((r) => [r.ref, r]),
      );
      return (
        ctx.db
          .prepare(`SELECT * FROM ${videos} WHERE track_id = ? ORDER BY created_at DESC, id DESC`)
          .all(trackId) as VideoRow[]
      ).map((row) => {
        const record = records.get(`video:${row.id}`) ?? registerVideo(row);
        return {
          id: row.id,
          outputId: record.id,
          fileName: path.basename(row.file_path),
          createdAt: row.created_at,
          exists: record.exists,
          url: record.url,
          youtubeVideoId: row.youtube_video_id,
          youtubeUrl: row.youtube_video_id
            ? `https://www.youtube.com/watch?v=${row.youtube_video_id}`
            : null,
        };
      });
    };

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
        registerVideo(
          ctx.db
            .prepare(`SELECT * FROM ${videos} WHERE id = ?`)
            .get(Number(inserted.lastInsertRowid)) as VideoRow,
        );
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
      };
    });

    // Texts edited under the video (title, description, tags).
    ctx.routes.patch('/tracks/:id/texts', (request) => {
      const track = requireTrack(request.params);
      const body = requestBody(request);
      const text = (key: string, max: number) => {
        const value = body[key];
        if (value === undefined) return undefined;
        if (typeof value !== 'string' || value.length > max) {
          throw new HttpError(400, `Texte invalide : ${key}`);
        }
        return value;
      };
      const tags = body.tags;
      if (tags !== undefined && typeof tags !== 'string' && !Array.isArray(tags)) {
        throw new HttpError(400, 'Tags invalides');
      }
      setTexts(track, {
        videoTitle: text('videoTitle', 1000),
        description: text('description', 20_000),
        tags:
          tags === undefined
            ? undefined
            : parseTags(Array.isArray(tags) ? tags.map(String).join(',') : tags),
      });
      return texts(track);
    });

    ctx.routes.delete('/tracks/:id/texts', (request) => {
      const track = requireTrack(request.params);
      setTexts(track, null);
      return texts(track);
    });

    // « Enregistrer comme modèle par défaut »: the track's values become placeholders.
    ctx.routes.post('/tracks/:id/texts/template', (request) => {
      const track = requireTrack(request.params);
      const body = (request.body ?? {}) as { videoTitle?: unknown; description?: unknown };
      const values = templateValues(descriptionInput(track));
      if (typeof body.videoTitle === 'string' && body.videoTitle.trim()) {
        ctx.settings.set('titleTemplate', toTemplate(body.videoTitle, values));
      }
      if (typeof body.description === 'string' && body.description.trim()) {
        ctx.settings.set('descriptionTemplate', toTemplate(body.description, values));
      }
      // This track now follows the new template.
      setTexts(track, {
        videoTitle: body.videoTitle as string,
        description: body.description as string,
      });
      return texts(track);
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

    const enqueueRender = (track: Track) =>
      ctx.jobs.enqueue(
        'render',
        { trackId: track.id },
        { title: `Vidéo YouTube — ${track.title}` },
      );

    ctx.routes.post('/tracks/:id/render', (request) => {
      const track = requireTrack(request.params);
      requireCover(track);
      return enqueueRender(track);
    });

    // Service for the other modules (Planning de sortie: upload of the video).
    const toVideo = (row: VideoRow): YouTubeVideo => ({
      id: row.id,
      trackId: row.track_id,
      filePath: row.file_path,
      exists: existsSync(row.file_path),
      createdAt: row.created_at,
      youtubeVideoId: row.youtube_video_id,
      uploadedAt: row.uploaded_at,
    });
    const service: YouTubeVideoService = {
      listVideos: (trackId) =>
        (
          ctx.db
            .prepare(`SELECT * FROM ${videos} WHERE track_id = ? ORDER BY created_at DESC, id DESC`)
            .all(trackId) as VideoRow[]
        ).map(toVideo),
      getVideo: (id) => {
        const row = ctx.db.prepare(`SELECT * FROM ${videos} WHERE id = ?`).get(id) as
          VideoRow | undefined;
        return row ? toVideo(row) : null;
      },
      texts: (trackId) => {
        const track = library.getTrack(trackId);
        return track ? texts(track) : null;
      },
      setTexts: (trackId, change) => {
        const track = library.getTrack(trackId);
        if (!track) throw new Error('Morceau introuvable');
        setTexts(track, change);
        return texts(track);
      },
      render: (trackId) => {
        const track = library.getTrack(trackId);
        if (!track) throw new Error('Morceau introuvable');
        if (!track.coverPath) throw new Error('Ce morceau n’a pas de cover');
        return { jobId: enqueueRender(track).id };
      },
      setUploaded: (videoId, youtubeVideoId) => {
        ctx.db
          .prepare(`UPDATE ${videos} SET youtube_video_id = ?, uploaded_at = ? WHERE id = ?`)
          .run(youtubeVideoId, youtubeVideoId ? new Date().toISOString() : null, videoId);
      },
    };
    ctx.services.provide(YOUTUBE_VIDEO_SERVICE, service);

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
