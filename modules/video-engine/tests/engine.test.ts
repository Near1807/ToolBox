import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffprobeStatic from '@derhuerst/ffprobe-static';
import ffmpegStatic from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestHub,
  loadModuleFolder,
  type DiscoveredModule,
  type TestHub,
} from '@hub/sdk/testing';
import type { VideoEngineService } from '../contract';
import { renderPostImage, renderVideo, type EngineEnvironment } from '../backend/engine';
import { RenderCancelled } from '../backend/runner';
import { THUMBNAIL_SPEC } from '../backend/commands';
import { createRenderFixtures } from './fixtures';

const MODULE_DIR = path.resolve(import.meta.dirname, '..');
let fixtures: ReturnType<typeof createRenderFixtures>;
let env: EngineEnvironment;

function probe(file: string) {
  const json = execFileSync(ffprobeStatic!, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ]).toString();
  return JSON.parse(json) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      sample_aspect_ratio?: string;
      display_aspect_ratio?: string;
    }[];
    format: { duration: string };
  };
}

beforeAll(() => {
  fixtures = createRenderFixtures();
  env = {
    ffmpeg: ffmpegStatic!,
    ffprobe: ffprobeStatic!,
    fontsDir: path.join(MODULE_DIR, 'assets', 'fonts'),
    workRoot: mkdtempSync(path.join(tmpdir(), 'toolbox-work-')),
  };
});

describe('renderVideo (real FFmpeg)', () => {
  it('renders an excerpt with the expected size, codecs and duration', async () => {
    const outputPath = path.join(fixtures.dir, 'out', 'youtube.mp4');
    const progress: number[] = [];
    const result = await renderVideo(
      env,
      {
        format: 'youtube',
        audioPath: fixtures.audio,
        coverPath: fixtures.cover,
        title: 'Titre de test — été',
        artist: 'Thomas',
        start: 2,
        duration: 3,
        outputPath,
        scale: 0.25,
      },
      { onProgress: (fraction) => fraction !== null && progress.push(fraction) },
    );
    expect(result).toMatchObject({ file: outputPath, width: 480, height: 270, durationSec: 3 });
    const info = probe(outputPath);
    const video = info.streams.find((s) => s.codec_type === 'video')!;
    expect(video).toMatchObject({
      codec_name: 'h264',
      width: 480,
      height: 270,
      pix_fmt: 'yuv420p',
      sample_aspect_ratio: '1:1',
      display_aspect_ratio: '16:9',
    });
    expect(info.streams.find((s) => s.codec_type === 'audio')?.codec_name).toBe('aac');
    expect(Number(info.format.duration)).toBeCloseTo(3, 0);
    expect(progress.at(-1)).toBe(1);
    expect(existsSync(`${outputPath}.part`)).toBe(false);
  });

  it('keeps the audio under -1 dBTP even with a clipping source', async () => {
    const hot = path.join(fixtures.dir, 'hot.wav');
    execFileSync(ffmpegStatic!, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      "aevalsrc='sgn(sin(2*PI*997*t))':d=4:s=48000",
      '-ac',
      '2',
      hot,
    ]);
    const outputPath = path.join(fixtures.dir, 'out', 'hot.mp4');
    await renderVideo(env, {
      format: 'youtube',
      audioPath: hot,
      coverPath: fixtures.cover,
      title: 'Hot',
      artist: 'Thomas',
      outputPath,
      scale: 0.25,
    });
    // The ebur128 summary (on stderr) ends with "True peak: … Peak: -1.3 dBFS".
    const { stderr } = spawnSync(
      ffmpegStatic!,
      ['-hide_banner', '-nostats', '-i', outputPath, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
      { encoding: 'utf8' },
    );
    const truePeak = Number(/True peak:\s+Peak:\s+(-?[\d.]+) dBFS/.exec(stderr)?.[1]);
    expect(truePeak).toBeLessThanOrEqual(-1);
    expect(truePeak).toBeGreaterThan(-3);
  });

  it('renders the vertical Reel without stretching any cover', async () => {
    for (const cover of [fixtures.wideCover, fixtures.cover]) {
      const outputPath = path.join(fixtures.dir, 'out', `reel-${path.basename(cover)}.mp4`);
      const result = await renderVideo(env, {
        format: 'instagram',
        fadeSeconds: 0.5,
        audioPath: fixtures.audio,
        coverPath: cover,
        title: 'Reel',
        artist: 'Thomas',
        duration: 2,
        outputPath,
        scale: 0.25,
      });
      expect(result).toMatchObject({ width: 270, height: 480 });
      const video = probe(outputPath).streams.find((s) => s.codec_type === 'video')!;
      expect(video).toMatchObject({
        width: 270,
        height: 480,
        sample_aspect_ratio: '1:1',
        display_aspect_ratio: '9:16',
      });
    }
  });

  // The bug of v0.6: a non-square pixel shape (SAR 16:9) made players stretch the Reels.
  it('writes square pixels at full size: 1080×1920 (9:16) and 1920×1080 (16:9)', async () => {
    const cases = [
      { format: 'instagram', width: 1080, height: 1920, dar: '9:16' },
      { format: 'youtube', width: 1920, height: 1080, dar: '16:9' },
    ] as const;
    for (const { format, width, height, dar } of cases) {
      const outputPath = path.join(fixtures.dir, 'out', `full-${format}.mp4`);
      await renderVideo(env, {
        format,
        audioPath: fixtures.audio,
        coverPath: fixtures.wideCover,
        title: 'Plein format',
        artist: 'Thomas',
        duration: 1,
        outputPath,
        quality: 'preview',
      });
      const video = probe(outputPath).streams.find((s) => s.codec_type === 'video')!;
      expect(video).toMatchObject({
        width,
        height,
        sample_aspect_ratio: '1:1',
        display_aspect_ratio: dar,
      });
    }
  }, 120_000);

  it('can be cancelled: FFmpeg stops and no file is left', async () => {
    const outputPath = path.join(fixtures.dir, 'out', 'cancelled.mp4');
    const controller = new AbortController();
    const rendering = renderVideo(
      env,
      {
        format: 'youtube',
        audioPath: fixtures.audio,
        coverPath: fixtures.cover,
        title: 'Annulé',
        artist: 'Thomas',
        outputPath,
      },
      {
        signal: controller.signal,
        onProgress: (fraction) => {
          if (fraction !== null && fraction > 0) controller.abort();
        },
      },
    );
    await expect(rendering).rejects.toBeInstanceOf(RenderCancelled);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(`${outputPath}.part`)).toBe(false);
  });

  it('applies short fades when asked (Reels: 0.5 s)', async () => {
    const outputPath = path.join(fixtures.dir, 'out', 'short-fade.mp4');
    const result = await renderVideo(env, {
      format: 'instagram',
      audioPath: fixtures.audio,
      coverPath: fixtures.cover,
      title: 'Fade',
      artist: 'Thomas',
      duration: 3,
      fadeSeconds: 0.5,
      outputPath,
      scale: 0.25,
    });
    expect(result.durationSec).toBe(3);
  });

  it('renders the 4:5 post image as a JPEG', async () => {
    const outputPath = path.join(fixtures.dir, 'out', 'post.jpg');
    const result = await renderPostImage(env, {
      coverPath: fixtures.cover,
      title: 'Post',
      artist: 'Thomas',
      outputPath,
    });
    expect(result).toMatchObject({ width: 1080, height: 1350 });
    const image = probe(outputPath).streams[0]!;
    expect(image).toMatchObject({ codec_name: 'mjpeg', width: 1080, height: 1350 });
    expect(['1:1', undefined]).toContain(image.sample_aspect_ratio);
  });

  it('renders the YouTube thumbnail: 1280×720 JPEG under 2 MB', async () => {
    const outputPath = path.join(fixtures.dir, 'out', 'thumbnail.jpg');
    const result = await renderPostImage(
      env,
      { coverPath: fixtures.cover, title: 'Miniature', artist: 'Thomas', outputPath },
      THUMBNAIL_SPEC,
    );
    expect(result).toMatchObject({ width: 1280, height: 720 });
    const image = probe(outputPath).streams[0]!;
    expect(image).toMatchObject({ codec_name: 'mjpeg', width: 1280, height: 720 });
    expect(statSync(outputPath).size).toBeLessThan(2 * 1024 * 1024);
  });

  it('reports a missing cover clearly', async () => {
    await expect(
      renderVideo(env, {
        format: 'youtube',
        audioPath: fixtures.audio,
        coverPath: path.join(fixtures.dir, 'missing.png'),
        title: 'x',
        artist: 'y',
        outputPath: path.join(fixtures.dir, 'out', 'x.mp4'),
      }),
    ).rejects.toThrow(/cover introuvable/);
  });
});

