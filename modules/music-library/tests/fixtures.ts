import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

/** Generates small real media files with FFmpeg (no binary fixtures in the repo). */
export function createMediaFixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), 'toolbox-media-'));
  const ffmpeg = (args: string[]) => execFileSync(ffmpegPath!, ['-v', 'error', '-y', ...args]);

  const wav = path.join(dir, '01_My_First_Track.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'sine=f=220:d=3', '-ac', '2', '-ar', '44100', wav]);

  const mp3 = path.join(dir, 'tagged.mp3');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=f=330:d=2',
    '-metadata',
    'title=Tagged Title',
    '-metadata',
    'artist=Tag Artist',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    mp3,
  ]);

  const png = path.join(dir, 'cover.png');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x3355aa:s=300x300', '-frames:v', '1', png]);

  const jpg = path.join(dir, 'cover2.jpg');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0xaa3355:s=200x100', '-frames:v', '1', jpg]);

  const notAudio = path.join(dir, 'fake.wav');
  writeFileSync(notAudio, 'this is not audio');

  const text = path.join(dir, 'notes.txt');
  writeFileSync(text, 'hello');

  return { dir, wav, mp3, png, jpg, notAudio, text };
}
