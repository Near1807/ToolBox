// Vertical Reels (1080×1920) in four styles, without audio visualisation (the
// spectrum stays the signature of the YouTube videos). Pure functions only:
// image analysis (where the interesting parts of the cover are), beat
// detection (where to cut), and the FFmpeg arguments. Every motion is made by
// `zoompan` on still images prepared at 2–3× the frame size, so that slow
// movements stay smooth (sub-pixel precision) — FFmpeg 6.1 compatible.
import type { ReelStyle } from '../contract';
import { escapeAssText, fitFontSize, FPS } from './commands';

export const REEL_STYLES: ReelStyle[] = ['reveal', 'cuts', 'hook', 'ambient'];

export const REEL_STYLE_LABELS: Record<ReelStyle, string> = {
  reveal: 'Révélation',
  cuts: 'Coupes sur le rythme',
  hook: 'Phrase d’accroche',
  ambient: 'Ambiance',
};

/** Full-size frame and the zones covered by the Instagram interface. */
export const REEL = {
  width: 1080,
  height: 1920,
  /** Caption, buttons and progress of Instagram: nothing important below / on the right. */
  safe: { bottom: 350, right: 150, top: 220, left: 72 },
  /** Cover box of the wide shot (« Révélation » end, « Coupes » wide shots). */
  card: { size: 780, centerY: 860, radius: 34, shadowPad: 70, shadowOffset: 16 },
  text: { titleTop: 1396, titleSize: 56, artistTop: 1466, artistSize: 32, hookSize: 112 },
  bar: { top: 1544, height: 4 },
  /** Video fade at the end; no fade-in: something is on screen from the first frame. */
  fadeOut: 0.5,
};

const round3 = (n: number) => Number(n.toFixed(3));
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// ---------------------------------------------------------------------------
// Image analysis: where the interesting parts of the cover are
// ---------------------------------------------------------------------------

/**
 * Detail map of a small grayscale image (size × size, values 0..255): local
 * gradient magnitude, slightly blurred. Flat areas score low, textures,
 * faces and lettering score high.
 */
export function detailMap(pixels: Uint8Array, size: number): number[] {
  const at = (x: number, y: number) =>
    pixels[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))]!;
  const raw: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      raw.push(Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1)));
    }
  }
  const blurred: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          sum += raw[yy * size + xx]!;
          n++;
        }
      }
      blurred.push(sum / n);
    }
  }
  return blurred;
}

/**
 * Best position of a window covering `visible` (0..1) of a profile, as a
 * fraction 0..1 of the free range (0.5 = centred). A light pull towards the
 * centre avoids odd crops when the image is evenly detailed.
 */
export function bestWindow(profile: number[], visible: number, centreBias = 0.25): number {
  if (visible >= 0.999 || profile.length < 2) return 0.5;
  const n = profile.length;
  const width = Math.max(1, Math.round(visible * n));
  const total = profile.reduce((a, b) => a + b, 0) || 1;
  let best = 0.5;
  let bestScore = -Infinity;
  for (let start = 0; start + width <= n; start++) {
    let sum = 0;
    for (let i = start; i < start + width; i++) sum += profile[i]!;
    const offset = n === width ? 0.5 : start / (n - width);
    const score = sum / total - centreBias * Math.abs(offset - 0.5);
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = offset;
    }
  }
  return round3(best);
}

/**
 * Most detailed points of the map (normalised 0..1 coordinates), at least
 * `minDistance` apart, most detailed first.
 */
export function focusPoints(
  map: number[],
  size: number,
  count: number,
  minDistance = 0.25,
): { x: number; y: number }[] {
  const order = map.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
  const points: { x: number; y: number }[] = [];
  for (const { index } of order) {
    const point = {
      x: round3(((index % size) + 0.5) / size),
      y: round3((Math.floor(index / size) + 0.5) / size),
    };
    // Keep away from the very edges: a close-up there would be clamped anyway.
    if (point.x < 0.12 || point.x > 0.88 || point.y < 0.12 || point.y > 0.88) continue;
    if (points.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < minDistance)) continue;
    points.push(point);
    if (points.length === count) break;
  }
  while (points.length < count) points.push({ x: 0.5, y: 0.5 });
  return points;
}

