import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { afterAll, describe, expect, it } from 'vitest';
import { findTrackInVideo, matchWindow } from '../backend/sync';
import { degrade, testTrack, wavBuffer } from './sync-fixtures';

const RATE = 8000;

describe('« Morceau synchronisé »: where the track plays in the video', () => {
  const track = testTrack(90);

  it('finds a known offset (≤ 10 ms) in a degraded capture of a passage', () => {
    // The video's sound from 4 s: the track from 41.7 s, captured by a phone (25 s).
    const videoSound = degrade(track.slice(Math.round(41.7 * RATE), Math.round(66.7 * RATE)));
    // Passage 6 → 21 s of the video (15 s), searched with ± 1 s: 5 → 22 s, i.e. 1 → 18 of the capture.
    const sync = matchWindow(track, videoSound.slice(RATE * 1, RATE * 18), RATE, 5);
    // Track time = video time + offset: video 4 s ↔ track 41.7 s.
    expect(Math.abs(sync.offset - (41.7 - 4))).toBeLessThanOrEqual(0.01);
    expect(sync.reliable).toBe(true);
  });

  it('follows the passage when the track is played twice in the video', () => {
    // Video: track 10 → 30 s, then track 50 → 70 s.
    const video = new Float32Array(40 * RATE);
    video.set(degrade(track.slice(10 * RATE, 30 * RATE)), 0);
    video.set(degrade(track.slice(50 * RATE, 70 * RATE), 5), 20 * RATE);
    const first = matchWindow(track, video.slice(1 * RATE, 18 * RATE), RATE, 1);
    const second = matchWindow(track, video.slice(22 * RATE, 39 * RATE), RATE, 22);
    expect(Math.abs(first.offset - 10)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(second.offset - 30)).toBeLessThanOrEqual(0.01);
    expect(first.reliable && second.reliable).toBe(true);
  });

  it('says « not reliable » when the track is not in the video, or too short to tell', () => {
    for (const seed of [99, 123, 42]) {
      expect(matchWindow(track, degrade(testTrack(17, seed)), RATE, 0).reliable).toBe(false);
    }
    expect(matchWindow(track, degrade(new Float32Array(17 * RATE)), RATE, 0).reliable).toBe(false);
    expect(matchWindow(track, new Float32Array(RATE), RATE, 0).reliable).toBe(false);
  });
});

describe('findTrackInVideo on real files (AAC phone video)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'toolbox-sync-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const wav = (file: string, samples: Float32Array, rate: number) =>
    writeFileSync(file, wavBuffer(samples, rate));

  it('finds the offset (≤ 10 ms) and refuses a video without the track', async () => {
    const rate = 44100;
    const master = path.join(dir, 'master.wav');
    wav(master, testTrack(70, 7, rate), rate);
    const ffmpeg = (args: string[]) => execFileSync(ffmpegPath!, ['-v', 'error', '-y', ...args]);
    // Phone-like capture of the track from 33.25 s, starting 2 s into the video, AAC 64 kb/s.
    const phone = path.join(dir, 'phone.mp4');
    ffmpeg([
      ...['-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=30:d=22'],
      ...['-ss', '33.25', '-t', '20', '-i', master],
      ...['-f', 'lavfi', '-i', 'anoisesrc=d=22:c=pink:a=0.03'],
      '-filter_complex',
      '[1:a]adelay=2000,highpass=f=200,lowpass=f=4000,aecho=0.8:0.5:35:0.3,volume=0.15,' +
        'acompressor=threshold=0.05:ratio=6[m];[m][2:a]amix=inputs=2:normalize=0[a]',
      ...['-map', '0:v', '-map', '[a]', '-t', '22', '-c:v', 'libx264', '-preset', 'ultrafast'],
      ...['-c:a', 'aac', '-b:a', '64k', phone],
    ]);
    const sync = await findTrackInVideo(ffmpegPath!, master, phone, { start: 4, duration: 15 });
    // Track time = video time + offset: video 2 s ↔ track 33.25 s.
    expect(Math.abs(sync.offset - 31.25)).toBeLessThanOrEqual(0.01);
    expect(sync.reliable).toBe(true);

    const unrelated = path.join(dir, 'unrelated.mp4');
    const other = path.join(dir, 'other.wav');
    wav(other, testTrack(22, 1234, rate), rate);
    ffmpeg([
      ...['-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=30:d=22'],
      ...['-i', other, '-map', '0:v', '-map', '1:a', '-t', '22'],
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', unrelated],
    ]);
    const none = await findTrackInVideo(ffmpegPath!, master, unrelated, { start: 4, duration: 15 });
    expect(none.reliable).toBe(false);
    // Decoding and encoding take ~10 s alone and more when the whole suite runs at once.
  }, 180_000);
});
