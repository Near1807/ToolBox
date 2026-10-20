// Drawing of the Reels, frame by frame (canvas): the parts that never change
// (blurred background, title, artist) are drawn once; each frame then draws
// the cover at its scale of the moment (slow zoom + breathing on the bass,
// sub-pixel smooth) and the visualisation that follows its outline.
// Layout and geometry are pure and unit-tested; see docs/DIRECTION-ARTISTIQUE.md.
import type { Image, SKRSContext2D } from '@napi-rs/canvas';

/** Full-size layout (1080×1920): everything stays out of the Instagram zones. */
export const REEL_LAYOUT = {
  width: 1080,
  height: 1920,
  /** Instagram interface: nothing important in the 350 px at the bottom nor the 150 px on the right. */
  safe: { bottom: 350, right: 150, top: 220 },
  /** Box of the cover (its own ratio inside), centre of the cover. */
  cover: { size: 660, centerY: 800, radius: 28, shadowPad: 58, shadowOffset: 13 },
  /** Slow zoom over the whole clip, and breathing amplitude at full bass. */
  zoom: 0.02,
  breath: 0.018,
  /** Visualisation: gap from the cover's edge, longest bar (part of the cover's width), spacing. */
  bars: { gap: 8, maxLength: 0.05, spacing: 14, width: 3, opacity: 0.55 },
  title: { top: 1236, fontSize: 56, minFontSize: 32 },
  artist: { top: 1314, fontSize: 40, spacing: 4 },
  fadeSeconds: 0.5,
} as const;

/** Displayed size of the cover inside its box, ratio kept. */
export function coverSize(aspect: number, box: number): { width: number; height: number } {
  return aspect >= 1 ? { width: box, height: box / aspect } : { width: box * aspect, height: box };
}

/** Scale of the cover at a frame: slow zoom over the clip × breathing (envelope 0..1). */
export function coverScale(frame: number, frames: number, envelope: number): number {
  const progress = frames > 1 ? frame / (frames - 1) : 0;
  return (1 + REEL_LAYOUT.zoom * progress) * (1 + REEL_LAYOUT.breath * envelope);
}

export interface OutlinePoint {
  x: number;
  y: number;
  /** Outward normal (unit vector). */
  nx: number;
  ny: number;
  /** 0 at the bottom centre, 1 at the top centre, the same on both sides (mirror). */
  u: number;
}

/**
 * Points evenly spaced along a rounded rectangle (centre cx, cy), starting at
 * the bottom centre and going round, with their outward normals: straight on
 * the sides, radial in the rounded corners.
 */
export function outlinePoints(
  cx: number,
  cy: number,
  width: number,
  height: number,
  radius: number,
  count: number,
): OutlinePoint[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const w = width - 2 * r;
  const h = height - 2 * r;
  const arc = (Math.PI / 2) * r;
  // Path from the bottom centre, clockwise on screen (towards the left first).
  const segments: { length: number; at: (d: number) => Omit<OutlinePoint, 'u'> }[] = [];
  const line = (
    x0: number,
    y0: number,
    dx: number,
    dy: number,
    length: number,
    nx: number,
    ny: number,
  ) => segments.push({ length, at: (d) => ({ x: x0 + dx * d, y: y0 + dy * d, nx, ny }) });
  const corner = (ccx: number, ccy: number, from: number) =>
    segments.push({
      length: arc,
      at: (d) => {
        const a = from + (r > 0 ? d / r : 0);
        return {
          x: ccx + r * Math.cos(a),
          y: ccy + r * Math.sin(a),
          nx: Math.cos(a),
          ny: Math.sin(a),
        };
      },
    });
  const left = cx - width / 2;
  const right = cx + width / 2;
  const top = cy - height / 2;
  const bottom = cy + height / 2;
  line(cx, bottom, -1, 0, w / 2, 0, 1); // bottom, centre → left
  corner(left + r, bottom - r, Math.PI / 2); // bottom-left
  line(left, bottom - r, 0, -1, h, -1, 0); // left side, upwards
  corner(left + r, top + r, Math.PI); // top-left
  line(left + r, top, 1, 0, w, 0, -1); // top
  corner(right - r, top + r, (3 * Math.PI) / 2); // top-right
  line(right, top + r, 0, 1, h, 1, 0); // right side, downwards
  corner(right - r, bottom - r, 0); // bottom-right
  line(right - r, bottom, -1, 0, w / 2, 0, 1); // bottom, right → centre
  const total = segments.reduce((sum, s) => sum + s.length, 0);
  const points: OutlinePoint[] = [];
  for (let i = 0; i < count; i++) {
    let d = ((i + 0.5) / count) * total;
    const distance = d;
    let segment = 0;
    while (segment < segments.length - 1 && d > segments[segment]!.length) {
      d -= segments[segment]!.length;
      segment++;
    }
    const point = segments[segment]!.at(Math.min(d, segments[segment]!.length));
    points.push({ ...point, u: Math.min(distance, total - distance) / (total / 2) });
  }
  return points;
}

