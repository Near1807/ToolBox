// v0.44.0 (Expérimental, ADR 0050): the image of the calendar Thomas sends
// (« voilà mes dispos »). Not a screenshot: a drawing of its own, built here
// as a list of shapes and texts (pure, the same on the PC and the phone,
// tested without a browser), then painted by snapshot-paint.ts.
//
// What it holds: the period shown (week, month, or the phone's day), the
// categories switched on only, the whole range of hours of the period (never
// cut by the scroll), the blocks placed as on the screen. Nothing of the
// interface (no sheet, preview, handle, « À caser », load). Two modes:
// « Détails » (titles and places), « Dispos seulement » (every block reads
// « Occupé », no title, place nor note; no deadline, no legend).
import { placeDay } from './load';
import {
  addDays,
  daysBetween,
  minutesBetween,
  minutesOfDay,
  MONTHS,
  weekday,
  WEEKDAYS,
} from './time';

export type SnapshotView = 'week' | 'month' | 'day';
export type SnapshotMode = 'details' | 'busy';

/** One element of the period, as the image needs it (the switches already applied). */
export interface SnapshotItem {
  id: string;
  title: string;
  /** « YYYY-MM-DD » (all day) or « YYYY-MM-DDTHH:mm ». */
  start: string;
  end: string;
  allDay: boolean;
  category: string;
  location: string | null;
  /** The Agenda's own, another tool's (lighter, dashed), a planned task of the To-do. */
  source: 'own' | 'foreign' | 'task';
  deadline?: boolean;
  optional?: boolean;
  done?: boolean;
}

export interface SnapshotInput {
  view: SnapshotView;
  mode: SnapshotMode;
  /** The days drawn: a week (Monday … Sunday), the month's whole weeks, or one day. */
  from: string;
  to: string;
  /** The month (« YYYY-MM ») of a month view: its other days are dimmed. */
  month?: string;
  items: readonly SnapshotItem[];
  /** The Agenda's range (Réglages): the image shows at least these hours. */
  dayStartHour: number;
  dayEndHour: number;
  /** A category's colour, as a CSS value (« var(--series-2) », « #rrggbb »). */
  colorOf: (category: string) => string;
  /** Thomas's order of the categories (the legend's), else by name. */
  order?: readonly string[];
}

/** A colour of the drawing: a theme token, a category's colour, or a tint of it on the surface. */
export type Paint =
  | { token: '--text' | '--text-2' | '--text-3' | '--border' | '--border-strong' }
  | { color: string }
  | { tint: string; share: number }
  /** The text that reads best on a tint of this colour (the theme's text, or its background). */
  | { ink: string };

export interface TextPart {
  text: string;
  size: number;
  weight: 400 | 600 | 700;
  paint: Paint;
  strike?: boolean;
}

export type Shape =
  | {
      t: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      r?: number;
      fill?: Paint;
      /** Stripes (« facultatif »): this second paint, every 6 units at 135°. */
      hatch?: Paint;
      stroke?: Paint;
      dashed?: boolean;
      /** The category's bar on the left side (3 units). */
      bar?: Paint;
      barDashed?: boolean;
      alpha?: number;
    }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; paint: Paint; width: number }
  /**
   * Texts in a box: each part on a new line, wrapped to the width, the last
   * visible line ended by « … »; what does not fit in `h` is not drawn.
   */
  | {
      t: 'text';
      x: number;
      y: number;
      w: number;
      h: number;
      parts: TextPart[];
      align?: 'left' | 'center' | 'right';
      /** Several parts on ONE line, separated by a space (a chip of the month). */
      inline?: boolean;
    }
  /** The « circle-alert » icon of the deadlines. */
  | { t: 'alert'; x: number; y: number; size: number; paint: Paint }
  | { t: 'dot'; x: number; y: number; r: number; paint: Paint };

