import { copyFileSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestHub,
  loadModuleFolder,
  type DiscoveredModule,
  type TestHub,
} from '@hub/sdk/testing';
import type { ModuleContext, OutputRecord } from '@hub/sdk/backend';
import type { MusicLibraryService, TrackDto } from '../contract';
import { parseProbe } from '../backend/probe';
import { titleFromFileName, validateTrackUpdate } from '../backend/library';
import { createMediaFixtures } from './fixtures';

const MODULE_DIR = path.resolve(import.meta.dirname, '..');
const API = '/api/modules/music-library';

let media: ReturnType<typeof createMediaFixtures>;
let musicLibrary: DiscoveredModule;

/** A module consuming the service, as the video generators do. */
let library: MusicLibraryService;
let consumerCtx: ModuleContext;
const consumer: DiscoveredModule = {
  folder: 'consumer',
  manifest: {
    id: 'consumer',
    name: 'Consumer',
    description: '',
    version: '1.0.0',
    section: 'Tests',
    icon: 'x',
    dependsOn: { services: ['musicLibrary'] },
  },
  backend: {
    register: (ctx) => {
      library = ctx.services.get<MusicLibraryService>('musicLibrary');
      consumerCtx = ctx;
    },
  },
};

beforeAll(async () => {
  media = createMediaFixtures();
  musicLibrary = await loadModuleFolder(MODULE_DIR);
});