/**
 * Crop of the cover that fills the 9:16 frame: which part is visible.
 * `aspect` = cover width / height. Returns the crop offsets (fractions of the
 * free range) and the visible window in cover coordinates.
 */
export function fillCrop(
  map: number[],
  size: number,
  aspect: number,
  frameAspect = REEL.width / REEL.height,
): { offsetX: number; offsetY: number; window: { x: number; y: number; w: number; h: number } } {
  const columns = Array.from({ length: size }, (_, x) =>
    Array.from({ length: size }, (_, y) => map[y * size + x]!).reduce((a, b) => a + b, 0),
  );
  const rows = Array.from({ length: size }, (_, y) =>
    map.slice(y * size, (y + 1) * size).reduce((a, b) => a + b, 0),
  );
  // Visible fraction of the cover along each axis when it covers the frame.
  const visibleW = Math.min(1, frameAspect / aspect);
  const visibleH = Math.min(1, aspect / frameAspect);
  const offsetX = bestWindow(columns, visibleW);
  const offsetY = bestWindow(rows, visibleH);
  return {
    offsetX,
    offsetY,
    window: {
      x: round3(offsetX * (1 - visibleW)),
      y: round3(offsetY * (1 - visibleH)),
      w: round3(visibleW),
      h: round3(visibleH),
    },
  };
}

/** Cover point → point of the 9:16 fill (clamped inside it). */
export function coverToFill(
  point: { x: number; y: number },
  window: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  const clamp = (n: number) => round3(Math.min(1, Math.max(0, n)));
  return { x: clamp((point.x - window.x) / window.w), y: clamp((point.y - window.y) / window.h) };
}

// ---------------------------------------------------------------------------
// Beat detection: where « Coupes sur le rythme » changes shot
// ---------------------------------------------------------------------------

export interface Onset {
  time: number;
  /** Relative strength (z-score of the energy rise). */
  strength: number;
}

/** Positive rises of a series, divided by their standard deviation. */
function normalisedRises(values: number[]): number[] {
  const rises = values.map((v, i) => (i === 0 ? 0 : Math.max(0, v - values[i - 1]!)));
  const mean = rises.reduce((a, b) => a + b, 0) / Math.max(1, rises.length);
  const std = Math.sqrt(rises.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rises.length));
  return rises.map((r) => (std > 0 ? r / std : 0));
}

/**
 * Attacks of a mono 16-bit signal: sudden rises of the energy, measured twice
 * — on the whole signal (kicks, bass notes) and on its first difference
 * (snares, hi-hats, plucks) — kept as local peaks clearly above the average.
 * Windows of 1024 samples, hop of 256.
 */
export function detectOnsets(samples: Int16Array, sampleRate: number): Onset[] {
  const hop = 256;
  const size = 1024;
  const full: number[] = [];
  const highs: number[] = [];
  for (let start = 0; start + size <= samples.length; start += hop) {
    let sum = 0;
    let diff = 0;
    for (let i = start + 1; i < start + size; i++) {
      const v = samples[i]! / 32768;
      const d = v - samples[i - 1]! / 32768;
      sum += v * v;
      diff += d * d;
    }
    full.push(Math.log10(1e-9 + sum));
    highs.push(Math.log10(1e-9 + diff));
  }
  const a = normalisedRises(full);
  const b = normalisedRises(highs);
  const flux = a.map((value, i) => value + b[i]!);
  const mean = flux.reduce((x, y) => x + y, 0) / Math.max(1, flux.length);
  const std = Math.sqrt(flux.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, flux.length));
  const onsets: Onset[] = [];
  for (let i = 1; i < flux.length; i++) {
    const value = flux[i]!;
    if (std === 0 || value <= mean + std) continue;
    let peak = true;
    for (let j = Math.max(0, i - 4); j <= Math.min(flux.length - 1, i + 4); j++) {
      if (flux[j]! > value) peak = false;
    }
    if (peak) {
      onsets.push({
        // Centre of the window plus one hop: where the rise is heard.
        time: round3((i * hop + size / 2 + hop) / sampleRate),
        strength: round3((value - mean) / std),
      });
    }
  }
  return onsets;
}

