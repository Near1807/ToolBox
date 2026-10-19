import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JobInfo } from '@hub/sdk/backend';
import { createTestHost, createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';

const MODULES = path.resolve(import.meta.dirname, '../..');
const API = '/api/modules/instagram-video';

describe('instagram-video', () => {
  let hub: TestHub;
  let outputRoot: string;
  let trackId: number;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'toolbox-ig-'));
    outputRoot = path.join(dir, 'Videos');
    const ffmpeg = (args: string[]) => execFileSync(ffmpegPath!, ['-v', 'error', '-y', ...args]);
    // 40 s: quiet, with a loud passage from 20 s to 32 s.
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      "aevalsrc='(0.05+0.85*between(t,20,32))*sin(2*PI*220*t)':d=40:s=44100",
      '-ac',
      '2',
      path.join(dir, 'song.wav'),
    ]);
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
        ['music-library', 'video-engine', 'instagram-video'].map((m) =>
          loadModuleFolder(path.join(MODULES, m)),
        ),
      ),
      host: createTestHost({ getDefaultOutputRoot: () => outputRoot }),
    });
    trackId = (
      await hub.request<{ id: number }>('POST', '/api/modules/music-library/tracks', {
        audioPath: path.join(dir, 'song.wav'),
        coverPath: path.join(dir, 'cover.png'),
      })
    ).body.id;
    await hub.request('PATCH', `/api/modules/music-library/tracks/${trackId}`, {
      title: 'Drop',
      artist: 'Thomas',
      tags: ['lofi'],
    });
  });

  afterAll(async () => {
    await hub.close();
  });

  it('shows the track with the default duration and a caption', async () => {
    const { body } = await hub.request<{ defaultDuration: number; caption: string }>(
      'GET',
      `${API}/tracks/${trackId}`,
    );
    expect(body.defaultDuration).toBe(30);
    expect(body.caption).toBe('Drop — Thomas\n\nVersion complète : lien en bio 🎧\n\n#lofi');
  });

  it('returns a waveform and suggests the loudest passage', async () => {
    const { body } = await hub.request<{ durationSec: number; peaks: number[] }>(
      'GET',
      `${API}/tracks/${trackId}/waveform`,
    );
    expect(body.durationSec).toBeCloseTo(40, 0);
    expect(body.peaks).toHaveLength(400);

    const suggestion = await hub.request<{ start: number; duration: number }>(
      'POST',
      `${API}/tracks/${trackId}/suggest`,
      {
        duration: 15,
      },
    );
    expect(suggestion.body.duration).toBe(15);
    // The 15 s window must cover as much of 20–32 s as possible.
    expect(suggestion.body.start).toBeGreaterThanOrEqual(17);
    expect(suggestion.body.start).toBeLessThanOrEqual(20);
  });

  it('validates the excerpt duration (15 to 90 s)', async () => {
    const { status, body } = await hub.request<{ error: string }>(
      'POST',
      `${API}/tracks/${trackId}/render`,
      {
        start: 0,
        duration: 5,
      },
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/entre 15 et 90/);
  });

  it(
    'renders a vertical excerpt as a job and records it in the library',
    { timeout: 180_000 },
    async () => {
      const { body: job } = await hub.request<JobInfo>('POST', `${API}/tracks/${trackId}/render`, {
        start: 30,
        duration: 15,
      });
      let done: JobInfo | undefined;
      for (let i = 0; i < 1500 && !done; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const { body: jobs } = await hub.request<JobInfo[]>(
          'GET',
          '/api/core/jobs?module=instagram-video',
        );
        done = jobs.find((j) => j.id === job.id && ['succeeded', 'failed'].includes(j.status));
      }
      expect(done?.error ?? null).toBeNull();
      expect(done?.status).toBe('succeeded');

      const file = path.join(outputRoot, 'instagram-video', 'Thomas - Drop (Reel).mp4');
      expect(existsSync(file)).toBe(true);

      const { body } = await hub.request<{ reels: { startSec: number; durationSec: number }[] }>(
        'GET',
        `${API}/tracks/${trackId}`,
      );
      // Start clamped so the excerpt stays inside the 40 s track: 25–40 s.
      expect(body.reels[0]).toMatchObject({ startSec: 25, durationSec: 15 });
    },
  );
});