describe('music-library', () => {
  let hub: TestHub;

  beforeEach(async () => {
    hub = await createTestHub({ modules: [musicLibrary, consumer] });
  });
  afterEach(async () => {
    await hub.close();
  });

  const add = (body: object) =>
    hub.request<TrackDto & { error?: string }>('POST', `${API}/tracks`, body);

  it('adds a track: copies audio and cover, reads metadata with ffprobe', async () => {
    const { status, body } = await add({ audioPath: media.wav, coverPath: media.png });
    expect(status).toBe(200);
    expect(body.title).toBe('My First Track');
    expect(body.durationSec).toBeCloseTo(3, 1);
    expect(body.sampleRate).toBe(44100);
    expect(body.channels).toBe(2);
    expect(body.coverWidth).toBe(300);
    expect(body.originalAudioName).toBe('01_My_First_Track.wav');

    const trackDir = path.join(hub.dataDir, 'modules', 'music-library', 'tracks', String(body.id));
    const files = readdirSync(trackDir);
    expect(files).toContain('audio.wav');
    expect(files.some((f) => /^cover-\d+\.png$/.test(f))).toBe(true);
    expect(statSync(path.join(trackDir, 'audio.wav')).size).toBe(statSync(media.wav).size);

    // The UI can play the copy through a signed media URL.
    const audio = await hub.app.inject({ url: body.audioUrl, headers: { host: '127.0.0.1:4321' } });
    expect(audio.statusCode).toBe(200);
  });

  it('uses embedded tags (title, artist) when present', async () => {
    const { body } = await add({ audioPath: media.mp3 });
    expect(body.title).toBe('Tagged Title');
    expect(body.artist).toBe('Tag Artist');
    expect(body.coverUrl).toBeNull();
  });

  it('refuses unsupported or unreadable files with a clear message', async () => {
    const text = await add({ audioPath: media.text });
    expect(text.status).toBe(400);
    expect(text.body.error).toMatch(/WAV, MP3 ou FLAC/);

    const fake = await add({ audioPath: media.notAudio });
    expect(fake.status).toBe(400);
    expect(fake.body.error).toMatch(/illisible/);

    const badCover = await add({ audioPath: media.wav, coverPath: media.text });
    expect(badCover.status).toBe(400);
    expect((await hub.request<TrackDto[]>('GET', `${API}/tracks`)).body).toEqual([]);
  });

  it('keeps working when the original file is moved or deleted', async () => {
    const original = path.join(media.dir, 'temporary.wav');
    copyFileSync(media.wav, original);
    const { body } = await add({ audioPath: original });
    rmSync(original);
    const audio = await hub.app.inject({ url: body.audioUrl, headers: { host: '127.0.0.1:4321' } });
    expect(audio.statusCode).toBe(200);
  });

  it('edits metadata, with the default artist setting as fallback', async () => {
    const { body: track } = await add({ audioPath: media.wav });
    await hub.request('PUT', '/api/core/settings/music-library', { defaultArtist: 'Near' });
    expect((await hub.request<TrackDto>('GET', `${API}/tracks/${track.id}`)).body.artist).toBe(
      'Near',
    );

    const { status, body } = await hub.request<TrackDto>('PATCH', `${API}/tracks/${track.id}`, {
      title: '  Nouveau titre ',
      artist: 'Thomas',
      releaseDate: '2026-11-01',
      tags: ['#lofi', 'chill', 'lofi', ' '],
      notes: 'Mix v3',
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      title: 'Nouveau titre',
      artist: 'Thomas',
      artistOverride: 'Thomas',
      releaseDate: '2026-11-01',
      tags: ['lofi', 'chill'],
      notes: 'Mix v3',
    });

    const cleared = await hub.request<TrackDto>('PATCH', `${API}/tracks/${track.id}`, {
      artist: '',
    });
    expect(cleared.body.artist).toBe('Near');

    const invalid = await hub.request<{ error: string }>('PATCH', `${API}/tracks/${track.id}`, {
      releaseDate: '01/11/2026',
    });
    expect(invalid.status).toBe(400);
  });

  it('replaces the cover and removes the old copy', async () => {
    const { body: track } = await add({ audioPath: media.wav, coverPath: media.png });
    const { body } = await hub.request<TrackDto>('PUT', `${API}/tracks/${track.id}/cover`, {
      path: media.jpg,
    });
    expect(body.coverWidth).toBe(200);
    const trackDir = path.join(hub.dataDir, 'modules', 'music-library', 'tracks', String(track.id));
    expect(readdirSync(trackDir).filter((f) => f.startsWith('cover-'))).toHaveLength(1);
  });

  it('deletes a track and its library files', async () => {
    const { body: track } = await add({ audioPath: media.wav, coverPath: media.png });
    const trackDir = path.join(hub.dataDir, 'modules', 'music-library', 'tracks', String(track.id));
    expect((await hub.request('DELETE', `${API}/tracks/${track.id}`)).status).toBe(200);
    expect(existsSync(trackDir)).toBe(false);
    expect((await hub.request('GET', `${API}/tracks/${track.id}`)).status).toBe(404);
  });

  it('lists the files generated from a track by other modules (ctx.outputs)', async () => {
    const { body: track } = await add({ audioPath: media.wav });
    expect(library.getTrack(track.id)?.audioPath).toMatch(/audio\.wav$/);

    const video = path.join(consumerCtx.files.outputDir(), 'video.mp4');
    writeFileSync(video, 'fake video');
    consumerCtx.outputs.register({
      path: video,
      ref: 'video:1',
      label: 'Vidéo YouTube',
      subject: `music-library:track:${track.id}`,
    });
    const { body } = await hub.request<TrackDto & { outputs: OutputRecord[] }>(
      'GET',
      `${API}/tracks/${track.id}`,
    );
    expect(body.outputs).toEqual([
      expect.objectContaining({ label: 'Vidéo YouTube', fileName: 'video.mp4', exists: true }),
    ]);
  });

  it('deletes a track with or without its generated files', async () => {
    const make = async (name: string) => {
      const { body: track } = await add({ audioPath: media.wav });
      const file = path.join(consumerCtx.files.outputDir(), name);
      writeFileSync(file, 'x');
      consumerCtx.outputs.register({
        path: file,
        ref: name,
        label: 'Vidéo',
        subject: `music-library:track:${track.id}`,
      });
      return { track, file };
    };
    const kept = await make('kept.mp4');
    const removed = await make('removed.mp4');
    await hub.request('DELETE', `${API}/tracks/${kept.track.id}`);
    const { body } = await hub.request<{ deletedOutputs: number }>(
      'DELETE',
      `${API}/tracks/${removed.track.id}?outputs=1`,
    );
    expect(body.deletedOutputs).toBe(1);
    expect(existsSync(kept.file)).toBe(true);
    expect(existsSync(removed.file)).toBe(false);
  });
});

