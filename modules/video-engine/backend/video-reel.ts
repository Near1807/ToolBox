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
import {
  buildFramesEncodeArgs,
  buildTruePeakArgs,
  dbToLinear,
  FORMATS,
  FPS,
  parseTruePeak,
  TRUE_PEAK_RATE,
} from './commands';
import { effectOf, INTENSITY_FACTOR, type EffectFrame, type VideoEffect } from './effects';
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
  /** « Morceau synchronisé »: track time = video time + this offset (s). */
  syncOffset?: number;
  /** In the source video, seconds. */
  start: number;
  duration: number;
}

/**
 * Passages chained (hard cuts) and repeated from the start when the video is
 * shorter than the audio excerpt; the last piece is cut at the excerpt's end.
 */
export function planTimeline(
  segments: { source: string; start: number; end: number; syncOffset?: number }[],
  duration: number,
): { pieces: TimelinePiece[]; videoSeconds: number; looped: boolean } {
  const usable = segments
    .map((s) => ({
      source: s.source,
      start: Math.max(0, s.start),
      duration: s.end - s.start,
      ...(s.syncOffset !== undefined ? { syncOffset: s.syncOffset } : {}),
    }))
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

/**
 * « Caméra embarquée »: the picture through a projective warp
 * (zoom, rotation, shake, slight keystone of a screen filmed at an angle),
 * bilinear, then a light motion blur (blend with the previous output) and the
 * flash. The zoom is raised until the warped picture covers the whole frame:
 * never any black edge.
 */
export function applyCamera(
  src: Uint8Array,
  out: Uint8Array,
  previous: Uint8Array | null,
  width: number,
  height: number,
  motion: EffectFrame,
): Uint8Array {
  const cam = motion.camera!;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const cos = Math.cos(cam.rotation);
  const sin = Math.sin(cam.rotation);
  // Inverse mapping (output → source) in coordinates centred and scaled by the height.
  const h = height / 2;
  const inverse = (zoom: number, x: number, y: number): [number, number] => {
    let u = (x - cx) / h - cam.shiftX * (width / h);
    let v = (y - cy) / h - cam.shiftY * (width / h);
    // Keystone: the left side nearer than the right (a screen filmed from the side).
    const w = 1 + cam.keystone * u * 0.5;
    u /= w;
    v /= w;
    const ru = (cos * u + sin * v) / zoom;
    const rv = (-sin * u + cos * v) / zoom;
    return [ru * h + cx, rv * h + cy];
  };
  let zoom = Math.max(1, motion.zoom);
  const corners: [number, number][] = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  for (let i = 0; i < 40; i++) {
    const inside = corners.every(([x, y]) => {
      const [sx, sy] = inverse(zoom, x, y);
      return sx >= 0 && sx <= width - 1 && sy >= 0 && sy <= height - 1;
    });
    if (inside) break;
    zoom *= 1.015;
  }
  const f = Math.min(1, Math.max(0, motion.flash));
  const blur = Math.min(0.6, Math.max(0, cam.blur));
  const row = width * 3;
  for (let y = 0; y < height; y++) {
    let o = y * row;
    for (let x = 0; x < width; x++) {
      const [sx, sy] = inverse(zoom, x, y);
      const x0 = Math.max(0, Math.min(width - 2, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(height - 2, Math.floor(sy)));
      const fx = Math.min(1, Math.max(0, sx - x0));
      const fy = Math.min(1, Math.max(0, sy - y0));
      const a = y0 * row + x0 * 3;
      const b = a + row;
      for (let c = 0; c < 3; c++) {
        const top = src[a + c]! + (src[a + 3 + c]! - src[a + c]!) * fx;
        const bottom = src[b + c]! + (src[b + 3 + c]! - src[b + c]!) * fx;
        let value = top + (bottom - top) * fy;
        if (previous && blur > 0) value = value * (1 - blur) + previous[o + c]! * blur;
        out[o + c] = f > 0 ? value + (255 - value) * f : value;
      }
      o += 3;
    }
  }
  return out;
}

/**
 * The motion blur (blend with the previous frame) trails the picture: it is
 * kept for the release only. On an attack (zoom going up) the frame is sharp,
 * so that the motion peaks on the frame of the attack, never a frame late.
 */
export function trailOnRelease(motion: EffectFrame, previousZoom: number): EffectFrame {
  if (!motion.camera || motion.zoom < previousZoom - 1e-6) return motion;
  return { ...motion, camera: { ...motion.camera, blur: 0 } };
}

/** Energy of the highs (percussion) per frame: first difference, mean square. */
export function highEnergyPerFrame(samples: Float32Array, rate: number, frames: number): number[] {
  const per = rate / FPS;
  return Array.from({ length: frames }, (_, i) => {
    const from = Math.max(1, Math.floor(i * per));
    const to = Math.min(samples.length, Math.floor((i + 1) * per));
    let sum = 0;
    for (let j = from; j < to; j++) sum += (samples[j]! - samples[j - 1]!) ** 2;
    return to > from ? sum / (to - from) : 0;
  });
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
  overlayText = '',
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
  // « Texte à l'écran »: discreet, readable, inside the top safe zone.
  const text = overlayText.replace(/[\r\n]+/g, ' ').trim();
  if (text) {
    ctx.letterSpacing = '0px';
    const size = fitText(ctx, text, px(40), px(24), maxWidth);
    ctx.font = `${size}px "Montserrat SemiBold"`;
    ctx.globalAlpha = 0.88;
    ctx.fillText(text, width / 2, (REEL_LAYOUT.safe.top + 40) * k);
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

/**
 * Soundtrack made of the passages: the videos' own sound
 * (« video », loudness-normalised) or the track's master at the matching
 * place (« synced »), concatenated, faded, limited; true peak ≤ -1.1 dBTP.
 */
async function renderPiecesSoundtrack(
  run: (args: string[]) => Promise<string>,
  params: {
    mode: 'video' | 'synced';
    pieces: TimelinePiece[];
    audioPath: string;
    trackDuration: number;
    duration: number;
    fade: number;
    bitrate: string;
    verify: boolean;
  },
): Promise<void> {
  const inputs = params.pieces.flatMap((piece) => {
    if (params.mode === 'video') {
      return [
        '-ss',
        String(round(piece.start)),
        '-t',
        String(round(piece.duration)),
        '-i',
        piece.source,
      ];
    }
    const offset = piece.syncOffset;
    if (offset === undefined) throw new Error('Morceau pas encore retrouvé dans ce passage');
    const at = piece.start + offset;
    if (at < 0 || at + piece.duration > params.trackDuration + 0.05) {
      throw new Error('Ce passage de la vidéo est hors du morceau : choisis un passage où il joue');
    }
    return ['-ss', String(round(at)), '-t', String(round(piece.duration)), '-i', params.audioPath];
  });
  const target = -1.1;
  let ceiling = -1.6;
  for (let attempt = 1; ; attempt++) {
    const chains = params.pieces.map(
      (_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`,
    );
    const d = params.duration;
    const tail = [
      `${params.pieces.map((_, i) => `[a${i}]`).join('')}concat=n=${params.pieces.length}:v=0:a=1`,
      params.mode === 'video' ? 'loudnorm=I=-14:TP=-2:LRA=11' : null,
      params.fade > 0 ? `afade=t=in:st=0:d=${round(params.fade)}` : null,
      params.fade > 0
        ? `afade=t=out:st=${round(Math.max(0, d - params.fade))}:d=${round(params.fade)}`
        : null,
      `aresample=${TRUE_PEAK_RATE}`,
      `alimiter=limit=${dbToLinear(ceiling)}:attack=1:release=50:level=0`,
      // Padded with silence to the exact duration: the encoder stops at the
      // shortest stream, a sound a few ms short would cost the last frame.
      `aresample=48000,apad=whole_dur=${round(d)}[aout]`,
    ]
      .filter(Boolean)
      .join(',');
    await run([
      ...['-v', 'error', '-y', ...inputs],
      ...['-filter_complex', [...chains, tail].join(';'), '-map', '[aout]'],
      ...['-t', String(round(d)), '-c:a', 'aac', '-aac_coder', 'fast', '-b:a', params.bitrate],
      ...['-ar', '48000', '-ac', '2', '-f', 'mp4', 'soundtrack.m4a'],
    ]);
    if (!params.verify) return;
    const peak = parseTruePeak(await run(buildTruePeakArgs('soundtrack.m4a')));
    if (peak === null) throw new Error('Mesure du niveau crête impossible');
    if (peak <= target - 0.1) return;
    if (attempt === 4) throw new Error(`Niveau crête trop élevé (${peak} dBTP)`);
    ceiling -= peak - target + 0.4;
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
  const mode = options.audioMode ?? 'track';
  const start = Math.min(Math.max(0, options.start), Math.max(0, audioDuration - 1));
  // The Reel lasts `duration` in every mode; outside « track » the sound follows the passages.
  const duration =
    mode === 'track' ? Math.min(options.duration, audioDuration - start) : options.duration;
  if (duration < 1) throw new Error('Extrait trop court (1 seconde minimum)');
  const frames = Math.round(duration * FPS);
  const timeline = planTimeline(options.segments, duration);
  const intensity = INTENSITY_FACTOR[options.intensity ?? 'medium'] ?? 1;

  const work = path.join(env.workRoot, randomUUID());
  mkdirSync(work, { recursive: true });
  const partial = `${options.outputPath}.part`;
  const run = (args: string[], onTime?: (s: number) => void) =>
    runFfmpeg({ ffmpeg: env.ffmpeg, args, cwd: work, signal: handlers.signal, onTime });

  try {
    const rate = 22050;
    const fade = preview ? 0 : Math.min(options.fadeSeconds ?? L.fadeSeconds, duration / 4);
    const bitrate = preview ? '128k' : FORMATS.instagram.encoding.audioBitrate;
    let samples: Float32Array;
    if (mode === 'track') {
      handlers.onProgress?.(0, 'Analyse du son…');
      samples = await decodeExcerpt(
        env.ffmpeg,
        options.audioPath,
        start,
        duration,
        rate,
        handlers.signal,
      );
      handlers.onProgress?.(0, 'Préparation du son…');
      await renderSoundtrack(run, {
        source: options.audioPath,
        start,
        duration,
        fadeIn: fade,
        fadeOut: fade,
        bitrate,
        verify: !preview,
      });
    } else {
      // The final sound is made first: the effects follow IT.
      handlers.onProgress?.(0, 'Préparation du son…');
      await renderPiecesSoundtrack(run, {
        mode,
        pieces: timeline.pieces,
        audioPath: options.audioPath,
        trackDuration: audioDuration,
        duration,
        fade,
        bitrate,
        verify: !preview,
      });
      handlers.onProgress?.(0, 'Analyse du son…');
      samples = await decodeExcerpt(
        env.ffmpeg,
        path.join(work, 'soundtrack.m4a'),
        0,
        duration,
        rate,
        handlers.signal,
      );
    }
    const envelope = breathEnvelope(bassEnergyPerFrame(samples, rate, FPS, frames), FPS, {
      releaseSec: effect.releaseSec,
    });
    const highs = breathEnvelope(highEnergyPerFrame(samples, rate, frames), FPS, {
      releaseSec: 0.08,
      reference: 1e-9,
    });
    // The sway changes side on each bass attack (a jump of the envelope).
    const sides: number[] = [];
    let side = 1;
    envelope.forEach((value, i) => {
      if (i > 0 && value - envelope[i - 1]! > 0.25) side = -side;
      sides.push(side);
    });

    if (!GlobalFonts.has('Montserrat SemiBold')) {
      GlobalFonts.registerFromPath(path.join(env.fontsDir, FONT_FILE), 'Montserrat SemiBold');
    }
    // Still layer (effect bars or vignette, title, artist): laid over by the encoder.
    const layer = createCanvas(width, height);
    drawStillLayer(
      layer.getContext('2d'),
      effect,
      width,
      height,
      k,
      options.title,
      options.artist,
      options.overlayText,
    );
    writeFileSync(path.join(work, 'layer.png'), await layer.encode('png'));

    const frameBytes = width * height * 3;
    const out = new Uint8Array(frameBytes);
    let previousOut: Uint8Array | null = null;
    let lastZoom = 1;
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
        exact: true,
      }),
      feed: async (stdin) => {
        let last: Buffer | null = null;
        let f = 0;
        const emit = async (pixels: Buffer) => {
          const motion = effect.frame({
            frame: f,
            frames,
            envelope: envelope[f] ?? 0,
            high: highs[f] ?? 0,
            side: sides[f] ?? 1,
            intensity,
          });
          const frame = motion.camera
            ? applyCamera(pixels, out, previousOut, width, height, trailOnRelease(motion, lastZoom))
            : applyMotion(pixels, out, width, height, motion.zoom, motion.flash);
          lastZoom = motion.zoom;
          if (motion.camera) previousOut = Buffer.from(out);
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