export interface Scene {
  /** In units; the image is drawn at `scale` pixels per unit. */
  width: number;
  height: number;
  scale: number;
  title: string;
  shapes: Shape[];
  /** The categories in the legend (none in « Dispos seulement »). */
  legend: string[];
  /** The hours drawn (week and day). */
  hours?: { start: number; end: number };
}

/** « Occupé »: the only words a block says in « Dispos seulement ». */
export const BUSY = 'Occupé';

// --- Sizes (units; ×2 in the PNG) ---------------------------------------------
const PAD = 24;
const WIDE = 800;
const NARROW = 480;
const SCALE = 2;
const GUTTER = 46;
const HOUR = 42;
const HEAD = 26;
const BAND = 20;
const BAND_GAP = 3;
const TITLE = 22;
const SMALL = 10.5;
const BLOCK = 12;
/** A block is never thinner than this (a 10-minute event stays visible). */
const MIN_BLOCK = 13;

const WEEKDAYS_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dayNumber = (day: string) => {
  const n = Number(day.slice(8, 10));
  return n === 1 ? '1er' : String(n);
};
const monthName = (day: string) => MONTHS[Number(day.slice(5, 7)) - 1]!;

/** « Semaine du 23 au 29 novembre 2026 », « Novembre 2026 », « Lundi 23 novembre 2026 ». */
export function snapshotTitle(
  view: SnapshotView,
  from: string,
  to: string,
  month?: string,
): string {
  if (view === 'month') {
    const m = month ?? addDays(from, 7).slice(0, 7);
    return `${cap(MONTHS[Number(m.slice(5, 7)) - 1]!)} ${m.slice(0, 4)}`;
  }
  if (view === 'day')
    return `${cap(WEEKDAYS[weekday(from)]!)} ${dayNumber(from)} ${monthName(from)} ${from.slice(0, 4)}`;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7);
  const first = sameMonth
    ? dayNumber(from)
    : `${dayNumber(from)} ${monthName(from)}${sameYear ? '' : ` ${from.slice(0, 4)}`}`;
  return `Semaine du ${first} au ${dayNumber(to)} ${monthName(to)} ${to.slice(0, 4)}`;
}

/** The days an item touches (an all-day one: its last day included; a timed one ending at 00:00: not that day). */
function touches(item: SnapshotItem, day: string): boolean {
  const first = item.start.slice(0, 10);
  if (item.allDay) return first <= day && item.end.slice(0, 10) >= day;
  if (item.deadline) return first === day;
  const endDay =
    item.end.slice(11) === '00:00' && item.end > item.start
      ? addDays(item.end.slice(0, 10), -1)
      : item.end.slice(0, 10);
  return first <= day && endDay >= day;
}

/** « 08:15–10:00 » (a block of one day), « 23:59 » (a moment). */
function timeText(item: SnapshotItem): string {
  if (item.start === item.end) return item.start.slice(11);
  const end = item.end.slice(0, 10) === item.start.slice(0, 10) ? item.end.slice(11) : '24:00';
  return `${item.start.slice(11)}–${end}`;
}

/** What a block, a band or a chip says in each mode. */
function words(item: SnapshotItem, mode: SnapshotMode) {
  if (mode === 'busy') return { title: item.optional ? `${BUSY} (facultatif)` : BUSY, place: null };
  const place = item.location?.trim() || null;
  return { title: item.title, place };
}

/** Lanes for the bands of the « Journée » row: an item never overlaps another in its lane. */
function bandLanes<T extends { first: number; last: number }>(
  bands: T[],
): (T & { lane: number })[] {
  const ends: number[] = [];
  return bands
    .slice()
    .sort((a, b) => a.first - b.first || b.last - a.last)
    .map((b) => {
      let lane = ends.findIndex((end) => end < b.first);
      if (lane < 0) lane = ends.push(b.last) - 1;
      else ends[lane] = b.last;
      return { ...b, lane };
    });
}

/** Rough width of a text (the legend's layout; the painter measures for real). */
const textWidth = (text: string, size: number) => text.length * size * 0.56;