describe('project page and elements without project', () => {
  it('groups every element of a track with its status and « Inclure dans la sortie »', async () => {
    const hub = await createTestHub({ modules: [musicLibrary, consumer] });
    try {
      const { body: track } = await hub.request<TrackDto>('POST', `${API}/tracks`, {
        audioPath: media.wav,
      });
      const subject = `music-library:track:${track.id}`;
      for (const n of [1, 2]) {
        const file = path.join(consumerCtx.files.outputDir(), `reel${n}.mp4`);
        writeFileSync(file, 'x');
        consumerCtx.outputs.register({ path: file, ref: `reel:${n}`, label: `Reel ${n}`, subject });
      }
      library.registerProjectStatus({
        moduleId: 'consumer',
        get: () => [
          { moduleId: 'consumer', ref: 'reel:1', status: 'planned', detail: 'Short 1' },
          { moduleId: 'consumer', ref: 'reel:1', status: 'published' },
        ],
      });
      type Element = { ref: string; status: string; included: boolean };
      let project = await hub.request<Element[]>('GET', `${API}/tracks/${track.id}/project`);
      const byRef = (ref: string) => project.body.find((e) => e.ref === ref)!;
      // The most advanced status wins.
      expect(byRef('reel:1')).toMatchObject({ status: 'published', included: true });
      expect(byRef('reel:2')).toMatchObject({ status: 'generated', included: true });

      project = await hub.request<Element[]>('PUT', `${API}/tracks/${track.id}/project/included`, {
        moduleId: 'consumer',
        ref: 'reel:2',
        included: false,
      });
      expect(byRef('reel:2').included).toBe(false);
      expect(library.isIncluded('consumer', 'reel:2')).toBe(false);
      expect(library.isIncluded('consumer', 'reel:1')).toBe(true);
    } finally {
      await hub.close();
    }
  });

  it('lists elements of a deleted track as « Sans projet », to attach or delete', async () => {
    const hub = await createTestHub({ modules: [musicLibrary, consumer] });
    try {
      const add = async () =>
        (await hub.request<TrackDto>('POST', `${API}/tracks`, { audioPath: media.wav })).body;
      const gone = await add();
      const target = await add();
      const file = path.join(consumerCtx.files.outputDir(), 'orphan.mp4');
      writeFileSync(file, 'x');
      const record = consumerCtx.outputs.register({
        path: file,
        ref: 'video:7',
        label: 'Vidéo',
        subject: `music-library:track:${gone.id}`,
      });
      // Other projects (not tracks) are not ours: never listed.
      const other = path.join(consumerCtx.files.outputDir(), 'note.txt');
      writeFileSync(other, 'x');
      consumerCtx.outputs.register({
        path: other,
        ref: 'note:1',
        label: 'Note',
        subject: 'notes:1',
      });

      await hub.request('DELETE', `${API}/tracks/${gone.id}`);
      const orphans = await hub.request<OutputRecord[]>('GET', `${API}/orphans`);
      expect(orphans.body.map((o) => o.id)).toEqual([record.id]);

      const attached = await hub.request<{ attached: number }>('POST', `${API}/orphans/attach`, {
        ids: [record.id],
        trackId: target.id,
      });
      expect(attached.body.attached).toBe(1);
      expect((await hub.request<OutputRecord[]>('GET', `${API}/orphans`)).body).toEqual([]);
      const project = await hub.request<OutputRecord[]>(
        'GET',
        `${API}/tracks/${target.id}/project`,
      );
      expect(project.body.map((e) => e.id)).toEqual([record.id]);
      // Only elements without project can be attached this way.
      const refused = await hub.request('POST', `${API}/orphans/attach`, {
        ids: [record.id],
        trackId: gone.id,
      });
      expect(refused.status).toBe(404);
    } finally {
      await hub.close();
    }
  });
});

describe('track infos from other modules', () => {
  it('shows lines provided by other modules and ignores failing providers', async () => {
    const hub = await createTestHub({ modules: [musicLibrary, consumer] });
    try {
      const { body: track } = await hub.request<TrackDto>('POST', `${API}/tracks`, {
        audioPath: media.wav,
      });
      library.registerTrackInfo({
        moduleId: 'consumer',
        label: 'Pack',
        get: (id) => (id === track.id ? '2/5 publiés' : null),
      });
      library.registerTrackInfo({
        moduleId: 'consumer',
        label: 'Cassé',
        get: () => {
          throw new Error('boom');
        },
      });
      const { body } = await hub.request<{ infos: unknown[] }>('GET', `${API}/tracks/${track.id}`);
      expect(body.infos).toEqual([{ moduleId: 'consumer', label: 'Pack', value: '2/5 publiés' }]);
    } finally {
      await hub.close();
    }
  });
});

describe('helpers', () => {
  it('derives a clean title from the file name', () => {
    expect(titleFromFileName('C:/Music/03 - night_drive.wav')).toBe('night drive');
    expect(titleFromFileName('Beat 140bpm.mp3')).toBe('Beat 140bpm');
  });

  it('validates track updates', () => {
    expect(() => validateTrackUpdate({ title: '' })).toThrow(/obligatoire/);
    expect(validateTrackUpdate({ releaseDate: '' })).toEqual({ release_date: null });
  });

  it('parses ffprobe output (tags in any case)', () => {
    const probe = parseProbe(
      JSON.stringify({
        streams: [
          { codec_type: 'audio', codec_name: 'flac', sample_rate: '48000', channels: 2 },
          { codec_type: 'video', codec_name: 'mjpeg', width: 500, height: 500 },
        ],
        format: {
          format_name: 'flac',
          duration: '201.5',
          bit_rate: '900000',
          tags: { TITLE: 'Song' },
        },
      }),
    );
    expect(probe).toMatchObject({
      durationSec: 201.5,
      audio: { codec: 'flac', sampleRate: 48000, channels: 2 },
      image: { width: 500, height: 500 },
      tags: { title: 'Song' },
    });
  });
});
