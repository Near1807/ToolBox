// v0.44.0: paints a scene of the calendar's image (snapshot.ts) on a 2D
// canvas: the page's <canvas> on the PC and the phone, @napi-rs/canvas in
// the tests. The theme's colours come resolved (SnapshotColors): no colour is
// written here. Pure apart from the canvas it is given.
import { blockInk, isFreeColor, mix, type Rgb } from './palette';
import { cssOf, over, parseRgba, type Rgba, substitute } from './snapshot-color';
import type { Paint, Scene, Shape, TextPart } from './snapshot';

/** What the painter uses of a 2D context (the browser's, or @napi-rs/canvas'). */
export interface Canvas2D {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  textBaseline: string;
  globalAlpha: number;
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  setLineDash(segments: number[]): void;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
}

/** The theme's colours, read before painting (the app's theme, or « Clair »). */
export interface SnapshotColors {
  /** The image's background (the theme's solid surface). */
  surface: Rgb;
  /** The theme's background (the other ink of a block on a free colour). */
  bg: Rgb;
  text: Rgb;
  text2: Rgb;
  text3: Rgb;
  /** The lines, already laid over the surface. */
  border: Rgb;
  borderStrong: Rgb;
  /** A category's colour (« var(--…) » or « #rrggbb ») as numbers; null: not readable. */
  color(css: string): Rgb | null;
  /** The theme's font family (« 'Inter Variable', system-ui, sans-serif »). */
  font: string;
}

function paintOf(p: Paint, c: SnapshotColors): string {
  if ('token' in p) {
    const rgb = {
      '--text': c.text,
      '--text-2': c.text2,
      '--text-3': c.text3,
      '--border': c.border,
      '--border-strong': c.borderStrong,
    }[p.token];
    return cssOf(rgb);
  }
  if ('color' in p) return cssOf(c.color(p.color) ?? c.text2);
  if ('tint' in p) return cssOf(mix(c.color(p.tint) ?? c.text3, c.surface, p.share));
  // The ink: the theme's text, unless a free colour reads better with the background.
  const rgb = isFreeColor(p.ink) ? c.color(p.ink) : null;
  const ink = rgb ? blockInk(rgb, c.surface, { text: c.text, other: c.bg }).ink : 'text';
  return cssOf(ink === 'other' ? c.bg : c.text);
}

