import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
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
  type StillSpec,
  buildCardArgs,
  buildFontsConfig,
  buildRenderArgs,
  buildTruePeakArgs,
  buildFramesEncodeArgs,
  FPS,
  FORMATS,
  INITIAL_CEILING_DB,
  parseTruePeak,
  scaleFormat,
  TRUE_PEAK_TARGET,
} from './commands';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { bassEnergyPerFrame, breathEnvelope, spectrumPerFrame } from './audio-analysis';
import {
  coverScale,
  coverSize,
  drawFrame,
  lightTone,
  REEL_LAYOUT,
  type FrameAssets,
} from './reel-frames';
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
  // Vertical videos are Reels, drawn frame by frame (renderReel).
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

/** Renders a still image (JPEG): the 4:5 post, or the 16:9 YouTube thumbnail. */
export async function renderPostImage(
  env: EngineEnvironment,
  request: PostRequest,
  spec: StillSpec = POST_SPEC,
): Promise<{ file: string; width: number; height: number }> {
  if (!request.coverPath || !existsSync(request.coverPath)) {
    throw new Error(`Fichier cover introuvable : ${request.coverPath || '(aucun)'}`);
  }
  const { width, height } = spec;
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
        layout: spec.text,
      }),
    );
    const run = (args: string[]) =>
      runFfmpeg({
        ffmpeg: env.ffmpeg,
        args,
        cwd: work,
        env: { FONTCONFIG_FILE: path.join(work, 'fonts.conf') },
      });
    await run(buildBackgroundArgs(request.coverPath, 'background.png', width, height, spec.blur));
    await run(buildCardArgs(request.coverPath, 'card.png', spec.cover));
    mkdirSync(path.dirname(request.outputPath), { recursive: true });
    await run(
      buildPostArgs(
        {
          background: 'background.png',
          card: 'card.png',
          ass: 'post.ass',
          fontsDir: 'fonts',
          output: partial,
        },
        spec,
      ),
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

/** Mono float samples of an excerpt, decoded by FFmpeg. */
async function decodeExcerpt(
  ffmpeg: string,
  file: string,
  start: number,
  duration: number,
  rate: number,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const raw = await ffmpegStdout(
    ffmpeg,
    [
      ...['-v', 'error', '-ss', String(start), '-t', String(duration), '-i', file],
      ...['-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'],
    ],
    signal,
  );
  const copy = new Float32Array(Math.floor(raw.length / 4));
  new Uint8Array(copy.buffer).set(raw.subarray(0, copy.length * 4));
  return copy;
}

/**
 * Renders a Reel (1080×1920) frame by frame: the audio is analysed in JS
 * (bass energy → breathing of the cover; spectrum → bars around the cover),
 * each frame is drawn on a canvas and streamed to FFmpeg as raw pixels. The
 * still parts (blurred background, title, artist, cover with its shadow) are
 * prepared once. docs/decisions/0017-rendu-image-par-image.md.
 */
export async function renderReel(
  env: EngineEnvironment,
  options: RenderOptions,
  handlers: RenderHandlers = {},
): Promise<RenderResult> {
  const L = REEL_LAYOUT;
  const format = FORMATS.instagram;
  const preview = options.quality === 'preview';
  const k = options.scale ?? 1;
  const width = Math.max(2, Math.round((L.width * k) / 2) * 2);
  const height = Math.max(2, Math.round((L.height * k) / 2) * 2);
  const px = (n: number) => Math.max(1, Math.round(n * k));

  const audioDuration = await probeDuration(env.ffprobe, options.audioPath);
  const start = Math.min(Math.max(0, options.start ?? 0), Math.max(0, audioDuration - 1));
  const duration = Math.min(options.duration ?? audioDuration - start, audioDuration - start);
  if (duration < 1) throw new Error('Extrait trop court (1 seconde minimum)');
  const frames = Math.round(duration * FPS);

  const work = path.join(env.workRoot, randomUUID());
  mkdirSync(work, { recursive: true });
  const partial = `${options.outputPath}.part`;
  const run: Run = (args, onTime) =>
    runFfmpeg({ ffmpeg: env.ffmpeg, args, cwd: work, signal: handlers.signal, onTime });

  try {
    handlers.onProgress?.(0, 'Analyse du son…');
    const rate = 22050;
    const samples = await decodeExcerpt(
      env.ffmpeg,
      options.audioPath,
      start,
      duration,
      rate,
      handlers.signal,
    );
    const envelope = breathEnvelope(bassEnergyPerFrame(samples, rate, FPS, frames), FPS);
    const spectra = spectrumPerFrame(samples, rate, FPS, frames, { bands: 24 });

    handlers.onProgress?.(0, 'Préparation des images…');
    // Still parts, prepared once: blurred background, cover with its shadow (×1.5 for sharpness).
    await run(buildBackgroundArgs(options.coverPath, 'background.png', width, height, px(60)));
    const supersample = 1.5;
    await run(
      buildCardArgs(options.coverPath, 'card.png', {
        size: Math.round((L.cover.size * k * supersample) / 2) * 2,
        radius: Math.round(L.cover.radius * k * supersample),
        shadowPad: Math.round(L.cover.shadowPad * k * supersample),
        shadowOffset: Math.round(L.cover.shadowOffset * k * supersample),
      }),
    );
    const [background, card, cover] = await Promise.all([
      loadImage(path.join(work, 'background.png')),
      loadImage(path.join(work, 'card.png')),
      loadImage(options.coverPath),
    ]);
    const pad = Math.round(L.cover.shadowPad * k * supersample);
    const shown = coverSize(cover.width / cover.height, L.cover.size * k);

    // Average colour of the cover → light tone of the bars.
    const sampler = createCanvas(16, 16);
    const sctx = sampler.getContext('2d');
    sctx.drawImage(cover, 0, 0, 16, 16);
    const pixels = sctx.getImageData(0, 0, 16, 16).data;
    const rgb: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) {
      rgb[0] += pixels[i]!;
      rgb[1] += pixels[i + 1]!;
      rgb[2] += pixels[i + 2]!;
    }
    const n = pixels.length / 4;

    // Background + title + artist, drawn once.
    if (!GlobalFonts.has('Montserrat SemiBold')) {
      GlobalFonts.registerFromPath(path.join(env.fontsDir, FONT_FILE), 'Montserrat SemiBold');
    }
    const still = createCanvas(width, height);
    const sc = still.getContext('2d');
    sc.drawImage(background, 0, 0, width, height);
    sc.textAlign = 'center';
    sc.textBaseline = 'top';
    sc.fillStyle = '#ffffff';
    sc.shadowColor = 'rgba(0, 0, 0, 0.45)';
    sc.shadowBlur = px(6);
    sc.shadowOffsetY = px(2);
    const maxText = L.cover.size * k;
    const fit = (text: string, size: number, min: number, spacing = 0) => {
      let s = size;
      for (; s > min; s--) {
        sc.font = `${s}px "Montserrat SemiBold"`;
        if (sc.measureText(text).width + spacing * text.length <= maxText) break;
      }
      return s;
    };
    const title = options.title.replace(/[\r\n]+/g, ' ').trim();
    const artist = options.artist
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .toUpperCase();
    if (title) {
      sc.font = `${fit(title, px(L.title.fontSize), px(L.title.minFontSize))}px "Montserrat SemiBold"`;
      sc.fillText(title, width / 2, L.title.top * k);
    }
    if (artist) {
      const spacing = px(L.artist.spacing);
      sc.font = `${fit(artist, px(L.artist.fontSize), px(L.title.minFontSize) / 2, spacing)}px "Montserrat SemiBold"`;
      sc.letterSpacing = `${spacing}px`;
      sc.fillText(artist, width / 2, L.artist.top * k);
    }

    const assets: FrameAssets = {
      still,
      card,
      cardCover: { width: card.width - 2 * pad, height: card.height - 2 * pad, pad },
      cover: { width: shown.width, height: shown.height, radius: L.cover.radius * k },
      tone: lightTone([rgb[0] / n, rgb[1] / n, rgb[2] / n]),
      k,
    };

    handlers.onProgress?.(0, 'Préparation du son…');
    await renderSoundtrack(run, {
      source: options.audioPath,
      start,
      duration,
      fadeIn: preview ? 0 : Math.min(options.fadeSeconds ?? L.fadeSeconds, duration / 4),
      fadeOut: preview ? 0 : Math.min(options.fadeSeconds ?? L.fadeSeconds, duration / 4),
      bitrate: preview ? '128k' : format.encoding.audioBitrate,
      verify: !preview,
    });

    // Frames drawn one by one and streamed to FFmpeg (raw RGBA pixels).
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const fade = preview ? 0 : Math.min(options.fadeSeconds ?? L.fadeSeconds, duration / 4);
    mkdirSync(path.dirname(options.outputPath), { recursive: true });
    await runFfmpeg({
      ffmpeg: env.ffmpeg,
      cwd: work,
      signal: handlers.signal,
      args: buildFramesEncodeArgs({
        width,
        height,
        duration,
        fade,
        encoding: preview ? null : format.encoding,
        audio: 'soundtrack.m4a',
        output: partial,
      }),
      feed: async (stdin) => {
        for (let f = 0; f < frames; f++) {
          if (handlers.signal?.aborted) return;
          drawFrame(ctx, assets, coverScale(f, frames, envelope[f]!), spectra[f]!);
          // A copy: the canvas memory is reused by the next frame.
          if (!stdin.write(Buffer.from(canvas.data()))) await once(stdin, 'drain');
          if (f % 15 === 0) {
            const fraction = Math.min(0.99, f / frames);
            handlers.onProgress?.(fraction, `Rendu… ${Math.round(fraction * 100)} %`);
          }
        }
      },
    });
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