function legendShapes(
  names: string[],
  input: SnapshotInput,
  x: number,
  y: number,
  width: number,
): { shapes: Shape[]; height: number } {
  if (!names.length) return { shapes: [], height: 0 };
  const shapes: Shape[] = [];
  const size = 12;
  const row = 20;
  let cx = x;
  let cy = y;
  for (const name of names) {
    const w = 14 + Math.min(textWidth(name, size), 220) + 18;
    if (cx > x && cx + w > x + width) {
      cx = x;
      cy += row;
    }
    shapes.push({
      t: 'dot',
      x: cx + 5,
      y: cy + row / 2,
      r: 5,
      paint: { color: input.colorOf(name) },
    });
    shapes.push({
      t: 'text',
      x: cx + 14,
      y: cy + 3,
      w: w - 18,
      h: row,
      parts: [{ text: name, size, weight: 400, paint: { token: '--text-2' } }],
    });
    cx += w;
  }
  return { shapes, height: cy - y + row };
}

/** The legend's categories: those drawn, in Thomas's order (else by name). */
function legendOf(items: readonly SnapshotItem[], order: readonly string[] = []): string[] {
  const names = [...new Set(items.map((i) => i.category))];
  const rank = (n: string) => {
    const i = order.indexOf(n);
    return i < 0 ? order.length : i;
  };
  return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'fr'));
}

/** The block of a timed item: tint of its category, its bar, its texts. */
function blockShapes(
  item: Placed,
  mode: SnapshotMode,
  x: number,
  y: number,
  w: number,
  h: number,
): Shape[] {
  const color = item.colorCss;
  const { title, place } = words(item, mode);
  const foreign = item.source === 'foreign';
  const ink: Paint = { ink: color };
  const short = h < 30;
  const parts: TextPart[] = short
    ? [
        {
          text: `${item.start.slice(11)} ${title}`,
          size: SMALL,
          weight: 600,
          paint: ink,
          strike: item.done,
        },
      ]
    : [
        { text: timeText(item), size: SMALL, weight: 400, paint: { token: '--text-2' } },
        { text: title, size: BLOCK, weight: 600, paint: ink, strike: item.done },
        ...(place
          ? [{ text: place, size: SMALL, weight: 400, paint: { token: '--text-2' } } as TextPart]
          : []),
      ];
  return [
    {
      t: 'rect',
      x,
      y,
      w,
      h,
      r: 5,
      fill: { tint: color, share: item.optional ? 0.22 : foreign ? 0.14 : 0.3 },
      ...(item.optional ? { hatch: { tint: color, share: 0.08 } as Paint } : {}),
      ...(foreign ? { stroke: { token: '--border-strong' } as Paint, dashed: true } : {}),
      bar: { color },
      barDashed: Boolean(item.optional),
      ...(item.optional || item.done ? { alpha: 0.75 } : {}),
    },
    { t: 'text', x: x + 6, y: y + 3, w: w - 8, h: h - 4, parts },
  ];
}

type Placed = SnapshotItem & { colorCss: string };

