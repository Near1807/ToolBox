import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffprobePath from '@derhuerst/ffprobe-static';
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
import type { CustomReelsService } from '../contract';
import { clampExcerpt, suggestStarts } from '../backend/excerpts';

const MODULES = path.resolve(import.meta.dirname, '../..');
const API = '/api/modules/custom-reels';

/** Another module using the service, like the release planner. */
let service: CustomReelsService;
const consumer: DiscoveredModule = {
  folder: 'consumer',
  manifest: {
    id: 'consumer',
    name: 'Consumer',
    description: '',
    version: '1.0.0',
    section: 'Tests',
    icon: 'x',
    dependsOn: { services: ['customReels'] },
  },
  backend: {
    register: (ctx) => {
      service = ctx.services.get<CustomReelsService>('customReels');
    },
  },
};

interface Reel {
  id: number;
  position: number;
  startSec: number;
  durationSec: number;
  segments: { sourceId: number; start: number; end: number }[];
  loops: boolean;
  framing: string;
  effect: string;
  state: string;
  caption: string;
  captionCustom: boolean;
  fileName: string | null;
  publishedAt: string | null;
}
interface Track {
  sources: { id: number; name: string; durationSec: number; width: number; height: number }[];
  reels: Reel[];
}

describe('custom-reels (Reels from my videos)', () => {
  let hub: TestHub;
  let dir: string;
  let outputRoot: string;
  let trackId: number;
  let video: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'toolbox-cr-'));
    outputRoot = path.join(dir, 'Videos');
    const ffmpeg = (args: string[]) => execFileSync(ffmpegPath!, ['-v', 'error', '-y', ...args]);
    // 60 s track with a loud passage from 30 s to 50 s.
    ffmpeg([
      ...['-f', 'lavfi', '-i'],
      "aevalsrc='(0.05+0.8*between(t,30,50))*sin(2*PI*110*t)':d=60:s=44100",
      ...['-ac', '2', path.join(dir, 'song.wav')],
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
    // A 16:9 video of 6 s WITH its own sound (a 1 kHz tone that must never be heard).
    video = path.join(dir, 'clip.mp4');
    ffmpeg([
      ...['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=6'],
      ...['-f', 'lavfi', '-i', 'sine=f=1000:d=6'],
      ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video],
    ]);
    hub = await createTestHub({
      modules: await Promise.all(
        ['music-library', 'video-engine', 'custom-reels'].map((m) =>
          loadModuleFolder(path.join(MODULES, m)),
        ),
      ).then((modules) => [...modules, consumer]),
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
  }, 60_000);

  afterAll(async () => {
    await hub.close();
  });

  const track = async () => (await hub.request<Track>('GET', `${API}/tracks/${trackId}`)).body;

  it('imports videos (copied into ToolBox) and refuses other files', async () => {
    const other = path.join(dir, 'notes.txt');
    writeFileSync(other, 'x');
    const { body } = await hub.request<{ added: number[]; errors: string[] }>(
      'POST',
      `${API}/tracks/${trackId}/sources`,
      { paths: [video, other] },
    );
    expect(body.added).toHaveLength(1);
    expect(body.errors[0]).toMatch(/pas une vidéo/);
    const { sources } = await track();
    expect(sources[0]).toMatchObject({ name: 'clip.mp4', width: 640, height: 360 });
    expect(sources[0]!.durationSec).toBeCloseTo(6, 0);
  });

  it('creates 1 to 4 Reels on the loud passage, with a video each', async () => {
    expect((await hub.request('POST', `${API}/tracks/${trackId}/reels`, { count: 5 })).status).toBe(
      400,
    );
    await hub.request('POST', `${API}/tracks/${trackId}/reels`, { count: 1 });
    const [reel] = (await track()).reels;
    expect(reel).toMatchObject({ position: 1, durationSec: 28, effect: 'raw', framing: 'fit' });
    // Default excerpt on the loud part (30–50 s), inside the track.
    expect(reel!.startSec).toBeGreaterThanOrEqual(22);
    expect(reel!.startSec + 28).toBeLessThanOrEqual(60);
    // The 6 s video is shorter than the 28 s excerpt: it will loop, and the UI says so.
    expect(reel!.loops).toBe(true);
    expect(reel!.caption).toBe('Drop — Thomas\n\nNouveau son 🎧 lien en bio\n\n#lofi');
  });

  it('edits excerpt, passages, framing, effect and caption', async () => {
    const [reel] = (await track()).reels;
    const sourceId = (await track()).sources[0]!.id;
    const bad = await hub.request('PATCH', `${API}/reels/${reel!.id}`, { durationSec: 10 });
    expect(bad.status).toBe(400);
    const { body } = await hub.request<Reel>('PATCH', `${API}/reels/${reel!.id}`, {
      durationSec: 15,
      startSec: 100, // clamped inside the track
      segments: [
        { sourceId, start: 0, end: 4 },
        { sourceId, start: 4.5, end: 99 }, // clamped to the video
      ],
      framing: 'fill',
      focusX: 0.2,
      effect: 'rhythm',
      caption: 'Ma légende',
    });
    expect(body).toMatchObject({
      durationSec: 15,
      startSec: 45,
      framing: 'fill',
      effect: 'rhythm',
      caption: 'Ma légende',
      captionCustom: true,
    });
    expect(body.segments[1]!.end).toBeCloseTo(6, 0);
    expect(
      (await hub.request('PATCH', `${API}/reels/${reel!.id}`, { effect: 'disco' })).status,
    ).toBe(400);
  });

  it('renders a 1080×1920 Reel whose only sound is the track excerpt', async () => {
    const [reel] = (await track()).reels;
    const started = await hub.request<JobInfo>('POST', `${API}/reels/${reel!.id}/render`);
    expect(started.status).toBe(200);
    let job: JobInfo | undefined;
    for (let i = 0; i < 1800 && !['succeeded', 'failed'].includes(job?.status ?? ''); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = (await hub.request<JobInfo[]>('GET', '/api/core/jobs?module=custom-reels')).body[0];
    }
    expect(job?.error ?? null).toBeNull();
    const rendered = (await track()).reels[0]!;
    expect(rendered.state).toBe('ready');
    const file = path.join(outputRoot, 'custom-reels', 'Thomas - Drop', 'Drop - Reel perso 1.mp4');
    expect(existsSync(file)).toBe(true);
    const probe = JSON.parse(
      execFileSync(ffprobePath as unknown as string, [
        ...['-v', 'error', '-show_streams', '-of', 'json', file],
      ]).toString(),
    ) as { streams: Record<string, string | number>[] };
    const v = probe.streams.find((s) => s.codec_type === 'video')!;
    const a = probe.streams.filter((s) => s.codec_type === 'audio');
    expect([v.width, v.height, v.sample_aspect_ratio]).toEqual([1080, 1920, '1:1']);
    expect(a).toHaveLength(1);
    expect(Number(v.duration)).toBeCloseTo(15, 0);
    // The track is a 110 Hz tone; the video's own 1 kHz tone must be absent.
    const read = (filter: string) => {
      const { stderr } = spawnSync(ffmpegPath!, [
        ...['-hide_banner', '-i', file, '-af', `${filter},volumedetect`, '-f', 'null', '-'],
      ]);
      return Number(/mean_volume: (-?[\d.]+) dB/.exec(stderr.toString())![1]);
    };
    const at1k = read('bandpass=f=1000:w=100');
    const at110 = read('bandpass=f=110:w=40');
    expect(at110 - at1k).toBeGreaterThan(30);
    // Shared with the planner; attached to the track (project).
    expect(service.listReels(trackId)[0]).toMatchObject({ state: 'ready', exists: true });
    const outputs = await hub.request<{ ref: string; subject: string }[]>(
      'GET',
      `/api/core/outputs?module=custom-reels`,
    );
    expect(outputs.body[0]).toMatchObject({
      ref: `reel:${rendered.id}`,
      subject: `music-library:track:${trackId}`,
    });
  }, 480_000);

  it('marks a changed Reel « À régénérer », tracks publication, then deletes it', async () => {
    const [reel] = (await track()).reels;
    await hub.request('PATCH', `${API}/reels/${reel!.id}`, { effect: 'cine' });
    expect((await track()).reels[0]!.state).toBe('outdated');
    service.setPublished(reel!.id, true);
    expect((await track()).reels[0]!.publishedAt).not.toBeNull();
    // A video used by a Reel cannot be removed.
    const sourceId = (await track()).sources[0]!.id;
    expect((await hub.request('DELETE', `${API}/sources/${sourceId}`)).status).toBe(409);
    await hub.request('DELETE', `${API}/reels/${reel!.id}`);
    expect((await track()).reels).toEqual([]);
    expect((await hub.request('DELETE', `${API}/sources/${sourceId}`)).status).toBe(200);
  });
});

describe('default excerpts', () => {
  it('picks the loudest windows outside intro and outro, without overlap', () => {
    const peaks = Array.from({ length: 100 }, (_, i) => (i >= 50 && i < 70 ? 1 : 0.1));
    const starts = suggestStarts(peaks, 100, 15, 2);
    expect(starts[0]).toBeGreaterThanOrEqual(50);
    expect(starts[0]! + 15).toBeLessThanOrEqual(71);
    expect(Math.abs(starts[1]! - starts[0]!)).toBeGreaterThanOrEqual(15);
    expect(suggestStarts(peaks, 10, 15, 2)).toEqual([0, 0]);
    expect(clampExcerpt(95, 15, 100)).toBe(85);
  });
});
