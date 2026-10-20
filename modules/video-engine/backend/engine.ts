import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { PostRequest, RenderHandlers, RenderRequest, RenderResult } from '../contract';
import {
  buildAssScript,
  buildAudioArgs,
  buildBackgroundArgs,
  buildPostArgs,
  POST_SPEC,
  buildCardArgs,
  buildFontsConfig,
  buildRenderArgs,
  buildTruePeakArgs,
  FORMATS,
  INITIAL_CEILING_DB,
  parseTruePeak,
  scaleFormat,
  TRUE_PEAK_TARGET,
} from './commands';
import { detectOnsets, pickPulses, pulseExpression } from './beats';
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
  /** Frame size factor: 1 = full size (tests render smaller). */
  scale?: number;
  /** 'preview': fast encoding, no fades, no true-peak verification. Default 'final'. */
  quality?: 'final' | 'preview';
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

type Run = (args: string[], onTime?: (seconds: number) => void) => Promise<string>;

/**
 * Soundtrack (soundtrack.m4a in the work folder): encode, measure the true peak
 * of the AAC result, and lower the limiter ceiling until it is at most -1 dBTP
 * (`verify` false: one pass, for previews).
 */
async function renderSoundtrack(
  run: Run,
  params: {
    source: string;
    start: number;
    duration: number;
    fadeIn: number;
    fadeOut: number;
    bitrate: string;
    verify: boolean;
  },
): Promise<void> {
  let ceilingDb = INITIAL_CEILING_DB;
  for (let attempt = 1; ; attempt++) {
    await run(buildAudioArgs({ ...params, ceilingDb, output: 'soundtrack.m4a' }));
    if (!params.verify) return;
    const truePeak = parseTruePeak(await run(buildTruePeakArgs('soundtrack.m4a')));
    if (truePeak === null) throw new Error('Mesure du niveau crête impossible');
    // ebur128 prints one decimal: "-1.0" may be -0.96. A 0.1 dB margin guarantees ≤ -1 dBTP.
    if (truePeak <= TRUE_PEAK_TARGET - 0.1) return;
    if (attempt === 4) {
      throw new Error(`Niveau crête du son trop élevé (${truePeak} dBTP) malgré le limiteur`);
    }
    ceilingDb -= truePeak - TRUE_PEAK_TARGET + 0.4;
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
  const preview = options.quality === 'preview';
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
    const fadeIn = preview ? 0 : Math.min(options.fadeSeconds ?? 1.5, duration / 4);
    const fadeOut = preview ? 0 : Math.min(options.fadeSeconds ?? 2, duration / 4);

    // 1. Soundtrack: excerpt, fades, limiter, verified at -1 dBTP at most.
    handlers.onProgress?.(0, 'Préparation du son…');
    await renderSoundtrack(run, {
      source: options.audioPath,
      start,
      duration,
      fadeIn,
      fadeOut,
      bitrate: preview ? '128k' : format.encoding.audioBitrate,
      verify: !preview,
    });

    // Reels: the whole card breathes softly on the strong beats of the excerpt.
    let pulse: string | undefined;
    if (options.format === 'instagram') {
      handlers.onProgress?.(0, 'Détection du rythme…');
      const rate = 11025;
      const raw = await ffmpegStdout(
        env.ffmpeg,
        [
          ...['-v', 'error', '-ss', String(start), '-t', String(duration), '-i', options.audioPath],
          ...['-ac', '1', '-ar', String(rate), '-f', 's16le', '-'],
        ],
        handlers.signal,
      );
      const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
      pulse = pulseExpression(pickPulses(detectOnsets(samples, rate), duration));
    }

    // 2. Video, with the soundtrack copied as is.
    await run(
      buildRenderArgs({
        width,
        height,
        layout,
        start,
        duration,
        fadeIn,
        fadeOut,
        encoding: preview ? null : format.encoding,
        files: {
          background: 'background.png',
          card: 'card.png',
          ass: 'text.ass',
          fontsDir: 'fonts',
          audio: 'soundtrack.m4a',
          output: partial,
        },
        source: options.audioPath,
        pulse,
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

/** Renders the 4:5 post image (JPEG). */
export async function renderPostImage(
  env: EngineEnvironment,
  request: PostRequest,
): Promise<{ file: string; width: number; height: number }> {
  if (!request.coverPath || !existsSync(request.coverPath)) {
    throw new Error(`Fichier cover introuvable : ${request.coverPath || '(aucun)'}`);
  }
  const { width, height } = POST_SPEC;
  const work = path.join(env.workRoot, randomUUID());
  const fontsWork = path.join(work, 'fonts');
  mkdirSync(fontsWork, { recursive: true });
  const partial = `${request.outputPath}.part`;
  try {
    copyFileSync(path.join(env.fontsDir, FONT_FILE), path.join(fontsWork, FONT_FILE));
    writeFileSync(
      path.join(work, 'fonts.conf'),
      buildFontsConfig(fontsWork, path.join(work, 'fc-cache')),
    );
    writeFileSync(
      path.join(work, 'post.ass'),
      buildAssScript({
        width,
        height,
        title: request.title,
        artist: request.artist,
        layout: POST_SPEC.text,
      }),
    );
    const run = (args: string[]) =>
      runFfmpeg({
        ffmpeg: env.ffmpeg,
        args,
        cwd: work,
        env: { FONTCONFIG_FILE: path.join(work, 'fonts.conf') },
      });
    await run(
      buildBackgroundArgs(request.coverPath, 'background.png', width, height, POST_SPEC.blur),
    );
    await run(buildCardArgs(request.coverPath, 'card.png', POST_SPEC.cover));
    mkdirSync(path.dirname(request.outputPath), { recursive: true });
    await run(
      buildPostArgs({
        background: 'background.png',
        card: 'card.png',
        ass: 'post.ass',
        fontsDir: 'fonts',
        output: partial,
      }),
    );
    rmSync(request.outputPath, { force: true });
    renameSync(partial, request.outputPath);
    return { file: request.outputPath, width, height };
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Output of an FFmpeg command written to stdout (raw pixels, raw samples). */
function ffmpegStdout(ffmpeg: string, args: string[], signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpeg,
      args,
      { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, signal, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}
