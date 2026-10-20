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
import {
  buildDustArgs,
  buildFillStillArgs,
  buildReelArgs,
  buildReelAss,
  buildScrimArgs,
  buildWideStillArgs,
  coverToFill,
  detailMap,
  detectOnsets,
  fillCrop,
  focusPoints,
  planCuts,
  planShots,
  REEL,
  REEL_STYLES,
} from './reel';
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
    if (truePeak <= TRUE_PEAK_TARGET) return;
    if (attempt === 4) {
      throw new Error(`Niveau crête du son trop élevé (${truePeak} dBTP) malgré le limiteur`);
    }
    ceilingDb -= truePeak - TRUE_PEAK_TARGET + 0.3;
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
  // Vertical videos are Reels: their own styles, without the spectrum.
  if (options.format === 'instagram') return renderReel(env, options, handlers);
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
        badge: request.badge,
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

async function probeImageSize(ffprobe: string, file: string): Promise<{ w: number; h: number }> {
  const { stdout } = await execFileAsync(ffprobe, [
    ...['-v', 'error', '-select_streams', 'v:0'],
    ...['-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
  ]);
  const [w, h] = stdout.trim().split(',').map(Number);
  if (!w || !h) throw new Error(`Image illisible : ${path.basename(file)}`);
  return { w, h };
}

const ANALYSIS_SIZE = 48;

/** Mean luminance (0..1) of a region of an image (fractions of its size). */
async function regionLuma(
  ffmpeg: string,
  file: string,
  region: { x: number; y: number; w: number; h: number },
): Promise<number> {
  const pixel = await ffmpegStdout(ffmpeg, [
    ...['-v', 'error', '-i', file],
    '-vf',
    `crop=iw*${region.w}:ih*${region.h}:iw*${region.x}:ih*${region.y},scale=1:1:flags=area,format=gray`,
    ...['-frames:v', '1', '-f', 'rawvideo', '-'],
  ]);
  return (pixel[0] ?? 0) / 255;
}

/**
 * Renders a vertical Reel in one of the four styles (see reel.ts): still images
 * prepared from the cover, camera moves, title and artist kept discreet, no
 * audio visualisation, video fade-out 0.5 s, sound limited to -1 dBTP.
 */
export async function renderReel(
  env: EngineEnvironment,
  options: RenderOptions,
  handlers: RenderHandlers = {},
): Promise<RenderResult> {
  const style = options.reelStyle ?? 'reveal';
  if (!REEL_STYLES.includes(style)) throw new Error(`Style de Reel inconnu : ${style}`);
  const format = FORMATS.instagram;
  const scale = options.scale ?? 1;
  const preview = options.quality === 'preview';
  const width = Math.max(2, Math.round((REEL.width * scale) / 2) * 2);
  const height = Math.max(2, Math.round((REEL.height * scale) / 2) * 2);
  const k = width / REEL.width;
  // Stills at 2–3× the frame: slow moves keep sub-pixel precision.
  const ss = style === 'cuts' || style === 'hook' ? 2 : 3;
  const sw = width * ss;
  const sh = height * ss;

  const audioDuration = await probeDuration(env.ffprobe, options.audioPath);
  const start = Math.min(Math.max(0, options.start ?? 0), Math.max(0, audioDuration - 1));
  const duration = Math.min(options.duration ?? audioDuration - start, audioDuration - start);
  if (duration < 1) throw new Error('Extrait trop court (1 seconde minimum)');

  const work = path.join(env.workRoot, randomUUID());
  const fontsWork = path.join(work, 'fonts');
  mkdirSync(fontsWork, { recursive: true });
  const partial = `${options.outputPath}.part`;
  const run: Run = (args, onTime) =>
    runFfmpeg({
      ffmpeg: env.ffmpeg,
      args,
      cwd: work,
      env: { FONTCONFIG_FILE: path.join(work, 'fonts.conf') },
      signal: handlers.signal,
      onTime,
    });

  try {
    handlers.onProgress?.(0, 'Analyse de la cover…');
    copyFileSync(path.join(env.fontsDir, FONT_FILE), path.join(fontsWork, FONT_FILE));
    writeFileSync(
      path.join(work, 'fonts.conf'),
      buildFontsConfig(fontsWork, path.join(work, 'fc-cache')),
    );

    // Where the details of the cover are: crop of the full-frame view, close-ups.
    const cover = await probeImageSize(env.ffprobe, options.coverPath);
    const gray = await ffmpegStdout(env.ffmpeg, [
      ...['-v', 'error', '-i', options.coverPath],
      '-vf',
      `scale=${ANALYSIS_SIZE}:${ANALYSIS_SIZE}:flags=area,format=gray`,
      ...['-frames:v', '1', '-f', 'rawvideo', '-'],
    ]);
    const map = detailMap(new Uint8Array(gray), ANALYSIS_SIZE);
    const crop = fillCrop(map, ANALYSIS_SIZE, cover.w / cover.h);
    const points = focusPoints(map, ANALYSIS_SIZE, 3);
    const details = points.map((p) => coverToFill(p, crop.window));

    // The cover in the wide view: its own ratio inside the card box.
    const box = REEL.card.size * k * ss;
    const aspect = cover.w / cover.h;
    const cw = aspect >= 1 ? box : box * aspect;
    const ch = aspect >= 1 ? box / aspect : box;
    const left = (sw - cw) / 2;
    const top = REEL.card.centerY * k * ss - ch / 2;
    // Start of « Révélation » (zoom 3): a detail, with the view entirely on the cover.
    const clampTo = (value: number, min: number, max: number) =>
      min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value));
    // Zoom 3 at least, more for a flat or narrow cover so that the first view is all cover.
    const revealZoom = Math.min(6, Math.max(3.2, (sw / cw) * 1.25, (sh / ch) * 1.25));
    // A margin, so that the start of the zoom-out still shows only the cover.
    const halfW = (sw / (2 * revealZoom)) * 1.15;
    const halfH = (sh / (2 * revealZoom)) * 1.15;
    const focus = points[0]!;
    const coverFocus = {
      x: clampTo(left + cw * focus.x, left + halfW, left + cw - halfW) / sw,
      y: clampTo(top + ch * focus.y, top + halfH, top + ch - halfH) / sh,
    };

    handlers.onProgress?.(0, 'Préparation des images…');
    const scaled = (n: number) => Math.max(1, Math.round(n * k * ss));
    await run(buildBackgroundArgs(options.coverPath, 'wash.png', sw, sh, scaled(90)));
    await run(
      buildCardArgs(options.coverPath, 'card.png', {
        size: Math.round(box / 2) * 2,
        radius: scaled(REEL.card.radius),
        shadowPad: scaled(REEL.card.shadowPad),
        shadowOffset: scaled(REEL.card.shadowOffset),
      }),
    );
    await run(
      buildWideStillArgs({
        background: 'wash.png',
        card: 'card.png',
        centerY: scaled(REEL.card.centerY),
        output: 'wide.png',
      }),
    );
    await run(
      buildFillStillArgs(options.coverPath, 'fill.png', sw, sh, {
        x: crop.offsetX,
        y: crop.offsetY,
      }),
    );
    const veil = style === 'hook' ? 0.3 : 0;
    await run(buildScrimArgs('scrim.png', width, height, veil));
    if (style === 'ambient') await run(buildDustArgs('dust.png', width, height));

    // Text colour from the brightness behind it (after the bottom darkening).
    const textRegion = {
      x: REEL.safe.left / REEL.width,
      y: (REEL.text.titleTop - 20) / REEL.height,
      w: (REEL.width - REEL.safe.left - REEL.safe.right) / REEL.width,
      h: 150 / REEL.height,
    };
    const behind = await regionLuma(
      env.ffmpeg,
      path.join(work, style === 'reveal' ? 'wide.png' : 'fill.png'),
      textRegion,
    );
    const tone = behind * (1 - veil) * 0.65 > 0.6 ? 'dark' : 'light';

    // « Coupes sur le rythme »: shot changes on the attacks of the excerpt.
    let cuts: number[] | undefined;
    if (style === 'cuts') {
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
      cuts = planCuts(detectOnsets(samples, rate), duration);
    }
    const shots = planShots(style, { duration, cuts, details, coverFocus, revealZoom });

    writeFileSync(
      path.join(work, 'text.ass'),
      buildReelAss({
        width,
        height,
        title: options.title,
        artist: options.artist,
        tone,
        hook: style === 'hook' ? options.hookText : undefined,
      }),
    );

    handlers.onProgress?.(0, 'Préparation du son…');
    await renderSoundtrack(run, {
      source: options.audioPath,
      start,
      duration,
      fadeIn: preview ? 0 : Math.min(0.15, duration / 8),
      fadeOut: preview ? 0 : Math.min(options.fadeSeconds ?? REEL.fadeOut, duration / 4),
      bitrate: preview ? '128k' : format.encoding.audioBitrate,
      verify: !preview,
    });

    mkdirSync(path.dirname(options.outputPath), { recursive: true });
    await run(
      buildReelArgs({
        style,
        width,
        height,
        duration,
        shots,
        encoding: preview ? null : format.encoding,
        files: {
          fill: 'fill.png',
          wide: 'wide.png',
          scrim: 'scrim.png',
          dust: style === 'ambient' ? 'dust.png' : undefined,
          ass: 'text.ass',
          fontsDir: 'fonts',
          audio: 'soundtrack.m4a',
          output: partial,
        },
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
