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
    // 80 s: quiet, with a loud passage from 40 s to 56 s.
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      "aevalsrc='(0.05+0.85*between(t,40,56))*sin(2*PI*220*t)':d=80:s=44100",
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

  const waitForJobs = async (count: number) => {
    for (let i = 0; i < 2400; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const { body: jobs } = await hub.request<JobInfo[]>(
        'GET',
        '/api/core/jobs?module=instagram-video',
      );
      const finished = jobs.filter((j) => ['succeeded', 'failed', 'canceled'].includes(j.status));
      if (finished.length >= count) return finished;
    }
    throw new Error('Rendus trop longs');
  };

  interface Item {
    id: number;
    kind: string;
    position: number;
    startSec: number | null;
    durationSec: number | null;
    state: string;
    caption: string;
    fileName: string | null;
    publishedAt: string | null;
  }
  interface Pack {
    id: number;
    clipDuration: number;
    caption: string;
    items: Item[];
    published: number;
    total: number;
  }
  let pack: Pack;

  it('shows the track without pack, and the waveform with the room for Reels', async () => {
    const { body } = await hub.request<{ defaultClip: number; pack: unknown }>(
      'GET',
      `${API}/tracks/${trackId}`,
    );
    expect(body.defaultClip).toBe(28);
    expect(body.pack).toBeNull();

    const wave = await hub.request<{
      durationSec: number;
      peaks: number[];
      capacity: { distinct: number; overlapping: number };
    }>('GET', `${API}/tracks/${trackId}/waveform?clip=28`);
    expect(wave.body.durationSec).toBeCloseTo(80, 0);
    expect(wave.body.peaks).toHaveLength(400);
    // 80 s minus intro and outro: 2 distinct excerpts of 28 s, 3 with a slight overlap.
    expect(wave.body.capacity).toEqual({ distinct: 2, overlapping: 3 });
  });

  it('validates the Reel duration', async () => {
    const { status, body } = await hub.request<{ error: string }>(
      'POST',
      `${API}/tracks/${trackId}/pack`,
      { clipDuration: 5 },
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/entre 15 et 60/);
  });

  it('creates a draft pack: post + Reels on the loudest passages, caption from the template', async () => {
    const { status, body } = await hub.request<Pack>('POST', `${API}/tracks/${trackId}/pack`, {
      clipDuration: 15,
      count: 2,
    });
    expect(status).toBe(200);
    pack = body;
    expect(pack.items.map((i) => [i.kind, i.position, i.state])).toEqual([
      ['post', 0, 'draft'],
      ['reel', 1, 'draft'],
      ['reel', 2, 'draft'],
    ]);
    // Reel 1 = the loud passage (40–56 s).
    expect(pack.items[1]!.startSec).toBeGreaterThanOrEqual(40);
    expect(pack.items[1]!.startSec! + 15).toBeLessThanOrEqual(56.5);
    expect(pack.caption).toBe('Drop — Thomas\n\nNouveau son 🎧 lien en bio\n\n#lofi');
    expect((await hub.request('POST', `${API}/tracks/${trackId}/pack`, {})).status).toBe(409);
  });

  it('edits the excerpt and the captions', async () => {
    const reel = pack.items[2]!;
    const moved = await hub.request<Item>('PATCH', `${API}/items/${reel.id}`, { startSec: 200 });
    // Clamped inside the 80 s track.
    expect(moved.body.startSec).toBe(65);
    await hub.request('PATCH', `${API}/items/${reel.id}`, { startSec: 10 });

    const { body } = await hub.request<Pack>('PATCH', `${API}/packs/${pack.id}`, {
      caption: 'Ma légende',
      perReelCaptions: true,
    });
    expect(body.items[1]!.caption).toBe('Ma légende');
    const own = await hub.request<Item>('PATCH', `${API}/items/${pack.items[1]!.id}`, {
      caption: 'Légende du Reel 1',
    });
    expect(own.body.caption).toBe('Légende du Reel 1');
  });

  it(
    'renders the pack (post + Reels) as jobs, then a single Reel again',
    { timeout: 300_000 },
    async () => {
      const { body } = await hub.request<{ queued: number }>(
        'POST',
        `${API}/packs/${pack.id}/render`,
      );
      expect(body.queued).toBe(3);
      const jobs = await waitForJobs(3);
      expect(jobs.map((j) => j.error)).toEqual([null, null, null]);

      const folder = path.join(outputRoot, 'instagram-video', 'Thomas - Drop');
      for (const name of ['Drop - Post.jpg', 'Drop - Reel 1.mp4', 'Drop - Reel 2.mp4']) {
        expect(existsSync(path.join(folder, name))).toBe(true);
      }
      const { body: track } = await hub.request<{ pack: Pack }>('GET', `${API}/tracks/${trackId}`);
      expect(track.pack.items.map((i) => i.state)).toEqual(['ready', 'ready', 'ready']);

      // Moving a rendered Reel marks it outdated; "Régénérer" renders only that one.
      const reel = track.pack.items[2]!;
      await hub.request('PATCH', `${API}/items/${reel.id}`, { startSec: 12 });
      const after = await hub.request<{ pack: Pack }>('GET', `${API}/tracks/${trackId}`);
      expect(after.body.pack.items[2]!.state).toBe('outdated');
      await hub.request('POST', `${API}/items/${reel.id}/render`);
      await waitForJobs(4);
      const final = await hub.request<{ pack: Pack }>('GET', `${API}/tracks/${trackId}`);
      expect(final.body.pack.items[2]).toMatchObject({
        state: 'ready',
        fileName: 'Drop - Reel 2.mp4',
      });
    },
  );

  it('tracks publication: checkbox, date, « À publier » and the library info', async () => {
    const toPublish = await hub.request<{ item: Item }[]>('GET', `${API}/to-publish`);
    expect(toPublish.body).toHaveLength(3);

    const post = pack.items[0]!;
    const checked = await hub.request<Item>('PATCH', `${API}/items/${post.id}`, {
      published: true,
    });
    expect(checked.body.publishedAt).not.toBeNull();
    const dated = await hub.request<Item>('PATCH', `${API}/items/${post.id}`, {
      publishedAt: '2026-10-01',
    });
    expect(dated.body.publishedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(
      (await hub.request('PATCH', `${API}/items/${post.id}`, { publishedAt: 'x' })).status,
    ).toBe(400);

    expect((await hub.request<unknown[]>('GET', `${API}/to-publish`)).body).toHaveLength(2);
    const { body: libraryTrack } = await hub.request<{ infos: { label: string; value: string }[] }>(
      'GET',
      `/api/modules/music-library/tracks/${trackId}`,
    );
    expect(libraryTrack.infos).toContainEqual(
      expect.objectContaining({ label: 'Pack Instagram', value: '1/3 publiés' }),
    );

    const unchecked = await hub.request<Item>('PATCH', `${API}/items/${post.id}`, {
      published: false,
    });
    expect(unchecked.body.publishedAt).toBeNull();
  });
});
