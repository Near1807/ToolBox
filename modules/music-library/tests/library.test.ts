import { copyFileSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestHub,
  loadModuleFolder,
  type DiscoveredModule,
  type TestHub,
} from '@hub/sdk/testing';
import type { MusicLibraryService, TrackDto, TrackOutputDto } from '../contract';
import { parseProbe } from '../backend/probe';
import { titleFromFileName, validateTrackUpdate } from '../backend/library';
import { createMediaFixtures } from './fixtures';

const MODULE_DIR = path.resolve(import.meta.dirname, '..');
const API = '/api/modules/music-library';

let media: ReturnType<typeof createMediaFixtures>;
let musicLibrary: DiscoveredModule;

/** A module consuming the service, as the video generators do. */
let library: MusicLibraryService;
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
    register: (ctx) => void (library = ctx.services.get<MusicLibraryService>('musicLibrary')),
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

  it('provides the musicLibrary service and lists generated outputs', async () => {
    const { body: track } = await add({ audioPath: media.wav });
    expect(library.getTrack(track.id)?.audioPath).toMatch(/audio\.wav$/);

    const video = path.join(media.dir, 'video.mp4');
    writeFileSync(video, 'fake video');
    library.recordOutput(track.id, {
      moduleId: 'youtube-video',
      kind: 'youtube',
      label: 'Vidéo YouTube',
      filePath: video,
    });
    const { body } = await hub.request<TrackDto & { outputs: TrackOutputDto[] }>(
      'GET',
      `${API}/tracks/${track.id}`,
    );
    expect(body.outputs).toEqual([
      expect.objectContaining({ label: 'Vidéo YouTube', fileName: 'video.mp4', exists: true }),
    ]);
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
