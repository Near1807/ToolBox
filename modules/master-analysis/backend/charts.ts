// Charts of the exported report, drawn on the server (@napi-rs/canvas) and
// embedded as PNG images: the report needs no script and opens anywhere.
// Print colours (white page); the interface's own charts use the theme.
import { type Canvas, createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { clock, fr } from '../shared/format';
import {
  bandCurve,
  integrated,
  loudnessCurve,
  monoLossCurve,
  widthCurve,
} from '../shared/measures';
import { BANDS, BLOCK, type Analysis, type Section } from '../shared/types';

const INK = '#1d1d24';
const MUTED = '#6b6b78';
const GRID = '#e6e6ee';
const ACCENT = '#5b4bd6';
const SECOND = '#d0653a';
const BAND_COLORS = ['#7b5cd6', '#2f8fd8', '#18a38a', '#d9a21b', '#e0663b', '#c2417a', '#6b6b78'];
const FONT = '18px sans-serif';
const SMALL = '15px sans-serif';
const WIDTH = 1600;
const LEFT = 220;
const RIGHT = 16;

type Series = (number | null)[] | Float32Array;

interface Lane {
  title: string;
  height: number;
  draw: (ctx: SKRSContext2D, x: number, y: number, w: number, h: number) => void;
}

const png = (canvas: Canvas) =>
  `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;

function frame(height: number) {
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, height);
  return { canvas, ctx };
}

/** One value per pixel column (the extreme of the column, never an interpolation). */
function line(
  ctx: SKRSContext2D,
  values: Series,
  box: { x: number; y: number; w: number; h: number },
  range: [number, number],
  color: string,
  options: { dashed?: boolean; from?: number; to?: number } = {},
) {
  const from = options.from ?? 0;
  const to = options.to ?? values.length;
  const n = Math.max(1, to - from);
  const [min, max] = range;
  const yOf = (v: number) =>
    box.y + (1 - (Math.max(min, Math.min(max, v)) - min) / (max - min)) * box.h;
  ctx.beginPath();
  let open = false;
  for (let px = 0; px < box.w; px++) {
    const i0 = from + Math.floor((px / box.w) * n);
    const i1 = Math.max(i0 + 1, from + Math.floor(((px + 1) / box.w) * n));
    let best: number | null = null;
    for (let i = i0; i < i1 && i < to; i++) {
      const v = values[i];
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      best = best === null ? v : Math.max(best, v);
    }
    if (best === null) {
      open = false;
      continue;
    }
    const x = box.x + px;
    if (open) ctx.lineTo(x, yOf(best));
    else ctx.moveTo(x, yOf(best));
    open = true;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.setLineDash(options.dashed ? [6, 4] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function grid(
  ctx: SKRSContext2D,
  box: { x: number; y: number; w: number; h: number },
  range: [number, number],
  ticks: number[],
  unit: string,
) {
  ctx.font = SMALL;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    const y = box.y + (1 - (t - range[0]) / (range[1] - range[0])) * box.h;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.x, y);
    ctx.lineTo(box.x + box.w, y);
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.fillText(`${fr(t, 0)}${unit}`, box.x - 6, y);
  }
}

function legend(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  items: { label: string; color: string }[],
) {
  ctx.font = SMALL;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let cy = y;
  for (const item of items) {
    ctx.fillStyle = item.color;
    ctx.fillRect(x, cy - 2, 14, 4);
    ctx.fillStyle = MUTED;
    ctx.fillText(item.label, x + 20, cy);
    cy += 19;
  }
}

/** Lanes stacked on the same time axis, a title and a legend on the left of each. */
function lanes(list: Lane[], seconds: number, sections: Section[] | null): string {
  const sectionRow = sections ? 30 : 0;
  const axis = 28;
  const gap = 14;
  const height = sectionRow + list.reduce((s, l) => s + l.height + gap, 0) + axis;
  const { canvas, ctx } = frame(height);
  const w = WIDTH - LEFT - RIGHT;
  let y = 0;
  if (sections) {
    ctx.font = SMALL;
    ctx.textBaseline = 'middle';
    sections.forEach((s, i) => {
      const x0 = LEFT + (s.start / seconds) * w;
      const x1 = LEFT + (s.end / seconds) * w;
      ctx.fillStyle = i % 2 ? '#ececf3' : '#f5f5f9';
      ctx.fillRect(x0, 4, Math.max(1, x1 - x0 - 2), 22);
      ctx.fillStyle = INK;
      ctx.textAlign = 'left';
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 4, Math.max(1, x1 - x0 - 4), 22);
      ctx.clip();
      ctx.fillText(s.label, x0 + 5, 15);
      ctx.restore();
    });
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'right';
    ctx.fillText('Sections', LEFT - 8, 15);
    y = sectionRow;
  }
  for (const lane of list) {
    ctx.fillStyle = INK;
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(lane.title, 8, y + 2);
    lane.draw(ctx, LEFT, y, w, lane.height);
    ctx.strokeStyle = GRID;
    ctx.strokeRect(LEFT, y, w, lane.height);
    y += lane.height + gap;
  }
  ctx.font = SMALL;
  ctx.fillStyle = MUTED;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  const step = seconds > 600 ? 120 : seconds > 240 ? 60 : seconds > 60 ? 30 : 10;
  for (let t = 0; t <= seconds; t += step) ctx.fillText(clock(t, 0), LEFT + (t / seconds) * w, y);
  return png(canvas);
}

/** Waveform, short-term loudness (and integrated), energy of the 7 bands. */
export function timelineChart(a: Analysis, sections: Section[]): string {
  const seconds = a.blocks * BLOCK;
  const short = loudnessCurve(a, 'short');
  const momentary = loudnessCurve(a, 'momentary');
  const total = integrated(a);
  return lanes(
    [
      {
        title: 'Forme d’onde',
        height: 140,
        draw: (ctx, x, y, w, h) => {
          ctx.fillStyle = ACCENT;
          const n = a.waveMax.length;
          for (let px = 0; px < w; px++) {
            const i0 = Math.floor((px / w) * n);
            const i1 = Math.max(i0 + 1, Math.floor(((px + 1) / w) * n));
            let hi = -1;
            let lo = 1;
            for (let i = i0; i < i1; i++) {
              hi = Math.max(hi, a.waveMax[i]!);
              lo = Math.min(lo, a.waveMin[i]!);
            }
            const top = y + h / 2 - (hi * h) / 2;
            const bottom = y + h / 2 - (lo * h) / 2;
            ctx.fillRect(x + px, top, 1, Math.max(1, bottom - top));
          }
        },
      },
      {
        title: 'Sonie (LUFS)',
        height: 170,
        draw: (ctx, x, y, w, h) => {
          const box = { x, y, w, h };
          grid(ctx, box, [-48, 0], [-48, -36, -24, -12, 0], '');
          line(ctx, momentary, box, [-48, 0], '#b8b0ee');
          line(ctx, short, box, [-48, 0], ACCENT);
          if (total !== null)
            line(ctx, Array(a.blocks).fill(total), box, [-48, 0], INK, { dashed: true });
          legend(ctx, 8, y + 40, [
            { label: 'Court terme (3 s)', color: ACCENT },
            { label: 'Momentanée (400 ms)', color: '#b8b0ee' },
            { label: `Intégrée ${fr(total)} LUFS`, color: INK },
          ]);
        },
      },
      {
        title: 'Énergie par bande (dB)',
        height: 210,
        draw: (ctx, x, y, w, h) => {
          const box = { x, y, w, h };
          grid(ctx, box, [-80, 0], [-80, -60, -40, -20, 0], '');
          BANDS.forEach((_, b) => line(ctx, bandCurve(a, b), box, [-80, 0], BAND_COLORS[b]!));
          legend(
            ctx,
            8,
            y + 32,
            BANDS.map((band, b) => ({
              label: `${band.label} ${band.from}–${band.to}`,
              color: BAND_COLORS[b]!,
            })),
          );
        },
      },
    ],
    seconds,
    sections,
  );
}

/** Frequencies over time (logarithmic), level from white (quiet) to dark (loud). */
export function spectrogramChart(a: Analysis): string {
  const s = a.spectrogram;
  const height = 320;
  const { canvas, ctx } = frame(height + 30);
  const w = WIDTH - LEFT - RIGHT;
  const image = ctx.createImageData(w, height);
  for (let px = 0; px < w; px++) {
    const f = Math.min(s.frames - 1, Math.floor((px / w) * s.frames));
    for (let py = 0; py < height; py++) {
      const bin = Math.min(s.bins - 1, Math.floor(((height - 1 - py) / height) * s.bins));
      const db = s.data[f * s.bins + bin]! / 2 - 120;
      const v = Math.max(0, Math.min(1, (db + 100) / 90));
      // White → violet → near black.
      const r = Math.round(255 - v * (255 - 40));
      const g = Math.round(255 - v * (255 - 24));
      const bl = Math.round(255 - v * (255 - 90));
      const o = (py * w + px) * 4;
      image.data[o] = r;
      image.data[o + 1] = g;
      image.data[o + 2] = bl;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, LEFT, 0);
  ctx.font = SMALL;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    if (f < s.fmin || f > s.fmax) continue;
    const y = height - (Math.log(f / s.fmin) / Math.log(s.fmax / s.fmin)) * height;
    ctx.fillText(f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`, LEFT - 6, y);
  }
  ctx.fillStyle = INK;
  ctx.font = 'bold 17px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Spectrogramme', 8, 12);
  const seconds = a.blocks * BLOCK;
  ctx.font = SMALL;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const step = seconds > 600 ? 120 : seconds > 240 ? 60 : seconds > 60 ? 30 : 10;
  for (let t = 0; t <= seconds; t += step)
    ctx.fillText(clock(t, 0), LEFT + (t / seconds) * w, height + 6);
  return png(canvas);
}

