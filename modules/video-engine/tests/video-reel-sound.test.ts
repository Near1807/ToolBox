// Sound modes of the video Reels, on real (small) renders: the Reel lasts
// exactly its duration, the sound is limited to -1.1 dBTP in every mode, the
// video's own sound is loudness-normalised, and « Morceau synchronisé » puts
// the master exactly where the track plays in the video.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffprobeStatic from '@derhuerst/ffprobe-static';
import ffmpegStatic from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineEnvironment } from '../backend/engine';
import { decodeExcerpt } from '../backend/engine';
import { matchWindow } from '../backend/sync';
import { renderVideoReel } from '../backend/video-reel';
import { testTrack, wavBuffer } from './sync-fixtures';

const MODULE_DIR = path.resolve(import.meta.dirname, '..');
const ffmpeg = ffmpegStatic!;

describe('sound of the video Reels (real renders)', () => {
  let dir: string;
  let env: EngineEnvironment;
  let master: string;
  let withTrack: string;
  let ownSound: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'toolbox-reel-sound-'));
    env = {
      ffmpeg,
      ffprobe: ffprobeStatic!,
      fontsDir: path.join(MODULE_DIR, 'assets', 'fonts'),
      workRoot: path.join(dir, 'work'),
    };
    const run = (args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args]);
    master = path.join(dir, 'master.wav');
    writeFileSync(master, wavBuffer(testTrack(40, 7, 44100), 44100));
    // A screen capture of the DAW: the track from 12.5 s, starting 1 s into the video.
    withTrack = path.join(dir, 'daw.mp4');
    run([
      ...['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=20'],
      ...['-ss', '12.5', '-t', '19', '-i', master],
      ...['-filter_complex', '[1:a]adelay=1000,volume=0.5[a]', '-map', '0:v', '-map', '[a]'],
      ...['-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', withTrack],
    ]);
    // A phone video with its own sound (a quiet 1 kHz tone).
    ownSound = path.join(dir, 'phone.mp4');
    run([
      ...['-f', 'lavfi', '-i', 'testsrc2=s=180x320:r=30:d=12'],
      ...['-f', 'lavfi', '-i', 'sine=f=1000:d=12', '-filter_complex', '[1:a]volume=0.05[a]'],
      ...['-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast'],
      ...['-c:a', 'aac', ownSound],
    ]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const render = (name: string, options: Partial<Parameters<typeof renderVideoReel>[1]>) =>
    renderVideoReel(env, {
      audioPath: master,
      start: 3,
      duration: 6,
      segments: [],
      framing: 'fit',
      effect: 'camera',
      intensity: 'max',
      title: 'Drop',
      artist: 'Thomas',
      overlayText: 'en cours de création…',
      scale: 0.25,
      outputPath: path.join(dir, `${name}.mp4`),
      ...options,
    });
  /** Frames of the video stream: exactly the Reel's duration × 30. */
  const durationOf = (file: string) =>
    Number(
      execFileSync(ffprobeStatic!, [
        ...['-v', 'error', '-select_streams', 'v:0', '-count_frames'],
        ...['-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file],
      ])
        .toString()
        .trim(),
    ) / 30;
  const loudness = (file: string) => {
    const { stderr } = spawnSync(ffmpeg, [
      ...['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    ]);
    const text = stderr.toString();
    return {
      integrated: Number(/I:\s+(-?[\d.]+) LUFS/.exec(text.split('Summary')[1]!)![1]),
      truePeak: Number(/True peak:\s+Peak:\s+(-?[\d.]+) dBFS/.exec(text)![1]),
    };
  };

  it('« Son de la vidéo »: the video’s sound, normalised, ≤ -1.1 dBTP, exactly the Reel’s duration', async () => {
    const result = await render('video', {
      audioMode: 'video',
      segments: [{ source: ownSound, start: 3, end: 9 }],
    });
    expect(durationOf(result.file)).toBe(6);
    const { integrated, truePeak } = loudness(result.file);
    expect(truePeak).toBeLessThanOrEqual(-1.1);
    // A tone at -26 dBFS brought to about -14 LUFS.
    expect(integrated).toBeGreaterThan(-18);
  }, 120_000);

  it('« Morceau synchronisé »: the master placed exactly where the track plays (≤ 10 ms)', async () => {
    // Passage 5 → 11 s of the video; the track plays there from 12.5 + 4 = 16.5 s.
    const result = await render('synced', {
      audioMode: 'synced',
      segments: [{ source: withTrack, start: 5, end: 11, syncOffset: 11.5 }],
    });
    expect(durationOf(result.file)).toBe(6);
    expect(loudness(result.file).truePeak).toBeLessThanOrEqual(-1.1);
    const track = await decodeExcerpt(ffmpeg, master, 0, 40, 8000);
    const sound = await decodeExcerpt(ffmpeg, result.file, 0.5, 5, 8000); // inside the fades
    // Reel time 0 ↔ track 16.5 s: track time = Reel time + 16.5.
    const sync = matchWindow(track, sound, 8000, 0.5);
    expect(Math.abs(sync.offset - 16.5)).toBeLessThanOrEqual(0.01);
  }, 120_000);

  it('« Son du morceau »: the excerpt, ≤ -1.1 dBTP, exactly the Reel’s duration', async () => {
    const result = await render('track', {
      audioMode: 'track',
      segments: [{ source: ownSound, start: 0, end: 6 }],
    });
    expect(durationOf(result.file)).toBe(6);
    expect(loudness(result.file).truePeak).toBeLessThanOrEqual(-1.1);
  }, 120_000);
});
