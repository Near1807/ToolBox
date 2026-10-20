import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JobInfo } from '@hub/sdk/backend';
import {
  createTestHost,
  createTestHub,
  loadModuleFolder,
  type DiscoveredModule,
  type TestHub,
} from '@hub/sdk/testing';
import type { YouTubeVideoService } from '../contract';

const MODULES = path.resolve(import.meta.dirname, '../..');
const API = '/api/modules/youtube-video';

/** Another module using the youtubeVideo service (like the release planner). */
const consumer: DiscoveredModule = {
  folder: 'consumer',
  manifest: {
    id: 'consumer',
    name: 'Consumer',
    description: 'test',
    version: '1.0.0',
    section: 'Tests',
    icon: '🧪',
    dependsOn: { modules: ['youtube-video'], services: ['youtubeVideo'] },
  },
  backend: {
    register(ctx) {
      const videos = ctx.services.get<YouTubeVideoService>('youtubeVideo');
      ctx.routes.get('/tracks/:id', (request) => {
        const id = Number((request.params as { id: string }).id);
        return { videos: videos.listVideos(id), texts: videos.texts(id) };
      });
      ctx.routes.post('/videos/:id/uploaded', (request) => {
        videos.setUploaded(Number((request.params as { id: string }).id), 'abc123');
        return { ok: true };
      });
    },
  },
};

describe('youtube-video', () => {
  let hub: TestHub;
  let outputRoot: string;
  let trackId: number;
  let trackWithoutCover: number;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'toolbox-yt-'));
    outputRoot = path.join(dir, 'Videos');
    const ffmpeg = (args: string[]) => execFileSync(ffmpegPath!, ['-v', 'error', '-y', ...args]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=f=110:d=3', '-ac', '2', path.join(dir, 'song.wav')]);
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=400x400',
      '-frames:v',
      '1',
      path.join(dir, 'cover.png'),
    ]);

    hub = await createTestHub({
      modules: await Promise.all(
        ['music-library', 'video-engine', 'youtube-video'].map((m) =>
          loadModuleFolder(path.join(MODULES, m)),
        ),
      ).then((modules) => [...modules, consumer]),
      host: createTestHost({ getDefaultOutputRoot: () => outputRoot }),
    });
    const add = (body: object) =>
      hub.request<{ id: number }>('POST', '/api/modules/music-library/tracks', body);
    trackId = (
      await add({ audioPath: path.join(dir, 'song.wav'), coverPath: path.join(dir, 'cover.png') })
    ).body.id;
    trackWithoutCover = (await add({ audioPath: path.join(dir, 'song.wav') })).body.id;
    await hub.request('PATCH', `/api/modules/music-library/tracks/${trackId}`, {
      title: 'Night Drive',
      artist: 'Thomas',
      tags: ['lofi'],
    });
  }, 60_000);

  afterAll(async () => {
    await hub.close();
  });

  it('loads after its dependencies', async () => {
    const { body } = await hub.request<{ id: string; status: string }[]>(
      'GET',
      '/api/core/modules',
    );
    expect(body.map((m) => [m.id, m.status])).toEqual(
      expect.arrayContaining([
        ['music-library', 'loaded'],
        ['video-engine', 'loaded'],
        ['youtube-video', 'loaded'],
      ]),
    );
  });

  it('shows the track with its ready-to-copy texts', async () => {
    const { body } = await hub.request<{ videoTitle: string; description: string }>(
      'GET',
      `${API}/tracks/${trackId}`,
    );
    expect(body.videoTitle).toBe('Thomas - Night Drive');
    expect(body.description).toContain('#lofi');
  });

  it('refuses a track without cover with a clear message', async () => {
    const { status, body } = await hub.request<{ error: string }>(
      'POST',
      `${API}/tracks/${trackWithoutCover}/render`,
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/cover/);
  });

  it('makes a preview', async () => {
    const { status, body } = await hub.request<{ url: string }>(
      'POST',
      `${API}/tracks/${trackId}/preview`,
    );
    expect(status).toBe(200);
    expect(body.url).toMatch(/^\/api\/media\//);
  });

  it('renders the full video as a job and records it in the library', async () => {
    const { body: job } = await hub.request<JobInfo>('POST', `${API}/tracks/${trackId}/render`);
    let done: JobInfo | undefined;
    for (let i = 0; i < 600 && !done; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const { body: jobs } = await hub.request<JobInfo[]>(
        'GET',
        '/api/core/jobs?module=youtube-video',
      );
      done = jobs.find((j) => j.id === job.id && ['succeeded', 'failed'].includes(j.status));
    }
    expect(done?.status).toBe('succeeded');

    const file = path.join(outputRoot, 'youtube-video', 'Thomas - Night Drive (YouTube).mp4');
    expect(existsSync(file)).toBe(true);

    const { body: track } = await hub.request<{ outputs: { label: string; fileName: string }[] }>(
      'GET',
      `/api/modules/music-library/tracks/${trackId}`,
    );
    expect(track.outputs).toEqual([
      expect.objectContaining({
        label: 'Vidéo YouTube',
        fileName: 'Thomas - Night Drive (YouTube).mp4',
      }),
    ]);
    const { body: detail } = await hub.request<{ videos: unknown[] }>(
      'GET',
      `${API}/tracks/${trackId}`,
    );
    expect(detail.videos).toHaveLength(1);
  });

  it('shares its videos with other modules (service youtubeVideo)', async () => {
    const shared = await hub.request<{
      videos: { id: number; exists: boolean; youtubeVideoId: string | null }[];
      texts: { videoTitle: string; tags: string[] };
    }>('GET', `/api/modules/consumer/tracks/${trackId}`);
    expect(shared.body.videos).toHaveLength(1);
    expect(shared.body.videos[0]).toMatchObject({ exists: true, youtubeVideoId: null });
    expect(shared.body.texts).toMatchObject({ videoTitle: 'Thomas - Night Drive', tags: ['lofi'] });
    await hub.request('POST', `/api/modules/consumer/videos/${shared.body.videos[0]!.id}/uploaded`);
    const { body } = await hub.request<{ videos: { youtubeUrl: string | null }[] }>(
      'GET',
      `${API}/tracks/${trackId}`,
    );
    expect(body.videos[0]!.youtubeUrl).toBe('https://www.youtube.com/watch?v=abc123');
  });

  it('shows a video deleted outside the app as missing, and deletes from the app', async () => {
    interface Video {
      id: number;
      outputId: number;
      exists: boolean;
    }
    const file = path.join(outputRoot, 'youtube-video', 'Thomas - Night Drive (YouTube).mp4');
    const { body } = await hub.request<{ videos: Video[] }>('GET', `${API}/tracks/${trackId}`);
    const [video] = body.videos;
    expect(video!.exists).toBe(true);

    copyFileSync(file, `${file}.bak`);
    rmSync(file);
    const missing = await hub.request<{ videos: Video[] }>('GET', `${API}/tracks/${trackId}`);
    expect(missing.body.videos[0]!.exists).toBe(false);
    copyFileSync(`${file}.bak`, file);

    await hub.request('POST', '/api/core/outputs/delete', { ids: [video!.outputId] });
    expect(existsSync(file)).toBe(false);
    const after = await hub.request<{ videos: Video[] }>('GET', `${API}/tracks/${trackId}`);
    expect(after.body.videos).toEqual([]);
  });
});