/** Spectrum value at position u (0 = bass, at the bottom; 1 = treble, at the top). */
export function bandAt(spectrum: Float32Array, u: number): number {
  const position = Math.min(1, Math.max(0, u)) * (spectrum.length - 1);
  const low = Math.floor(position);
  const high = Math.min(spectrum.length - 1, low + 1);
  const t = position - low;
  return spectrum[low]! * (1 - t) + spectrum[high]! * t;
}

/** Light colour from the cover's average colour (mixed with white), for the bars. */
export function lightTone(rgb: [number, number, number]): string {
  const mix = (c: number) => Math.round(c + (255 - c) * 0.6);
  return `rgb(${mix(rgb[0])}, ${mix(rgb[1])}, ${mix(rgb[2])})`;
}

export interface FrameAssets {
  /** Background with the title and the artist, drawn once. */
  still: Image | { width: number; height: number };
  /** Cover with rounded corners and shadow (PNG of buildCardArgs, supersampled). */
  card: Image;
  /** Size of the cover inside `card`, and the margin around it (shadow), in card pixels. */
  cardCover: { width: number; height: number; pad: number };
  /** Displayed cover size at scale 1 (output pixels). */
  cover: { width: number; height: number; radius: number };
  tone: string;
  /** Output pixels per full-size pixel (1 = 1080×1920, 1/3 = preview). */
  k: number;
}

/** Draws one frame: background + text, cover at its scale, bars around it. */
export function drawFrame(
  ctx: SKRSContext2D,
  assets: FrameAssets,
  scale: number,
  spectrum: Float32Array,
): void {
  const { k } = assets;
  const L = REEL_LAYOUT;
  ctx.drawImage(assets.still as Image, 0, 0);
  const cx = (L.width / 2) * k;
  const cy = L.cover.centerY * k;
  // Cover (with its shadow), scaled with sub-pixel precision.
  const ratio = (assets.cover.width * scale) / assets.cardCover.width;
  const cardW = assets.card.width * ratio;
  const cardH = assets.card.height * ratio;
  const coverTop = cy - (assets.cover.height * scale) / 2;
  ctx.drawImage(assets.card, cx - cardW / 2, coverTop - assets.cardCover.pad * ratio, cardW, cardH);
  // Bars along the outline, outwards; they follow the breathing.
  const w = assets.cover.width * scale;
  const h = assets.cover.height * scale;
  const perimeter = 2 * (w + h);
  const count = Math.max(24, Math.round(perimeter / (L.bars.spacing * k)));
  const maxLength = L.bars.maxLength * w;
  const gap = L.bars.gap * k;
  ctx.save();
  ctx.strokeStyle = assets.tone;
  ctx.globalAlpha = L.bars.opacity;
  ctx.lineWidth = Math.max(1, L.bars.width * k);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const p of outlinePoints(cx, cy, w, h, assets.cover.radius * scale, count)) {
    const length = maxLength * bandAt(spectrum, p.u) ** 1.2;
    if (length < 0.6 * k) continue;
    ctx.moveTo(p.x + p.nx * gap, p.y + p.ny * gap);
    ctx.lineTo(p.x + p.nx * (gap + length), p.y + p.ny * (gap + length));
  }
  ctx.stroke();
  ctx.restore();
}
