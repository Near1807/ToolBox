// music-library: the shared track library of the Music section.
// Provides the "musicLibrary" service used by the video generators.
import { existsSync } from 'node:fs';
import { defineBackendModule, HttpError, type ModuleContext } from '@hub/sdk/backend';
import {
  MUSIC_LIBRARY_SERVICE,
  type MusicLibraryService,
  type Track,
  type TrackDto,
  type TrackOutput,
  type TrackInfoProvider,
  type ProjectStatus,
  type ProjectStatusEntry,
  type ProjectStatusProvider,
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

/** Subject of the files generated from a track, shared with the other modules (ctx.outputs). */
const trackSubject = (id: number) => `music-library:track:${id}`;

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
    {
      version: 2,
      description: 'project page: elements excluded from the release (« Inclure dans la sortie »)',
      up: `
        CREATE TABLE music_library__project_items (
          module_id TEXT NOT NULL,
          ref TEXT NOT NULL,
          track_id INTEGER NOT NULL,
          included INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (module_id, ref)
        );
      `,
    },
  ],

  register(ctx) {
    const library = new Library(ctx);
    const infoProviders = new Set<TrackInfoProvider>();
    const statusProviders = new Set<ProjectStatusProvider>();
    const projectItems = ctx.db.table('project_items');

    const isIncluded = (moduleId: string, ref: string) => {
      const row = ctx.db
        .prepare(`SELECT included FROM ${projectItems} WHERE module_id = ? AND ref = ?`)
        .get(moduleId, ref) as { included: number } | undefined;
      return row ? row.included === 1 : true;
    };

    const RANK: Record<ProjectStatus, number> = { planned: 1, scheduled: 2, published: 3 };
    /** Most advanced status of each element of a track, from every provider. */
    const statusesOf = (trackId: number) => {
      const statuses = new Map<string, ProjectStatusEntry>();
      for (const provider of statusProviders) {
        let entries: ProjectStatusEntry[] = [];
        try {
          entries = provider.get(trackId);
        } catch (error) {
          ctx.logger.warn(`Statuts indisponibles (${provider.moduleId})`, error);
        }
        for (const entry of entries) {
          const key = `${entry.moduleId}/${entry.ref}`;
          const current = statuses.get(key);
          if (!current || RANK[entry.status] > RANK[current.status]) statuses.set(key, entry);
        }
      }
      return statuses;
    };

    /** The project of a track: every generated element, with status and inclusion. */
    const projectOf = (trackId: number) => {
      const statuses = statusesOf(trackId);
      return ctx.outputs.bySubject(trackSubject(trackId)).map((record) => {
        const entry = statuses.get(`${record.moduleId}/${record.ref}`);
        return {
          ...record,
          status: !record.exists ? 'missing' : (entry?.status ?? 'generated'),
          statusDetail: entry?.detail ?? null,
          included: isIncluded(record.moduleId, record.ref),
        };
      });
    };

    /** A subject this library knows: a track that still exists (other subjects are not ours). */
    const knownSubject = (subject: string) => {
      const match = /^music-library:track:(\d+)$/.exec(subject);
      return !match || library.get(Number(match[1])) !== null;
    };

    const trackInfos = (trackId: number) =>
      [...infoProviders].flatMap((provider) => {
        try {
          const value = provider.get(trackId);
          return value === null
            ? []
            : [{ moduleId: provider.moduleId, label: provider.label, value }];
        } catch (error) {
          ctx.logger.warn(`Info « ${provider.label} » indisponible (${provider.moduleId})`, error);
          return [];
        }
      });

    const service: MusicLibraryService = {
      listTracks: () => library.list(),
      getTrack: (id) => library.get(id),
      recordOutput: (trackId, output) => library.recordOutput(trackId, output),
      listOutputs: (trackId) => library.listOutputs(trackId),
      registerTrackInfo: (provider) => {
        infoProviders.add(provider);
        return () => infoProviders.delete(provider);
      },
      registerProjectStatus: (provider) => {
        statusProviders.add(provider);
        return () => statusProviders.delete(provider);
      },
      isIncluded,
    };
    ctx.services.provide(MUSIC_LIBRARY_SERVICE, service);

    ctx.routes.get('/tracks', () => library.list().map((track) => toDto(ctx, track)));

    ctx.routes.get('/tracks/:id', (request) => {
      const track = library.require(idParam(request.params));
      return {
        ...toDto(ctx, track),
        // Files generated from this track by every module (ctx.outputs, checked on disk).
        outputs: ctx.outputs.bySubject(trackSubject(track.id)),
        infos: trackInfos(track.id),
      };
    });

    // Project page: everything generated from the track, grouped in the UI.
    ctx.routes.get('/tracks/:id/project', (request) => {
      const track = library.require(idParam(request.params));
      return projectOf(track.id);
    });

    // « Inclure dans la sortie » (the planner only proposes included elements).
    ctx.routes.put('/tracks/:id/project/included', (request) => {
      const track = library.require(idParam(request.params));
      const input = (request.body ?? {}) as {
        moduleId?: unknown;
        ref?: unknown;
        included?: unknown;
      };
      if (
        typeof input.moduleId !== 'string' ||
        typeof input.ref !== 'string' ||
        typeof input.included !== 'boolean'
      ) {
        throw new HttpError(400, 'Élément invalide');
      }
      ctx.db
        .prepare(
          `INSERT INTO ${projectItems} (module_id, ref, track_id, included, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (module_id, ref) DO UPDATE SET track_id = excluded.track_id,
             included = excluded.included, updated_at = excluded.updated_at`,
        )
        .run(input.moduleId, input.ref, track.id, input.included ? 1 : 0, new Date().toISOString());
      return projectOf(track.id);
    });

    // « Sans projet »: generated elements of any module whose track is unknown or deleted.
    ctx.routes.get('/orphans', () => ctx.outputs.orphans(knownSubject));

    ctx.routes.post('/orphans/attach', (request) => {
      const input = (request.body ?? {}) as { ids?: unknown; trackId?: unknown };
      const track = library.require(Number(input.trackId));
      const orphanIds = new Set(ctx.outputs.orphans(knownSubject).map((r) => r.id));
      const ids = Array.isArray(input.ids)
        ? input.ids.map(Number).filter((id) => orphanIds.has(id))
        : [];
      if (ids.length === 0) throw new HttpError(400, 'Aucun élément sans projet sélectionné');
      return { attached: ctx.outputs.attach(ids, trackSubject(track.id)) };
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

    // ?outputs=1: the files generated from the track (videos, Reels…) go to the Recycle Bin too.
    ctx.routes.delete('/tracks/:id', async (request) => {
      const id = idParam(request.params);
      library.require(id);
      let deletedOutputs = 0;
      if ((request.query as { outputs?: string }).outputs === '1') {
        deletedOutputs = await ctx.outputs.deleteBySubject(trackSubject(id));
      }
      await library.remove(id);
      return { ok: true, deletedOutputs };
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