/**
 * Shot changes for a clip: 4 to 6 shots, each cut on the strongest attack
 * near its ideal position (±1.2 s), shots at least 1.6 s long. Without
 * usable attacks, evenly spaced cuts. Times are rounded to whole frames.
 */
export function planCuts(onsets: Onset[], duration: number): number[] {
  const shots = Math.min(6, Math.max(4, Math.round(duration / 4.8)));
  const minShot = Math.min(1.6, duration / (shots * 1.5));
  const cuts: number[] = [];
  let previous = 0;
  for (let k = 1; k < shots; k++) {
    const ideal = (k * duration) / shots;
    const candidates = onsets.filter(
      (o) =>
        Math.abs(o.time - ideal) <= 1.2 &&
        o.time >= previous + minShot &&
        o.time <= duration - minShot,
    );
    const best = candidates.sort((a, b) => b.strength - a.strength)[0];
    const time = Math.max(previous + minShot, best ? best.time : ideal);
    const cut = Math.round(time * FPS) / FPS;
    if (cut >= duration - minShot) break;
    cuts.push(round3(cut));
    previous = cut;
  }
  return cuts;
}

// ---------------------------------------------------------------------------
// Shots (zoompan on still images)
// ---------------------------------------------------------------------------

export interface Shot {
  /** Which prepared still: the cover filling the frame, or the wide view (card on its background). */
  still: 'fill' | 'wide';
  frames: number;
  zoomFrom: number;
  zoomTo: number;
  /** Centre of the view in the still (0..1), at the start and at the end. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 'out': slow then fast at the start, settling at the end (reveal). */
  easing: 'linear' | 'out' | 'inout';
}

/** Frames of each shot from the cut times (whole frames, summing to the clip). */
export function shotFrames(cuts: number[], duration: number): number[] {
  const total = Math.round(duration * FPS);
  const bounds = [0, ...cuts.map((c) => Math.round(c * FPS)), total];
  return bounds.slice(1).map((b, i) => b - bounds[i]!);
}

/**
 * Shots of a style. `details`: most detailed points of the fill still;
 * `coverFocus`: most detailed point of the cover in the wide still.
 */
