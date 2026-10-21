// Reels made from the user's own videos (module custom-reels): FFmpeg decodes
// the chosen passages, frames them in 9:16 and applies the static grade; each
// frame then goes through the effect (zoom, flash from the bass), gets the
// effect's still layer and the discreet title, and is encoded with the track
// excerpt as the only sound (the videos' own sound is never used).
// Pure parts (timeline, FFmpeg arguments, text layout) are unit-tested.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import type { RenderHandlers, RenderResult, VideoReelRequest } from '../contract';
import { bassEnergyPerFrame, breathEnvelope } from './audio-analysis';
import { buildFramesEncodeArgs, FORMATS, FPS } from './commands';
import { effectOf, type VideoEffect } from './effects';
import {
  decodeExcerpt,
  FONT_FILE,
  probeDuration,
  renderSoundtrack,
  type EngineEnvironment,
} from './engine';
import { REEL_LAYOUT } from './reel-frames';
import { RenderCancelled, runFfmpeg } from './runner';

/** Full-size layout of the video Reels (1080×1920, same safe zones as the cover Reels). */
export const VIDEO_REEL_LAYOUT = {
  width: REEL_LAYOUT.width,
  height: REEL_LAYOUT.height,
  safe: REEL_LAYOUT.safe,
  /** Discreet title and artist, above Instagram's bottom zone, inside its right margin. */
  title: { top: 1418, fontSize: 46, minFontSize: 28 },
  artist: { top: 1478, fontSize: 30, spacing: 3 },
  textMaxWidth: REEL_LAYOUT.width - 2 * REEL_LAYOUT.safe.right,
  textOpacity: 0.92,
  /** Blurred background of the « whole video » framing. */
  blur: 24,
  backgroundDim: -0.12,
  fadeSeconds: REEL_LAYOUT.fadeSeconds,
} as const;

export interface TimelinePiece {
  source: string;
  /** In the source video, seconds. */
  start: number;
  duration: number;
}

/**
 * Passages chained (hard cuts) and repeated from the start when the video is
 * shorter than the audio excerpt; the last piece is cut at the excerpt's end.
 */
export function planTimeline(
  segments: { source: string; start: number; end: number }[],
  duration: number,
): { pieces: TimelinePiece[]; videoSeconds: number; looped: boolean } {
  const usable = segments
    .map((s) => ({ source: s.source, start: Math.max(0, s.start), duration: s.end - s.start }))
    .filter((s) => s.duration >= 0.2);
  const videoSeconds = usable.reduce((sum, s) => sum + s.duration, 0);
  if (usable.length === 0 || videoSeconds < 0.5) {
    throw new Error('Choisis au moins un passage vidéo (0,5 s minimum)');
  }
  const pieces: TimelinePiece[] = [];
  let total = 0;
  for (let i = 0; total < duration - 1e-6; i++) {
    const piece = usable[i % usable.length]!;
    const length = Math.min(piece.duration, duration - total);
    pieces.push({ ...piece, duration: Number(length.toFixed(3)) });
    total += length;
    if (pieces.length > 400) break;
  }
  return { pieces, videoSeconds, looped: videoSeconds < duration - 1e-6 };
}

const round = (n: number) => Number(n.toFixed(3));

/**
 * FFmpeg decoding of the timeline into raw RGBA frames of width × height at
 * 30 fps on the standard output: each piece framed in 9:16 (« fit »: the
 * whole video over a blurred background made from itself; « fill »: cropped
 * around the focus point, never stretched), then chained, then graded.
 */