function roundRect(ctx: Canvas2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const fontOf = (part: TextPart, family: string) => `${part.weight} ${part.size}px ${family}`;

/** `text` cut to `width` with « … » (nothing when not even « … » fits). */
function ellipsize(ctx: Canvas2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo ? `${text.slice(0, lo).trimEnd()}…` : '';
}

/** The lines of a text wrapped to `width` (a word too long is cut). */
function wrap(ctx: Canvas2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function paintText(ctx: Canvas2D, s: Extract<Shape, { t: 'text' }>, c: SnapshotColors) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(s.x, s.y, s.w, s.h);
  ctx.clip();
  ctx.textBaseline = 'top';
  const strike = (x: number, y: number, w: number, size: number) =>
    ctx.fillRect(x, y + size * 0.55, w, Math.max(1, size / 12));
  if (s.inline) {
    let x = s.x;
    s.parts.forEach((part, k) => {
      ctx.font = fontOf(part, c.font);
      ctx.fillStyle = paintOf(part.paint, c);
      const room = s.x + s.w - x;
      const text = ellipsize(ctx, part.text, room);
      if (!text) return;
      ctx.fillText(text, x, s.y);
      const w = ctx.measureText(text).width;
      if (part.strike) strike(x, s.y, w, part.size);
      x += w + (k < s.parts.length - 1 ? part.size * 0.4 : 0);
    });
    ctx.restore();
    return;
  }
  let y = s.y;
  const bottom = s.y + s.h;
  for (const part of s.parts) {
    ctx.font = fontOf(part, c.font);
    ctx.fillStyle = paintOf(part.paint, c);
    const lineH = part.size * 1.22;
    const lines = wrap(ctx, part.text, s.w);
    for (let k = 0; k < lines.length; k++) {
      if (y + lineH > bottom + part.size * 0.15) {
        ctx.restore();
        return;
      }
      // The last line that fits, with more after it: ended by « … ».
      const more = k < lines.length - 1 && y + 2 * lineH > bottom + part.size * 0.15;
      const text = more
        ? ellipsize(ctx, `${lines[k]!} ${lines[k + 1]!}`, s.w)
        : ellipsize(ctx, lines[k]!, s.w);
      const measured = ctx.measureText(text).width;
      const x =
        s.align === 'center'
          ? s.x + (s.w - measured) / 2
          : s.align === 'right'
            ? s.x + s.w - measured
            : s.x;
      ctx.fillText(text, x, y);
      if (part.strike) strike(x, y, measured, part.size);
      y += lineH;
      if (more) {
        ctx.restore();
        return;
      }
    }
  }
  ctx.restore();
}

function paintShape(ctx: Canvas2D, s: Shape, c: SnapshotColors) {
  switch (s.t) {
    case 'rect': {
      ctx.save();
      ctx.globalAlpha = s.alpha ?? 1;
      roundRect(ctx, s.x, s.y, s.w, s.h, s.r ?? 0);
      if (s.fill) {
        ctx.fillStyle = paintOf(s.fill, c);
        ctx.fill();
      }
      if (s.hatch) {
        // « Facultatif »: stripes at 135°, every 12 units (6 of each paint).
        ctx.save();
        roundRect(ctx, s.x, s.y, s.w, s.h, s.r ?? 0);
        ctx.clip();
        ctx.strokeStyle = paintOf(s.hatch, c);
        ctx.lineWidth = 6;
        ctx.beginPath();
        for (let k = -s.h; k < s.w + s.h; k += 12) {
          ctx.moveTo(s.x + k, s.y);
          ctx.lineTo(s.x + k + s.h, s.y + s.h);
        }
        ctx.stroke();
        ctx.restore();
      }
      if (s.stroke) {
        ctx.strokeStyle = paintOf(s.stroke, c);
        ctx.lineWidth = 1;
        ctx.setLineDash(s.dashed ? [4, 3] : []);
        roundRect(ctx, s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1, s.r ?? 0);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (s.bar) {
        ctx.save();
        roundRect(ctx, s.x, s.y, s.w, s.h, s.r ?? 0);
        ctx.clip();
        ctx.fillStyle = paintOf(s.bar, c);
        if (s.barDashed) for (let y = s.y; y < s.y + s.h; y += 6) ctx.fillRect(s.x, y, 3, 4);
        else ctx.fillRect(s.x, s.y, 3, s.h);
        ctx.restore();
      }
      ctx.restore();
      return;
    }
    case 'line':
      ctx.strokeStyle = paintOf(s.paint, c);
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      return;
    case 'text':
      paintText(ctx, s, c);
      return;
    case 'dot':
      ctx.fillStyle = paintOf(s.paint, c);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'alert': {
      // lucide « circle-alert »: a circle, a bar, a dot.
      const r = s.size / 2;
      const cx = s.x + r;
      const cy = s.y + r;
      const paint = paintOf(s.paint, c);
      ctx.strokeStyle = paint;
      ctx.fillStyle = paint;
      ctx.lineWidth = s.size / 12;
      ctx.beginPath();
      ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(cx - s.size / 24, cy - r * 0.5, s.size / 12, r * 0.6);
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.42, s.size / 18, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
  }
}

/** Paints the whole scene, its background first, at the scene's scale. */
export function paintScene(ctx: Canvas2D, scene: Scene, colors: SnapshotColors): void {
  ctx.save();
  ctx.scale(scene.scale, scene.scale);
  ctx.fillStyle = cssOf(colors.surface);
  ctx.fillRect(0, 0, scene.width, scene.height);
  for (const shape of scene.shapes) paintShape(ctx, shape, colors);
  ctx.restore();
}

/**
 * The image's colours from a theme's tokens (`lookup`: « --text » → its
 * value). `normalize` reads a value the parser does not know (the browser
 * turns any CSS colour into « #rrggbb » or « rgba(…) »); null when the theme
 * lacks one of its base tokens.
 */
export function snapshotColors(
  lookup: (name: string) => string | undefined,
  normalize: (css: string) => string | null = () => null,
): SnapshotColors | null {
  const read = (css: string): Rgba | null => {
    const value = substitute(css, lookup);
    if (value === null) return null;
    return parseRgba(value) ?? parseRgba(normalize(value) ?? '');
  };
  const bg = read('var(--bg)');
  if (!bg) return null;
  const solid = read('var(--surface-solid)') ?? read('var(--surface)');
  const surface = solid ? over(solid, bg.rgb) : bg.rgb;
  const on = (name: string, fallback: Rgba | null = null): Rgb | null => {
    const v = read(`var(${name})`) ?? fallback;
    return v ? over(v, surface) : null;
  };
  const text = on('--text');
  const text2 = on('--text-2') ?? text;
  const text3 = on('--text-3') ?? text2;
  const border = on('--border');
  const borderStrong = on('--border-strong') ?? border;
  const family = substitute('var(--font-sans)', lookup)?.trim();
  if (!text || !text2 || !text3 || !border || !borderStrong) return null;
  const cache = new Map<string, Rgb | null>();
  return {
    surface,
    bg: bg.rgb,
    text,
    text2,
    text3,
    border,
    borderStrong,
    color(css) {
      if (!cache.has(css)) {
        const v = read(css);
        cache.set(css, v ? over(v, surface) : null);
      }
      return cache.get(css)!;
    },
    font: family || 'system-ui, sans-serif',
  };
}
