import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RenderHandlers, RenderRequest, RenderResult } from '../contract';
import {
  buildAssScript,
  buildBackgroundArgs,
  buildCardArgs,
  buildFontsConfig,
  buildRenderArgs,
  FORMATS,
  scaleFormat,
} from './commands';
import { RenderCancelled, runFfmpeg } from './runner';

const execFileAsync = promisify(execFile);
export const FONT_FILE = 'Montserrat-SemiBold.ttf';

export interface EngineEnvironment {
  ffmpeg: string;
  ffprobe: string;
  /** modules/video-engine/assets/fonts */
  fontsDir: string;
  /** Scratch folder for intermediate files (one sub-folder per render). */
  workRoot: string;
}

export interface RenderOptions extends RenderRequest {
  outputPath: string;
  /** 1 = full quality; < 1 = smaller, faster preview encoding. */
  scale?: number;
}

export async function probeDuration(ffprobe: string, audioPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', audioPath],
      { timeout: 30_000 },
    );
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('durée inconnue');
    return duration;
  } catch {
    throw new Error(`Impossible de lire la durée de « ${path.basename(audioPath)} »`);
  }
}

/** Renders one video. Throws RenderCancelled when aborted (partial file removed). */
export async function renderVideo(
  env: EngineEnvironment,
  options: RenderOptions,
  handlers: RenderHandlers = {},
): Promise<RenderResult> {
  // Cancelled while waiting in the queue.
  if (handlers.signal?.aborted) throw new RenderCancelled();
  for (const [label, file] of [
    ['son', options.audioPath],
    ['cover', options.coverPath],
  ] as const) {
    if (!file || !existsSync(file))
      throw new Error(`Fichier ${label} introuvable : ${file || '(aucun)'}`);
  }

  const format = FORMATS[options.format];
  if (!format) throw new Error(`Format inconnu : ${options.format}`);
  const scale = options.scale ?? 1;
  const preview = scale < 1;
  const { width, height, layout } = scaleFormat(format, scale);

  const audioDuration = await probeDuration(env.ffprobe, options.audioPath);
  const start = Math.min(Math.max(0, options.start ?? 0), Math.max(0, audioDuration - 1));
  const duration = Math.min(options.duration ?? audioDuration - start, audioDuration - start);
  if (duration < 1) throw new Error('Extrait trop court (1 seconde minimum)');

  const work = path.join(env.workRoot, randomUUID());
  const fontsWork = path.join(work, 'fonts');
  mkdirSync(fontsWork, { recursive: true });
  const partial = `${options.outputPath}.part`;

  try {
    handlers.onProgress?.(0, 'Préparation des images…');
    copyFileSync(path.join(env.fontsDir, FONT_FILE), path.join(fontsWork, FONT_FILE));
    writeFileSync(
      path.join(work, 'fonts.conf'),
      buildFontsConfig(fontsWork, path.join(work, 'fc-cache')),
    );
    writeFileSync(
      path.join(work, 'text.ass'),
      buildAssScript({ width, height, title: options.title, artist: options.artist, layout }),
    );
    const run = (args: string[], onTime?: (s: number) => void) =>
      runFfmpeg({
        ffmpeg: env.ffmpeg,
        args,
        cwd: work,
        env: { FONTCONFIG_FILE: path.join(work, 'fonts.conf') },
        signal: handlers.signal,
        onTime,
      });

    await run(buildBackgroundArgs(options.coverPath, 'background.png', width, height, layout.blur));
    await run(buildCardArgs(options.coverPath, 'card.png', layout.cover));

    mkdirSync(path.dirname(options.outputPath), { recursive: true });
    const fade = preview ? 0 : Math.min(1.5, duration / 4);
    await run(
      buildRenderArgs({
        width,
        height,
        layout,
        start,
        duration,
        fadeIn: fade,
        fadeOut: preview ? 0 : Math.min(2, duration / 4),
        encoding: preview ? null : format.encoding,
        files: {
          background: 'background.png',
          card: 'card.png',
          ass: 'text.ass',
          fontsDir: 'fonts',
          output: partial,
        },
        audio: options.audioPath,
      }),
      (seconds) => {
        const fraction = Math.min(0.99, seconds / duration);
        handlers.onProgress?.(fraction, `Encodage… ${Math.round(fraction * 100)} %`);
      },
    );
    rmSync(options.outputPath, { force: true });
    renameSync(partial, options.outputPath);
    handlers.onProgress?.(1, 'Terminé');
    return { file: options.outputPath, durationSec: duration, width, height };
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