export function buildVideoDecodeArgs(params: {
  pieces: TimelinePiece[];
  width: number;
  height: number;
  framing: 'fit' | 'fill';
  focus: { x: number; y: number };
  grade: string | null;
  frames: number;
  /** Output pixels per full-size pixel. */
  k: number;
}): string[] {
  const { width: W, height: H, k } = params;
  const fx = Math.min(1, Math.max(0, params.focus.x));
  const fy = Math.min(1, Math.max(0, params.focus.y));
  // The background is blurred at a quarter of the size (same look, 2.5× faster), then scaled up.
  const bw = Math.max(2, Math.round(W / 8) * 2);
  const bh = Math.max(2, Math.round(H / 8) * 2);
  const blur = Math.max(1, Math.round((VIDEO_REEL_LAYOUT.blur * k) / 4));
  const inputs = params.pieces.flatMap((p) => [
    ...['-ss', String(round(p.start)), '-t', String(round(p.duration)), '-i', p.source],
  ]);
  const chains = params.pieces.map((_, i) => {
    const common = `[${i}:v]fps=${FPS},setsar=1`;
    if (params.framing === 'fill') {
      return (
        `${common},scale=${W}:${H}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H}:x='(iw-ow)*${fx}':y='(ih-oh)*${fy}',setsar=1[s${i}]`
      );
    }
    return (
      `${common},split=2[f${i}][b${i}];` +
      `[b${i}]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},` +
      `boxblur=${blur}:2,eq=brightness=${VIDEO_REEL_LAYOUT.backgroundDim}:saturation=0.85,` +
      `scale=${W}:${H}[bb${i}];` +
      `[f${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease[ff${i}];` +
      `[bb${i}][ff${i}]overlay=x=(W-w)/2:y=(H-h)/2,setsar=1[s${i}]`
    );
  });
  const joined = params.pieces.map((_, i) => `[s${i}]`).join('');
  const tail = [
    `${joined}concat=n=${params.pieces.length}:v=1:a=0`,
    params.grade,
    'format=rgb24[out]',
  ]
    .filter(Boolean)
    .join(',');
  return [
    ...['-v', 'error', ...inputs],
    ...['-filter_complex', [...chains, tail].join(';')],
    ...['-map', '[out]', '-frames:v', String(params.frames)],
    ...['-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
  ];
}

/**
 * Motion of one frame on raw RGB pixels: zoom around the centre (bilinear,
 * sub-pixel smooth) and a white flash in « screen » mode (v + (255 − v) × flash).
 * Writes into `out`; returns `src` itself when there is nothing to do.
 */
export function applyMotion(
  src: Uint8Array,
  out: Uint8Array,
  width: number,
  height: number,
  zoom: number,
  flash: number,
): Uint8Array {
  const zooming = zoom > 1.0005;
  const flashing = flash > 0.002;
  if (!zooming && !flashing) return src;
  const f = Math.min(1, Math.max(0, flash));
  if (!zooming) {
    for (let i = 0; i < src.length; i++) out[i] = src[i]! + (255 - src[i]!) * f;
    return out;
  }
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const xs = new Int32Array(width);
  const xn = new Int32Array(width);
  const xw = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const sx = (x - cx) / zoom + cx;
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(sx)));
    xs[x] = x0 * 3;
    xn[x] = Math.min(width - 1, x0 + 1) * 3;
    xw[x] = sx - Math.floor(sx);
  }
  const row = width * 3;
  for (let y = 0; y < height; y++) {
    const sy = (y - cy) / zoom + cy;
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(sy)));
    const fy = sy - Math.floor(sy);
    const r0 = y0 * row;
    const r1 = Math.min(height - 1, y0 + 1) * row;
    let o = y * row;
    for (let x = 0; x < width; x++) {
      const a = xs[x]!;
      const b = xn[x]!;
      const fx = xw[x]!;
      for (let c = 0; c < 3; c++) {
        const top = src[r0 + a + c]! + (src[r0 + b + c]! - src[r0 + a + c]!) * fx;
        const bottom = src[r1 + a + c]! + (src[r1 + b + c]! - src[r1 + a + c]!) * fx;
        const v = top + (bottom - top) * fy;
        out[o + c] = flashing ? v + (255 - v) * f : v;
      }
      o += 3;
    }
  }
  return out;
}