/** The week (7 columns) or the phone's day (1 column): hours, bands, blocks, deadlines. */
function timeGrid(input: SnapshotInput, items: Placed[], days: string[], width: number): Scene {
  const busy = input.mode === 'busy';
  const title = snapshotTitle(input.view, input.from, input.to, input.month);
  const shapes: Shape[] = [];
  shapes.push({
    t: 'text',
    x: PAD,
    y: PAD - 4,
    w: width - 2 * PAD,
    h: TITLE + 8,
    parts: [{ text: title, size: TITLE, weight: 700, paint: { token: '--text' } }],
  });
  let top = PAD + TITLE + 10;
  if (busy) {
    shapes.push({
      t: 'text',
      x: PAD,
      y: top - 4,
      w: width - 2 * PAD,
      h: 18,
      parts: [{ text: 'Créneaux occupés', size: 13, weight: 400, paint: { token: '--text-2' } }],
    });
    top += 16;
  }
  top += 8;

  const colX = PAD + GUTTER;
  const colW = (width - 2 * PAD - GUTTER) / days.length;
  const inDays = (i: Placed) => days.some((d) => touches(i, d));
  const allDay = items.filter((i) => i.allDay && !i.deadline && inDays(i));
  const dayDeadlines = items.filter((i) => i.allDay && i.deadline && inDays(i));
  const timed = items.filter((i) => !i.allDay && !i.deadline && inDays(i));
  const lines = items.filter((i) => !i.allDay && i.deadline && inDays(i));

  // The hours: from the first to the last element, rounded to the hour, the Agenda's range at least.
  let start = input.dayStartHour;
  let end = input.dayEndHour;
  for (const d of days) {
    for (const i of timed.filter((t) => touches(t, d))) {
      const from = Math.max(0, minutesBetween(`${d}T00:00`, i.start));
      const to = Math.min(24 * 60, minutesBetween(`${d}T00:00`, i.end));
      start = Math.min(start, Math.floor(from / 60));
      end = Math.max(end, Math.ceil(to / 60));
    }
    for (const i of lines.filter((t) => t.start.slice(0, 10) === d)) {
      const at = minutesOfDay(i.start.slice(11));
      start = Math.min(start, Math.floor(at / 60));
      end = Math.max(end, Math.min(24, Math.floor(at / 60) + 1));
    }
  }
  start = Math.max(0, start);
  end = Math.min(24, Math.max(end, start + 1));

  // Day heads (one day: its title says it).
  if (days.length > 1)
    days.forEach((d, i) => {
      shapes.push({
        t: 'text',
        x: colX + i * colW,
        y: top,
        w: colW,
        h: HEAD,
        align: 'center',
        parts: [
          {
            text: `${WEEKDAYS_SHORT[weekday(d)]} ${dayNumber(d)}`,
            size: 13,
            weight: 600,
            paint: { token: '--text' },
          },
        ],
      });
    });
  if (days.length > 1) top += HEAD;
  shapes.push({
    t: 'line',
    x1: colX,
    y1: top,
    x2: width - PAD,
    y2: top,
    paint: { token: '--border-strong' },
    width: 1,
  });

  // « Journée »: bands over their days (several days: one band), deadlines without a time.
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const bands = bandLanes(
    [...allDay, ...dayDeadlines].map((i) => {
      const a = i.start.slice(0, 10) < first ? first : i.start.slice(0, 10);
      const b = i.deadline ? a : i.end.slice(0, 10) > last ? last : i.end.slice(0, 10);
      return { item: i, first: daysBetween(first, a), last: daysBetween(first, b) };
    }),
  );
  if (bands.length) {
    const laneCount = Math.max(...bands.map((b) => b.lane)) + 1;
    const rowH = laneCount * (BAND + BAND_GAP) + BAND_GAP;
    shapes.push({
      t: 'text',
      x: PAD,
      y: top + 5,
      w: GUTTER - 4,
      h: 14,
      parts: [{ text: 'Journée', size: SMALL, weight: 400, paint: { token: '--text-3' } }],
    });
    for (const b of bands) {
      const i = b.item;
      const x = colX + b.first * colW + 2;
      const w = (b.last - b.first + 1) * colW - 4;
      const y = top + BAND_GAP + b.lane * (BAND + BAND_GAP);
      const { title } = words(i, input.mode);
      const before = !i.deadline && i.start.slice(0, 10) < first ? '← ' : '';
      const after = !i.deadline && i.end.slice(0, 10) > last ? ' →' : '';
      shapes.push({
        t: 'rect',
        x,
        y,
        w,
        h: BAND,
        r: 5,
        fill: { tint: i.colorCss, share: i.source === 'foreign' ? 0.14 : 0.28 },
        ...(i.optional ? { hatch: { tint: i.colorCss, share: 0.08 } as Paint } : {}),
        ...(i.source === 'foreign'
          ? { stroke: { token: '--border-strong' } as Paint, dashed: true }
          : {}),
        bar: { color: i.colorCss },
        barDashed: Boolean(i.optional),
        ...(i.done || i.optional ? { alpha: 0.75 } : {}),
      });
      if (i.deadline)
        shapes.push({ t: 'alert', x: x + 6, y: y + 4, size: 12, paint: { color: i.colorCss } });
      shapes.push({
        t: 'text',
        x: x + (i.deadline ? 22 : 7),
        y: y + 3,
        w: w - (i.deadline ? 26 : 10),
        h: BAND - 2,
        parts: [
          {
            text: `${before}${title}${after}`,
            size: SMALL + 0.5,
            weight: 600,
            paint: { ink: i.colorCss },
            strike: i.done,
          },
        ],
      });
    }
    top += rowH;
    shapes.push({
      t: 'line',
      x1: colX,
      y1: top,
      x2: width - PAD,
      y2: top,
      paint: { token: '--border-strong' },
      width: 1,
    });
  }

  // The hours and their lines; the columns.
  const gridTop = top;
  const gridH = (end - start) * HOUR;
  for (let h = start; h <= end; h++) {
    const y = gridTop + (h - start) * HOUR;
    shapes.push({
      t: 'line',
      x1: colX,
      y1: y,
      x2: width - PAD,
      y2: y,
      paint: { token: '--border' },
      width: 1,
    });
    if (h < end)
      shapes.push({
        t: 'text',
        x: PAD,
        y: y + 2,
        w: GUTTER - 8,
        h: 14,
        parts: [
          {
            text: `${String(h).padStart(2, '0')}:00`,
            size: SMALL,
            weight: 400,
            paint: { token: '--text-3' },
          },
        ],
      });
  }
  for (let c = 0; c <= days.length; c++) {
    const x = colX + c * colW;
    shapes.push({
      t: 'line',
      x1: x,
      y1: gridTop,
      x2: x,
      y2: gridTop + gridH,
      paint: { token: '--border' },
      width: 1,
    });
  }

  // The blocks, side by side when they overlap (as on the screen).
  days.forEach((d, c) => {
    const mine = timed.filter((i) => touches(i, d));
    const placed = placeDay(
      d,
      mine.map((i) => ({
        id: i.id,
        start: i.start,
        end: i.end,
        category: i.category,
        optional: i.optional,
      })),
    );
    for (const p of placed) {
      const item = mine.find((i) => i.id === p.id)!;
      const from = Math.max(p.from, start * 60);
      const to = Math.min(p.to, end * 60);
      if (to <= from) continue;
      const laneW = (colW - 4) / p.lanes;
      const x = colX + c * colW + 2 + p.lane * laneW;
      const y = gridTop + ((from - start * 60) / 60) * HOUR + 1;
      const h = Math.max(MIN_BLOCK, ((to - from) / 60) * HOUR - 2);
      shapes.push(...blockShapes(item, input.mode, x, y, laneW - 2, h));
    }
  });
  // Deadlines with a time: a line across the day, its icon, title and time (over the blocks).
  for (const i of lines) {
    const c = days.indexOf(i.start.slice(0, 10));
    if (c < 0) continue;
    const at = minutesOfDay(i.start.slice(11));
    const y = gridTop + ((at - start * 60) / 60) * HOUR;
    const x = colX + c * colW;
    shapes.push({
      t: 'line',
      x1: x + 1,
      y1: y,
      x2: x + colW - 1,
      y2: y,
      paint: { color: i.colorCss },
      width: 3,
    });
    const labelW = colW - 4;
    shapes.push({
      t: 'rect',
      x: x + 2,
      y: y - 9,
      w: labelW,
      h: 18,
      r: 5,
      fill: { tint: i.colorCss, share: 0.3 },
      stroke: { color: i.colorCss },
      ...(i.done ? { alpha: 0.6 } : {}),
    });
    shapes.push({ t: 'alert', x: x + 5, y: y - 6, size: 12, paint: { color: i.colorCss } });
    shapes.push({
      t: 'text',
      x: x + 20,
      y: y - 7,
      w: labelW - 20,
      h: 16,
      inline: true,
      parts: [
        { text: i.start.slice(11), size: SMALL, weight: 400, paint: { token: '--text-2' } },
        { text: i.title, size: SMALL, weight: 600, paint: { ink: i.colorCss }, strike: i.done },
      ],
    });
  }
  top = gridTop + gridH;

  // The legend (« Détails » only).
  const legend = busy ? [] : legendOf(items.filter(inDays), input.order);
  const leg = legendShapes(legend, input, PAD, top + 16, width - 2 * PAD);
  shapes.push(...leg.shapes);
  const height = Math.ceil(top + (leg.height ? 16 + leg.height : 0) + PAD);
  return { width, height, scale: SCALE, title, shapes, legend, hours: { start, end } };
}