/** A spectrum on a logarithmic frequency axis (one or two series, the second dashed). */
export function spectrumChart(
  title: string,
  series: { label: string; points: { f: number; db: number | null }[] }[],
): string {
  const height = 350;
  const { canvas, ctx } = frame(height + 34);
  const w = WIDTH - LEFT - RIGHT;
  const box = { x: LEFT, y: 40, w, h: height - 40 };
  const values = series.flatMap((s) =>
    s.points.map((p) => p.db).filter((v): v is number => v !== null),
  );
  const max = Math.ceil((Math.max(...values, -100) + 3) / 6) * 6;
  const min = Math.max(max - 60, Math.floor((Math.min(...values, max - 12) - 3) / 6) * 6);
  const ticks = Array.from({ length: Math.floor((max - min) / 12) + 1 }, (_, i) => min + i * 12);
  grid(ctx, box, [min, max], ticks, ' dB');
  const xOf = (f: number) => box.x + (Math.log(f / 20) / Math.log(1000)) * box.w;
  series.forEach((s, k) => {
    ctx.beginPath();
    let open = false;
    for (const p of s.points) {
      if (p.db === null || p.f < 20 || p.f > 20000) {
        open = false;
        continue;
      }
      const y = box.y + (1 - (Math.max(min, Math.min(max, p.db)) - min) / (max - min)) * box.h;
      if (open) ctx.lineTo(xOf(p.f), y);
      else ctx.moveTo(xOf(p.f), y);
      open = true;
    }
    ctx.strokeStyle = k === 0 ? ACCENT : SECOND;
    ctx.lineWidth = 2;
    ctx.setLineDash(k === 0 ? [] : [7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  });
  ctx.font = SMALL;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000])
    ctx.fillText(f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`, xOf(f), height + 8);
  ctx.fillStyle = INK;
  ctx.font = 'bold 17px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, 8, 2);
  legend(
    ctx,
    8,
    44,
    series.map((s, k) => ({ label: s.label, color: k === 0 ? ACCENT : SECOND })),
  );
  return png(canvas);
}

/** Stereo width, phase correlation and mono loss over time. */
export function stereoChart(a: Analysis, sections: Section[]): string {
  const correlation = Array.from(a.correlation, (c, i) => (a.meanSquare[i]! > 1e-9 ? c : null));
  return lanes(
    [
      {
        title: 'Largeur stéréo (%)',
        height: 120,
        draw: (ctx, x, y, w, h) => {
          const box = { x, y, w, h };
          grid(ctx, box, [0, 100], [0, 25, 50, 75, 100], '');
          line(
            ctx,
            widthCurve(a, null).map((v) => (v === null ? null : v * 100)),
            box,
            [0, 100],
            ACCENT,
          );
        },
      },
      {
        title: 'Corrélation (−1 à +1)',
        height: 110,
        draw: (ctx, x, y, w, h) => {
          const box = { x, y, w, h };
          grid(ctx, box, [-1, 1], [-1, 0, 1], '');
          line(ctx, correlation, box, [-1, 1], '#18a38a');
        },
      },
      {
        title: 'Perte au mono (dB)',
        height: 110,
        draw: (ctx, x, y, w, h) => {
          const box = { x, y, w, h };
          grid(ctx, box, [-12, 0], [-12, -6, -3, 0], '');
          line(ctx, monoLossCurve(a), box, [-12, 0], SECOND);
        },
      },
    ],
    a.blocks * BLOCK,
    sections,
  );
}

/**
 * Sections × (loudness, bands): differences with the whole track as a grid
 * of numbers, the cell shaded by the size of the difference (blue below,
 * red above, white near 0).
 */
export function contrastsChart(
  rows: { label: string; values: (number | null)[] }[],
  columns: string[],
): string {
  const cellW = Math.floor((WIDTH - LEFT - RIGHT) / columns.length);
  const cellH = 34;
  const top = 34;
  const { canvas, ctx } = frame(top + rows.length * cellH + 10);
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  columns.forEach((c, j) => ctx.fillText(c, LEFT + j * cellW + cellW / 2, top / 2));
  rows.forEach((row, i) => {
    const y = top + i * cellH;
    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.font = FONT;
    ctx.fillText(row.label, LEFT - 10, y + cellH / 2);
    row.values.forEach((v, j) => {
      const x = LEFT + j * cellW;
      const t = v === null ? 0 : Math.min(1, Math.abs(v) / 12);
      const [r, g, b] = v !== null && v >= 0 ? [224, 102, 59] : [47, 143, 216];
      ctx.fillStyle = `rgb(${Math.round(255 - t * (255 - r))}, ${Math.round(255 - t * (255 - g))}, ${Math.round(255 - t * (255 - b))})`;
      ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.fillText(fr(v, 1, true), x + cellW / 2, y + cellH / 2);
    });
  });
  return png(canvas);
}

/** Short-term loudness of two aligned versions. */
export function versionsChart(
  overlay: { t: number; a: number | null; b: number | null }[],
  names: { a: string; b: string },
): string {
  const seconds = overlay.at(-1)?.t ?? 1;
  return lanes(
    [
      {
        title: 'Sonie court terme (LUFS)',
        height: 200,
        draw: (ctx, x, y, w, h) => {
          const box = { x, y, w, h };
          grid(ctx, box, [-48, 0], [-48, -36, -24, -12, 0], '');
          line(
            ctx,
            overlay.map((p) => p.a),
            box,
            [-48, 0],
            SECOND,
            { dashed: true },
          );
          line(
            ctx,
            overlay.map((p) => p.b),
            box,
            [-48, 0],
            ACCENT,
          );
          legend(ctx, 8, y + 40, [
            { label: names.b, color: ACCENT },
            { label: `${names.a} (pointillés)`, color: SECOND },
          ]);
        },
      },
    ],
    seconds,
    null,
  );
}