/** Font size so that the text fits the width (letter spacing included). */
function fitText(
  ctx: SKRSContext2D,
  text: string,
  size: number,
  min: number,
  maxWidth: number,
  spacing = 0,
): number {
  let s = size;
  for (; s > min; s--) {
    ctx.font = `${s}px "Montserrat SemiBold"`;
    if (ctx.measureText(text).width + spacing * text.length <= maxWidth) break;
  }
  return s;
}

/** Still layer of every frame: the effect's own (bars, vignette), then title and artist. */
function drawStillLayer(
  ctx: SKRSContext2D,
  effect: VideoEffect,
  width: number,
  height: number,
  k: number,
  title: string,
  artist: string,
): void {
  effect.overlay?.(ctx, width, height);
  const L = VIDEO_REEL_LAYOUT;
  const px = (n: number) => Math.max(1, Math.round(n * k));
  ctx.save();
  ctx.globalAlpha = L.textOpacity;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = px(8);
  ctx.shadowOffsetY = px(2);
  const maxWidth = L.textMaxWidth * k;
  const cleanTitle = title.replace(/[\r\n]+/g, ' ').trim();
  const cleanArtist = artist
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .toUpperCase();
  if (cleanTitle) {
    const size = fitText(ctx, cleanTitle, px(L.title.fontSize), px(L.title.minFontSize), maxWidth);
    ctx.font = `${size}px "Montserrat SemiBold"`;
    ctx.fillText(cleanTitle, width / 2, L.title.top * k);
  }
  if (cleanArtist) {
    const spacing = px(L.artist.spacing);
    const size = fitText(ctx, cleanArtist, px(L.artist.fontSize), px(18), maxWidth, spacing);
    ctx.font = `${size}px "Montserrat SemiBold"`;
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(cleanArtist, width / 2, L.artist.top * k);
  }
  ctx.restore();
}

