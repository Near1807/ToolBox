// Small helpers on media files for the modules' editors: video probe, filmstrip
// of a video (timeline), waveform peaks of a track.
import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { VideoInfo } from '../contract';
import { decodeExcerpt } from './engine';
import { runFfmpeg } from './runner';

const execFileAsync = promisify(execFile);

interface ProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

/** ffprobe JSON → duration and displayed size (a phone video rotated by 90° is portrait). */
export function parseVideoProbe(json: string): VideoInfo {
  const data = JSON.parse(json) as { streams?: ProbeStream[]; format?: { duration?: string } };
  const video = data.streams?.find((s) => s.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('Pas d’image vidéo dans ce fichier');
  const rotation = Math.abs(
    Number(
      video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
        video.tags?.rotate ??
        0,
    ),
  );
  const turned = rotation % 180 === 90;
  const durationSec = Number(data.format?.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0)
    throw new Error('Durée de la vidéo inconnue');
  return {
    durationSec,
    width: turned ? video.height : video.width,
    height: turned ? video.width : video.height,
    hasAudio: Boolean(data.streams?.some((s) => s.codec_type === 'audio')),
  };
}

export async function probeVideo(ffprobe: string, file: string): Promise<VideoInfo> {
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return parseVideoProbe(stdout);
  } catch (error) {
    const reason =
      error instanceof Error && !/Command failed/.test(error.message) ? ` (${error.message})` : '';
    throw new Error(`Vidéo illisible : « ${path.basename(file)} »${reason}`, { cause: error });
  }
}

/** `count` frames 160 px high, evenly spread (frame i at (i + 0.5) / count of the video). */
export async function filmstrip(
  ffmpeg: string,
  ffprobe: string,
  file: string,
  count: number,
  outputDir: string,
): Promise<string[]> {
  const { durationSec } = await probeVideo(ffprobe, file);
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  const n = Math.max(1, Math.min(40, Math.round(count)));
  const fps = (n / durationSec).toFixed(6);
  await runFfmpeg({
    ffmpeg,
    cwd: outputDir,
    args: [
      ...['-v', 'error', '-y', '-ss', String((durationSec / n / 2).toFixed(3)), '-i', file],
      ...['-vf', `fps=${fps},scale=-2:160`, '-frames:v', String(n), '-q:v', '5', 'frame-%02d.jpg'],
    ],
  });
  return readdirSync(outputDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => path.join(outputDir, f));
}

/** Peak per bar (0..1, normalised on the track) of a whole audio file. */
export async function waveform(
  ffmpeg: string,
  durationSec: number,
  file: string,
  bars: number,
): Promise<number[]> {
  const rate = 8000;
  const samples = await decodeExcerpt(ffmpeg, file, 0, durationSec + 1, rate);
  const n = Math.max(1, Math.round(bars));
  const per = Math.max(1, Math.floor(samples.length / n));
  const peaks = Array.from({ length: n }, (_, i) => {
    let max = 0;
    for (let j = i * per; j < Math.min(samples.length, (i + 1) * per); j++) {
      const v = Math.abs(samples[j]!);
      if (v > max) max = v;
    }
    return max;
  });
  const top = Math.max(1e-6, ...peaks);
  return peaks.map((p) => Number((p / top).toFixed(3)));
}