/** The month: whole weeks, each day with its items (a time, a title; « + n » when too many). */
function monthGrid(input: SnapshotInput, items: Placed[]): Scene {
  const width = WIDE;
  const busy = input.mode === 'busy';
  const title = snapshotTitle('month', input.from, input.to, input.month);
  const shapes: Shape[] = [
    {
      t: 'text',
      x: PAD,
      y: PAD - 4,
      w: width - 2 * PAD,
      h: TITLE + 8,
      parts: [{ text: title, size: TITLE, weight: 700, paint: { token: '--text' } }],
    },
  ];
  let top = PAD + TITLE + 10;
  if (busy) {
    shapes.push({
      t: 'text',
      x: PAD,
      y: top - 4,
      w: width - 2 * PAD,
      h: 18,
      parts: [{ text: 'Créneaux occupés', size: 13, weight: 400, paint: { token: '--text-2' } }],
    });
    top += 16;
  }
  top += 8;
  const days: string[] = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) days.push(d);
  const colW = (width - 2 * PAD) / 7;
  WEEKDAYS_SHORT.forEach((h, i) =>
    shapes.push({
      t: 'text',
      x: PAD + i * colW,
      y: top,
      w: colW,
      h: 18,
      align: 'center',
      parts: [{ text: h, size: 12, weight: 600, paint: { token: '--text-2' } }],
    }),
  );
  top += 22;
  const of = (d: string) =>
    items
      .filter((i) => touches(i, d))
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
  const MAX = 6;
  const most = Math.max(2, ...days.map((d) => Math.min(MAX, of(d).length)));
  const LINE = 17;
  const cellH = 24 + most * LINE + 4;
  const weeks = days.length / 7;
  for (let w = 0; w <= weeks; w++)
    shapes.push({
      t: 'line',
      x1: PAD,
      y1: top + w * cellH,
      x2: width - PAD,
      y2: top + w * cellH,
      paint: { token: '--border' },
      width: 1,
    });
  for (let c = 0; c <= 7; c++)
    shapes.push({
      t: 'line',
      x1: PAD + c * colW,
      y1: top,
      x2: PAD + c * colW,
      y2: top + weeks * cellH,
      paint: { token: '--border' },
      width: 1,
    });
  days.forEach((d, index) => {
    const x = PAD + (index % 7) * colW;
    const y = top + Math.floor(index / 7) * cellH;
    const other = input.month ? d.slice(0, 7) !== input.month : false;
    shapes.push({
      t: 'text',
      x: x + 6,
      y: y + 4,
      w: colW - 12,
      h: 16,
      parts: [
        {
          text: dayNumber(d),
          size: 12,
          weight: 700,
          paint: { token: other ? '--text-3' : '--text' },
        },
      ],
    });
    const list = of(d);
    const visible = list.length > MAX ? list.slice(0, MAX - 1) : list;
    visible.forEach((i, k) => {
      const cy = y + 24 + k * LINE;
      const { title } = words(i, input.mode);
      const time = i.allDay
        ? ''
        : i.start.slice(0, 10) === d
          ? busy
            ? timeText(i)
            : i.start.slice(11)
          : '';
      shapes.push({
        t: 'rect',
        x: x + 3,
        y: cy,
        w: colW - 6,
        h: LINE - 2,
        r: 4,
        fill: { tint: i.colorCss, share: i.allDay ? 0.36 : 0.2 },
        ...(i.optional ? { hatch: { tint: i.colorCss, share: 0.08 } as Paint } : {}),
        bar: { color: i.colorCss },
        ...(other || i.done || i.optional ? { alpha: other ? 0.55 : 0.75 } : {}),
      });
      if (i.deadline)
        shapes.push({ t: 'alert', x: x + 7, y: cy + 2, size: 11, paint: { color: i.colorCss } });
      shapes.push({
        t: 'text',
        x: x + (i.deadline ? 20 : 8),
        y: cy + 1,
        w: colW - (i.deadline ? 24 : 12),
        h: LINE - 2,
        inline: true,
        parts: [
          ...(time
            ? [{ text: time, size: SMALL, weight: 400, paint: { token: '--text-2' } } as TextPart]
            : []),
          { text: title, size: SMALL, weight: 600, paint: { ink: i.colorCss }, strike: i.done },
        ],
      });
    });
    if (list.length > visible.length)
      shapes.push({
        t: 'text',
        x: x + 8,
        y: y + 24 + visible.length * LINE + 1,
        w: colW - 12,
        h: LINE - 2,
        parts: [
          {
            text: `+ ${list.length - visible.length} autre${list.length - visible.length > 1 ? 's' : ''}`,
            size: SMALL,
            weight: 400,
            paint: { token: '--text-2' },
          },
        ],
      });
  });
  top += weeks * cellH;
  const legend = busy
    ? []
    : legendOf(
        items.filter((i) => days.some((d) => touches(i, d))),
        input.order,
      );
  const leg = legendShapes(legend, input, PAD, top + 16, width - 2 * PAD);
  shapes.push(...leg.shapes);
  return {
    width,
    height: Math.ceil(top + (leg.height ? 16 + leg.height : 0) + PAD),
    scale: SCALE,
    title,
    shapes,
    legend,
  };
}