describe('videoEngine service', () => {
  let hub: TestHub;
  let engine: VideoEngineService;

  beforeAll(async () => {
    const consumer: DiscoveredModule = {
      folder: 'consumer',
      manifest: {
        id: 'consumer',
        name: 'Consumer',
        description: '',
        version: '1.0.0',
        section: 'Tests',
        icon: 'x',
        dependsOn: { services: ['videoEngine'] },
      },
      backend: {
        register: (ctx) => void (engine = ctx.services.get<VideoEngineService>('videoEngine')),
      },
    };
    hub = await createTestHub({ modules: [await loadModuleFolder(MODULE_DIR), consumer] });
  });
  afterAll(async () => {
    await hub.close();
  });

  it('loads with its embedded font and exposes the formats', async () => {
    const { body } = await hub.request<{ id: string; status: string }[]>(
      'GET',
      '/api/core/modules',
    );
    expect(body.find((m) => m.id === 'video-engine')?.status).toBe('loaded');
    expect(engine.formats.youtube).toMatchObject({ width: 1920, height: 1080 });
    expect(await engine.probeDuration(fixtures.audio)).toBeCloseTo(10, 0);
  });

  it('makes a quick low-resolution preview', async () => {
    const result = await engine.preview({
      format: 'youtube',
      audioPath: fixtures.audio,
      coverPath: fixtures.cover,
      title: 'Aperçu',
      artist: 'Thomas',
      start: 3,
      previewSeconds: 2,
    });
    expect(result).toMatchObject({ width: 640, height: 360, durationSec: 2 });
    expect(
      result.file.startsWith(path.join(hub.dataDir, 'modules', 'video-engine', 'previews')),
    ).toBe(true);
  });

  it('runs full renders one at a time', async () => {
    const messages: string[] = [];
    const request = {
      format: 'youtube' as const,
      audioPath: fixtures.audio,
      coverPath: fixtures.cover,
      title: 'File',
      artist: 'Thomas',
      duration: 1,
    };
    const first = engine.render({ ...request, outputPath: path.join(fixtures.dir, 'q1.mp4') });
    const second = engine.render(
      { ...request, outputPath: path.join(fixtures.dir, 'q2.mp4') },
      { onProgress: (_f, message) => messages.push(message) },
    );
    await Promise.all([first, second]);
    expect(messages[0]).toMatch(/En attente du moteur/);
  });
});