export function planShots(
  style: ReelStyle,
  options: {
    duration: number;
    cuts?: number[];
    details: { x: number; y: number }[];
    coverFocus: { x: number; y: number };
    /** Starting zoom of « Révélation » (3 for a square cover). */
    revealZoom?: number;
  },
): Shot[] {
  const total = Math.round(options.duration * FPS);
  const centre = { x: 0.5, y: 0.5 };
  const [a = centre, b = centre, c = centre] = options.details;
  const drift = (p: { x: number; y: number }, dx: number, dy: number) => ({
    x: round3(Math.min(0.9, Math.max(0.1, p.x + dx))),
    y: round3(Math.min(0.9, Math.max(0.1, p.y + dy))),
  });
  switch (style) {
    case 'reveal':
      // From a close-up of the cover's most detailed part to the whole card.
      return [
        {
          still: 'wide',
          frames: total,
          zoomFrom: round3(options.revealZoom ?? 3),
          zoomTo: 1,
          from: options.coverFocus,
          to: centre,
          easing: 'out',
        },
      ];
    case 'cuts': {
      const frames = shotFrames(options.cuts ?? [], options.duration);
      const cycle: Omit<Shot, 'frames'>[] = [
        {
          still: 'fill',
          zoomFrom: 2.1,
          zoomTo: 2.3,
          from: a,
          to: drift(a, 0.03, -0.02),
          easing: 'linear',
        },
        { still: 'wide', zoomFrom: 1.0, zoomTo: 1.07, from: centre, to: centre, easing: 'linear' },
        {
          still: 'fill',
          zoomFrom: 1.7,
          zoomTo: 1.6,
          from: b,
          to: drift(b, -0.04, 0.02),
          easing: 'linear',
        },
        {
          still: 'fill',
          zoomFrom: 1.0,
          zoomTo: 1.1,
          from: centre,
          to: drift(centre, 0, -0.03),
          easing: 'linear',
        },
        {
          still: 'fill',
          zoomFrom: 2.5,
          zoomTo: 2.7,
          from: c,
          to: drift(c, -0.02, 0.03),
          easing: 'linear',
        },
        { still: 'wide', zoomFrom: 1.12, zoomTo: 1.02, from: centre, to: centre, easing: 'linear' },
      ];
      return frames.map((count, i) => ({ ...cycle[i % cycle.length]!, frames: count }));
    }
    case 'hook':
      return [
        {
          still: 'fill',
          frames: total,
          zoomFrom: 1.05,
          zoomTo: 1.18,
          from: centre,
          to: drift(a, 0, 0),
          easing: 'inout',
        },
      ];
    case 'ambient':
      return [
        {
          still: 'fill',
          frames: total,
          zoomFrom: 1.0,
          zoomTo: 1.07,
          from: centre,
          to: drift(centre, 0.015, -0.015),
          easing: 'inout',
        },
      ];
  }
}

/** Progress 0..1 of a zoompan frame (variable `on`), eased. */
function easedProgress(shot: Shot): string {
  const p =
    shot.easing === 'out'
      ? `min(1,on/${Math.max(1, Math.round(shot.frames * 0.92))})`
      : `on/${Math.max(1, shot.frames - 1)}`;
  if (shot.easing === 'out') return `(1-pow(1-${p},3))`;
  if (shot.easing === 'inout') return `(0.5-0.5*cos(PI*${p}))`;
  return `(${p})`;
}

/** zoompan filter of a shot (output `width` × `height`). */
export function zoompanFilter(shot: Shot, width: number, height: number): string {
  const e = easedProgress(shot);
  const lerp = (from: number, to: number) => `(${from}+(${to - from})*${e})`;
  const z = lerp(shot.zoomFrom, shot.zoomTo);
  const x = `${lerp(shot.from.x, shot.to.x)}*iw-iw/zoom/2`;
  const y = `${lerp(shot.from.y, shot.to.y)}*ih-ih/zoom/2`;
  return (
    `zoompan=z='${z}':x='max(0,min(iw-iw/zoom,${x}))':y='max(0,min(ih-ih/zoom,${y}))'` +
    `:d=${shot.frames}:s=${width}x${height}:fps=${FPS}`
  );
}

// ---------------------------------------------------------------------------
// Text (ASS, rendered by libass)
// ---------------------------------------------------------------------------

/** Hook phrase: up to 3 lines, as big as possible up to `base`. */
export function hookFontSize(text: string, base: number, maxWidth: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  for (let size = base; size > 40; size -= 4) {
    const perLine = Math.floor(maxWidth / (0.58 * size));
    let lines = 1;
    let current = 0;
    for (const word of words) {
      const length = [...word].length;
      if (length > perLine) {
        lines = 99;
        break;
      }
      if (current === 0) current = length;
      else if (current + 1 + length <= perLine) current += 1 + length;
      else {
        lines++;
        current = length;
      }
    }
    if (lines <= 3) return size;
  }
  return 40;
}