/**
 * The scene of the image. In « Dispos seulement », nothing of an element's
 * title, place or note is in it, and the deadlines are left out (they are
 * not busy slots).
 */
export function buildSnapshot(input: SnapshotInput): Scene {
  const items: Placed[] = input.items
    .filter((i) => !(input.mode === 'busy' && i.deadline))
    .map((i) =>
      input.mode === 'busy'
        ? // Nothing personal left in the data the drawing receives.
          { ...i, title: BUSY, location: null, colorCss: input.colorOf(i.category) }
        : { ...i, colorCss: input.colorOf(i.category) },
    );
  if (input.view === 'month') return monthGrid(input, items);
  const days: string[] = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) days.push(d);
  return timeGrid(input, items, days, input.view === 'day' ? NARROW : WIDE);
}

/** Every text of a scene (the tests: « Dispos seulement » shows no title, place nor note). */
export const sceneTexts = (scene: Scene): string[] =>
  scene.shapes.flatMap((s) => (s.t === 'text' ? s.parts.map((p) => p.text) : []));

/** « Agenda semaine du 2026-11-23.png », « Agenda novembre 2026.png », « Agenda 2026-11-23.png ». */
export function snapshotFileName(view: SnapshotView, from: string, month?: string): string {
  if (view === 'week') return `Agenda semaine du ${from}.png`;
  if (view === 'day') return `Agenda ${from}.png`;
  const m = month ?? from.slice(0, 7);
  return `Agenda ${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}.png`;
}

/** What the image is of, in words (the button's tooltip and the message): « cette semaine », « ce mois », « ce jour ». */
export const snapshotWhat = (view: SnapshotView) =>
  view === 'week' ? 'cette semaine' : view === 'month' ? 'ce mois' : 'ce jour';
