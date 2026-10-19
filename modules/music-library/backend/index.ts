// music-library: the shared track library of the Music section.
// Provides the "musicLibrary" service used by the video generators.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineBackendModule, HttpError, type ModuleContext } from '@hub/sdk/backend';
import {
  MUSIC_LIBRARY_SERVICE,
  type MusicLibraryService,
  type Track,
  type TrackDto,
  type TrackOutput,
  type TrackOutputDto,
} from '../contract';
import { Library } from './library';

function toDto(ctx: ModuleContext, track: Track): TrackDto {
  const { audioPath, coverPath, ...rest } = track;
  return {
    ...rest,
    audioUrl: ctx.files.mediaUrl(audioPath),
    coverUrl: coverPath ? ctx.files.mediaUrl(coverPath) : null,
  };
}

function toOutputDto(ctx: ModuleContext, output: TrackOutput): TrackOutputDto {
  const { filePath, ...rest } = output;
  const exists = existsSync(filePath);
  let url: string | null = null;
  try {
    url = exists ? ctx.files.mediaUrl(filePath) : null;
  } catch {
    // File moved outside the output folder: still listed, not playable.
  }
  return { ...rest, fileName: path.basename(filePath), exists, url };
}

function idParam(params: unknown): number {
  const id = Number((params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Identifiant invalide');
  return id;
}

function stringField(body: unknown, key: string, required: boolean): string | null {
  const value = (body as Record<string, unknown> | undefined)?.[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `Champ « ${key} » obligatoire`);
    return null;
  }
  if (typeof value !== 'string') throw new HttpError(400, `Champ « ${key} » invalide`);
  return value;
}

export default defineBackendModule({
  migrations: [
    {
      version: 1,
      description: 'tracks and generated outputs',
      up: `
        CREATE TABLE music_library__tracks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          artist TEXT,
          release_date TEXT,
          notes TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          audio_file TEXT NOT NULL,
          audio_original_name TEXT NOT NULL,
          audio_format TEXT,
          duration_sec REAL,
          sample_rate INTEGER,
          channels INTEGER,
          bit_rate INTEGER,
          cover_file TEXT,
          cover_width INTEGER,
          cover_height INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE music_library__outputs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          track_id INTEGER NOT NULL REFERENCES music_library__tracks (id) ON DELETE CASCADE,
          module_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          label TEXT NOT NULL,
          file_path TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX music_library__outputs_track ON music_library__outputs (track_id);
      `,
    },
  ],

  register(ctx) {
    const library = new Library(ctx);

    const service: MusicLibraryService = {
      listTracks: () => library.list(),
      getTrack: (id) => library.get(id),
      recordOutput: (trackId, output) => library.recordOutput(trackId, output),
      listOutputs: (trackId) => library.listOutputs(trackId),
    };
    ctx.services.provide(MUSIC_LIBRARY_SERVICE, service);

    ctx.routes.get('/tracks', () => library.list().map((track) => toDto(ctx, track)));

    ctx.routes.get('/tracks/:id', (request) => {
      const track = library.require(idParam(request.params));
      return {
        ...toDto(ctx, track),
        outputs: library.listOutputs(track.id).map((o) => toOutputDto(ctx, o)),
      };
    });

    ctx.routes.post('/tracks', async (request) => {
      const audioPath = stringField(request.body, 'audioPath', true)!;
      const coverPath = stringField(request.body, 'coverPath', false);
      return toDto(ctx, await library.add(audioPath, coverPath));
    });

    ctx.routes.patch('/tracks/:id', (request) =>
      toDto(ctx, library.update(idParam(request.params), (request.body ?? {}) as object)),
    );

    ctx.routes.put('/tracks/:id/cover', async (request) => {
      const coverPath = stringField(request.body, 'path', true)!;
      return toDto(ctx, await library.setCover(idParam(request.params), coverPath));
    });

    ctx.routes.delete('/tracks/:id', async (request) => {
      await library.remove(idParam(request.params));
      return { ok: true };
    });

    const requireOutput = (params: unknown): TrackOutput => {
      const output = library.getOutput(idParam(params));
      if (!output) throw new HttpError(404, 'Fichier introuvable');
      if (!existsSync(output.filePath)) {
        throw new HttpError(404, `Le fichier n’existe plus : ${output.filePath}`);
      }
      return output;
    };

    ctx.routes.post('/outputs/:id/open', async (request) => {
      await ctx.files.open(requireOutput(request.params).filePath);
      return { ok: true };
    });

    ctx.routes.post('/outputs/:id/reveal', (request) => {
      ctx.files.reveal(requireOutput(request.params).filePath);
      return { ok: true };
    });

    ctx.routes.get('/summary', () => {
      const tracks = library.list();
      return {
        count: tracks.length,
        totalDurationSec: tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0),
        defaultArtist: (ctx.settings.get<string>('defaultArtist') ?? '').trim(),
      };
    });
  },
});
