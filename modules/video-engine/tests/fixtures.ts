import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

/** A short music-like sound and a cover, generated with FFmpeg. */
export function createRenderFixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), 'toolbox-render-'));
  const ffmpeg = (args: string[]) => execFileSync(ffmpegPath!, ['-v', 'error', '-y', ...args]);
  const audio = path.join(dir, 'beat.wav');
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    "aevalsrc='0.8*sin(2*PI*(50+120*exp(-30*mod(t,0.5)))*t)*exp(-8*mod(t,0.5))':d=10:s=44100",
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=10:c=pink:a=0.1:r=44100',
    '-filter_complex',
    '[0][1]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo',
    audio,
  ]);
  const cover = path.join(dir, 'cover.png');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=600x600', '-frames:v', '1', cover]);
  return { dir, audio, cover };
}