/** Title and artist, discreet (no outline, faint shadow), plus the hook phrase of « Phrase d'accroche ». */
export function buildReelAss(params: {
  width: number;
  height: number;
  title: string;
  artist: string;
  /** 'light' = white text (dark background), 'dark' = near-black text. */
  tone: 'light' | 'dark';
  hook?: string;
  /** Seconds the hook phrase stays (then fades out). */
  hookSeconds?: number;
}): string {
  const k = params.width / REEL.width;
  const s = (n: number) => Math.max(1, Math.round(n * k));
  const { safe, text } = REEL;
  const left = s(safe.left);
  const maxWidth = params.width - left - s(safe.right);
  const title = escapeAssText(params.title);
  const artist = escapeAssText(params.artist).toUpperCase();
  const titleSize = fitFontSize(title, s(text.titleSize), maxWidth, s(34));
  const artistSize = fitFontSize(artist, s(text.artistSize), maxWidth, s(22));
  // ASS colours are &HAABBGGRR (alpha 00 = opaque).
  const main = params.tone === 'light' ? '&H00FFFFFF' : '&H00161616';
  const soft = params.tone === 'light' ? '&H14FFFFFF' : '&H14161616';
  const shadowColour = params.tone === 'light' ? '&H8C000000' : '&H8CFFFFFF';
  const hook = escapeAssText(params.hook ?? '');
  const hookSize = hook ? hookFontSize(hook, s(text.hookSize), maxWidth) : 0;
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${params.width}`,
    `PlayResY: ${params.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Title,Montserrat SemiBold,${titleSize},${main},${main},&H00000000,${shadowColour},0,0,0,0,100,100,0.5,0,1,0,${s(1)},7,${left},${s(safe.right)},0,1`,
    `Style: Artist,Montserrat SemiBold,${artistSize},${soft},${soft},&H00000000,${shadowColour},0,0,0,0,100,100,${s(3)},0,1,0,${s(1)},7,${left},${s(safe.right)},0,1`,
    // The hook phrase is big and white on the darkened cover; a soft shadow only.
    `Style: Hook,Montserrat SemiBold,${hookSize || 10},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,0,0,1,0,${s(3)},5,${left},${s(safe.right)},0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  if (title) {
    lines.push(
      `Dialogue: 0,0:00:00.00,9:59:59.00,Title,,0,0,0,,{\\pos(${left},${s(text.titleTop)})}${title}`,
    );
  }
  if (artist) {
    lines.push(
      `Dialogue: 0,0:00:00.00,9:59:59.00,Artist,,0,0,0,,{\\pos(${left},${s(text.artistTop)})}${artist}`,
    );
  }
  if (hook) {
    const end = params.hookSeconds ?? 4.5;
    const cx = Math.round(left + maxWidth / 2);
    const stamp = `0:00:${end.toFixed(2).padStart(5, '0')}`;
    lines.push(
      `Dialogue: 1,0:00:00.00,${stamp},Hook,,0,0,0,,{\\an5\\pos(${cx},${s(800)})\\fad(0,700)}${hook}`,
    );
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// FFmpeg arguments
// ---------------------------------------------------------------------------

/** The cover cropped to fill a `width` × `height` frame, never stretched. */
export function buildFillStillArgs(
  cover: string,
  output: string,
  width: number,
  height: number,
  offset: { x: number; y: number },
): string[] {
  return [
    ...['-v', 'error', '-y', '-i', cover],
    '-vf',
    `setsar=1,scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,` +
      `crop=${width}:${height}:x='(iw-ow)*${offset.x}':y='(ih-oh)*${offset.y}',setsar=1,format=rgb24`,
    ...['-frames:v', '1', output],
  ];
}

/** Wide view: the card (cover with rounded corners) on the colour-wash background. */
export function buildWideStillArgs(files: {
  background: string;
  card: string;
  centerY: number;
  output: string;
}): string[] {
  return [
    ...['-v', 'error', '-y', '-i', files.background, '-i', files.card],
    '-filter_complex',
    `[0:v][1:v]overlay=x=(W-w)/2:y=${files.centerY}-h/2,setsar=1,format=rgb24`,
    ...['-frames:v', '1', files.output],
  ];
}

/**
 * Soft darkening at the bottom (text and Instagram caption stay readable),
 * plus a stronger veil for « Phrase d'accroche » (`veil` 0..1).
 */
export function buildScrimArgs(
  output: string,
  width: number,
  height: number,
  veil: number,
): string[] {
  const alpha = `255*min(1,${veil}+0.62*clip((Y/H-0.55)/0.4,0,1))`;
  return [
    ...['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=black:s=${width}x${height}`],
    '-vf',
    `format=rgba,geq=r=0:g=0:b=0:a='${alpha}'`,
    ...['-frames:v', '1', output],
  ];
}

/** Floating dust: two layers of soft dots (fine and blurred), as a transparent PNG. */
export function buildDustArgs(output: string, width: number, height: number): string[] {
  const w4 = even(width / 4);
  const h4 = even(height / 4);
  const w8 = even(width / 8);
  const h8 = even(height / 8);
  const sigma = Math.max(1, Math.round((width / REEL.width) * 2.4 * 10) / 10);
  return [
    ...['-v', 'error', '-y'],
    ...['-f', 'lavfi', '-i', `color=black:s=${w4}x${h4}`],
    ...['-f', 'lavfi', '-i', `color=black:s=${w8}x${h8}`],
    ...['-f', 'lavfi', '-i', `color=white:s=${width}x${height}`],
    '-filter_complex',
    `[0:v]format=gray,geq=lum='255*lt(random(1),0.0016)',scale=${width}:${height}:flags=bicubic,gblur=sigma=${sigma}[fine];` +
      `[1:v]format=gray,geq=lum='170*lt(random(1),0.0018)',scale=${width}:${height}:flags=bicubic,gblur=sigma=${sigma * 3}[soft];` +
      `[fine][soft]blend=all_mode=lighten,lutyuv=y='min(255,val*2.4)'[mask];` +
      `[2:v]format=rgba[white];[white][mask]alphamerge`,
    ...['-frames:v', '1', output],
  ];
}

export interface ReelPlan {
  style: ReelStyle;
  width: number;
  height: number;
  duration: number;
  shots: Shot[];
  /** Encoding: null = preview quality. */
  encoding: { videoBitrate: string; maxrate: string; bufsize: string; gop: number } | null;
  /** Inputs relative to the work folder (cwd). */
  files: {
    fill: string;
    wide: string;
    scrim: string;
    dust?: string;
    ass: string;
    fontsDir: string;
    audio: string;
    output: string;
  };
}

/** The Reel: shots (zoompan) → [dust, grain, progress bar] → scrim → text → fade out. */
export function buildReelArgs(plan: ReelPlan): string[] {
  const { width: w, height: h, duration: d } = plan;
  const k = w / REEL.width;
  const frames = plan.shots.reduce((sum, shot) => sum + shot.frames, 0);
  const inputs: string[] = [];
  const add = (args: string[]) => {
    inputs.push(...args);
    return inputs.filter((a) => a === '-i').length - 1;
  };
  const fill = add(['-i', plan.files.fill]);
  const wide = add(['-i', plan.files.wide]);
  const scrim = add([
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-t',
    String(round3(d)),
    '-i',
    plan.files.scrim,
  ]);
  const dust = plan.files.dust
    ? add(['-loop', '1', '-framerate', String(FPS), '-t', String(round3(d)), '-i', plan.files.dust])
    : null;
  const audio = add(['-i', plan.files.audio]);

  const graph: string[] = [];
  const uses = { fill: plan.shots.filter((s) => s.still === 'fill').length, wide: 0 };
  uses.wide = plan.shots.length - uses.fill;
  const labels = { fill: [] as string[], wide: [] as string[] };
  for (const [still, index] of [
    ['fill', fill],
    ['wide', wide],
  ] as const) {
    const count = uses[still];
    if (count === 0) {
      graph.push(`[${index}:v]nullsink`);
      continue;
    }
    const names = Array.from({ length: count }, (_, i) => `${still}${i}`);
    labels[still] = names;
    graph.push(
      `[${index}:v]setsar=1,${count > 1 ? `split=${count}` : 'null'}${names.map((n) => `[${n}]`).join('')}`,
    );
  }
  const shotLabels = plan.shots.map((shot, i) => {
    const source = labels[shot.still].shift()!;
    graph.push(`[${source}]${zoompanFilter(shot, w, h)},setsar=1,format=yuv420p[s${i}]`);
    return `[s${i}]`;
  });
  graph.push(
    shotLabels.length > 1
      ? `${shotLabels.join('')}concat=n=${shotLabels.length}:v=1:a=0[shots]`
      : `${shotLabels[0]}null[shots]`,
  );

  let current = 'shots';
  const step = (filter: string) => {
    const next = `v${graph.length}`;
    graph.push(`[${current}]${filter}[${next}]`);
    current = next;
  };
  if (dust !== null) {
    // Two copies stacked: the layer scrolls up endlessly, with a slight sway.
    graph.push(`[${dust}:v]format=rgba,split[d1][d2];[d1][d2]vstack[dust]`);
    const next = `v${graph.length}`;
    graph.push(
      `[${current}][dust]overlay=x='${round3(8 * k)}*sin(t*0.6)':y='-mod(t*${round3(26 * k)},${h})':shortest=1:format=yuv420[${next}]`,
    );
    current = next;
  }
  {
    const next = `v${graph.length}`;
    graph.push(`[${scrim}:v]format=rgba[scrim]`);
    graph.push(`[${current}][scrim]overlay=0:0:shortest=1:format=yuv420[${next}]`);
    current = next;
  }
  if (plan.style === 'ambient') {
    // Fine progress bar: a faint track and the elapsed part, left-aligned in the safe zone.
    const barW = even(w - Math.round(REEL.safe.left * k) - Math.round(REEL.safe.right * k));
    const barH = Math.max(2, Math.round(REEL.bar.height * k));
    graph.push(
      `color=c=white:s=${barW}x${barH}:r=${FPS}:d=${round3(d)},format=rgba[barw];` +
        `color=c=black:s=${barW}x${barH}:r=${FPS}:d=${round3(d)},format=gray,` +
        `geq=lum='if(lt(X,W*T/${round3(d)}),225,55)'[bara];[barw][bara]alphamerge[bar]`,
    );
    const next = `v${graph.length}`;
    graph.push(
      `[${current}][bar]overlay=x=${Math.round(REEL.safe.left * k)}:y=${Math.round(REEL.bar.top * k)}:shortest=1:format=yuv420[${next}]`,
    );
    current = next;
    step(`noise=alls=14:allf=t+u`);
  } else {
    step(`noise=alls=5:allf=t`);
  }
  step(`subtitles=${plan.files.ass}:fontsdir=${plan.files.fontsDir}`);
  step(
    `fade=t=out:st=${round3(Math.max(0, d - REEL.fadeOut))}:d=${REEL.fadeOut},format=yuv420p,setsar=1`,
  );

  const quality = plan.encoding
    ? [
        ...['-preset', 'veryfast', '-profile:v', 'high'],
        ...['-b:v', plan.encoding.videoBitrate, '-maxrate', plan.encoding.maxrate],
        ...['-bufsize', plan.encoding.bufsize, '-g', String(plan.encoding.gop), '-bf', '2'],
      ]
    : ['-preset', 'ultrafast', '-crf', '28'];

  return [
    ...['-v', 'error', '-y'],
    ...inputs,
    '-filter_complex',
    graph.join(';'),
    ...['-map', `[${current}]`, '-map', `${audio}:a`],
    ...['-frames:v', String(frames), '-r', String(FPS)],
    ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...quality],
    ...['-c:a', 'copy', '-shortest'],
    ...['-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-f', 'mp4'],
    plan.files.output,
  ];
}