/** Raw frames read from FFmpeg's output, one Buffer of width × height × 4 at a time. */
async function* rawFrames(
  ffmpeg: string,
  args: string[],
  frameBytes: number,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  const child = spawn(ffmpeg, args, { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  const exited = new Promise<number | null>((resolve) => child.on('close', resolve));
  const onAbort = () => child.kill();
  signal?.addEventListener('abort', onAbort, { once: true });
  let pending: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      pending.push(chunk);
      size += chunk.length;
      while (size >= frameBytes) {
        const all = Buffer.concat(pending, size);
        yield all.subarray(0, frameBytes);
        const rest = all.subarray(frameBytes);
        pending = rest.length ? [Buffer.from(rest)] : [];
        size = rest.length;
      }
    }
    const code = await exited;
    if (signal?.aborted) throw new RenderCancelled();
    if (code !== 0) {
      const detail = stderr.trim().split('\n').slice(-3).join(' | ');
      throw new Error(`Lecture de la vidéo impossible${detail ? ` : ${detail}` : ''}`);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (child.exitCode === null) child.kill();
  }
}

export interface VideoReelOptions extends VideoReelRequest {
  outputPath: string;
  scale?: number;
  quality?: 'final' | 'preview';
}

/**
 * Renders a Reel (1080×1920) from the user's videos. The bass envelope (same
 * analysis as the cover Reels: instant attack on the attack's frame, soft
 * release) drives the effect's motion directly.
 */
export async function renderVideoReel(
  env: EngineEnvironment,
  options: VideoReelOptions,
  handlers: RenderHandlers = {},
): Promise<RenderResult & { looped: boolean }> {
  if (handlers.signal?.aborted) throw new RenderCancelled();
  if (!existsSync(options.audioPath))
    throw new Error(`Fichier son introuvable : ${options.audioPath}`);
  for (const segment of options.segments) {
    if (!existsSync(segment.source)) {
      throw new Error(`Vidéo introuvable : ${path.basename(segment.source)}`);
    }
  }
  const effect = effectOf(options.effect);
  const L = VIDEO_REEL_LAYOUT;
  const preview = options.quality === 'preview';
  const k = options.scale ?? 1;
  const width = Math.max(2, Math.round((L.width * k) / 2) * 2);
  const height = Math.max(2, Math.round((L.height * k) / 2) * 2);

  const audioDuration = await probeDuration(env.ffprobe, options.audioPath);
  const start = Math.min(Math.max(0, options.start), Math.max(0, audioDuration - 1));
  const duration = Math.min(options.duration, audioDuration - start);
  if (duration < 1) throw new Error('Extrait trop court (1 seconde minimum)');
  const frames = Math.round(duration * FPS);
  const timeline = planTimeline(options.segments, duration);

  const work = path.join(env.workRoot, randomUUID());
  mkdirSync(work, { recursive: true });
  const partial = `${options.outputPath}.part`;
  const run = (args: string[], onTime?: (s: number) => void) =>
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
    const envelope = breathEnvelope(bassEnergyPerFrame(samples, rate, FPS, frames), FPS, {
      releaseSec: effect.releaseSec,
    });

    handlers.onProgress?.(0, 'Préparation du son…');
    const fade = preview ? 0 : Math.min(options.fadeSeconds ?? L.fadeSeconds, duration / 4);
    await renderSoundtrack(run, {
      source: options.audioPath,
      start,
      duration,
      fadeIn: fade,
      fadeOut: fade,
      bitrate: preview ? '128k' : FORMATS.instagram.encoding.audioBitrate,
      verify: !preview,
    });

    if (!GlobalFonts.has('Montserrat SemiBold')) {
      GlobalFonts.registerFromPath(path.join(env.fontsDir, FONT_FILE), 'Montserrat SemiBold');
    }
    // Still layer (effect bars or vignette, title, artist): laid over by the encoder.
    const layer = createCanvas(width, height);
    drawStillLayer(layer.getContext('2d'), effect, width, height, k, options.title, options.artist);
    writeFileSync(path.join(work, 'layer.png'), await layer.encode('png'));

    const frameBytes = width * height * 3;
    const out = new Uint8Array(frameBytes);
    const decodeArgs = buildVideoDecodeArgs({
      pieces: timeline.pieces,
      width,
      height,
      framing: options.framing,
      focus: options.focus ?? { x: 0.5, y: 0.5 },
      grade: effect.grade,
      frames,
      k,
    });

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
        grain: preview ? 0 : effect.grain,
        pixelFormat: 'rgb24',
        overlay: 'layer.png',
        encoding: preview ? null : FORMATS.instagram.encoding,
        audio: 'soundtrack.m4a',
        output: partial,
      }),
      feed: async (stdin) => {
        let last: Buffer | null = null;
        let f = 0;
        const emit = async (pixels: Buffer) => {
          const motion = effect.frame({ frame: f, frames, envelope: envelope[f] ?? 0 });
          const frame = applyMotion(pixels, out, width, height, motion.zoom, motion.flash);
          // `out` is reused by the next frame: FFmpeg gets a copy.
          const chunk = frame === out ? Buffer.from(out) : (frame as Buffer);
          if (!stdin.write(chunk)) await once(stdin, 'drain');
          f++;
          if (f % 15 === 0) {
            const fraction = Math.min(0.99, f / frames);
            handlers.onProgress?.(fraction, `Rendu… ${Math.round(fraction * 100)} %`);
          }
        };
        for await (const pixels of rawFrames(env.ffmpeg, decodeArgs, frameBytes, handlers.signal)) {
          if (handlers.signal?.aborted) return;
          last = pixels;
          await emit(pixels);
          if (f >= frames) break;
        }
        // Rounding of the pieces' lengths may leave a frame or two: the last one is held.
        while (last && f < frames) await emit(last);
        if (!last) throw new Error('La vidéo n’a donné aucune image');
      },
    });
    rmSync(options.outputPath, { force: true });
    renameSync(partial, options.outputPath);
    handlers.onProgress?.(1, 'Terminé');
    return {
      file: options.outputPath,
      durationSec: duration,
      width,
      height,
      looped: timeline.looped,
    };
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
