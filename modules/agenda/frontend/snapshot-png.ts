// v0.44.0 (Expérimental, ADR 0050): the calendar's image from the page. What
// is shown (the period, the switches) becomes the scene of
// shared/snapshot.ts; the theme's tokens (the app's, or « Clair ») give its
// colours; a <canvas> of the page makes the PNG. No request is made: the data
// is the page's, the fonts are already loaded. The same code on the PC and
// the phone.
import {
  buildSnapshot,
  type SnapshotItem,
  type SnapshotMode,
  type SnapshotView,
} from '../shared/snapshot';
import { paintScene, snapshotColors, type Canvas2D } from '../shared/snapshot-paint';
import { type CssRule, themeTokens } from '../shared/snapshot-color';
import { addDays, mondayOf } from '../shared/time';
import type { RangeDto } from '../shared/types';
import {
  categoryCss,
  isOptional,
  itemId,
  itemsOf,
  knownCategories,
  placeOf,
  shortPlace,
} from './common';
import { monthGrid } from './MonthView';

export type SnapshotTheme = 'light' | 'app';

/** What the page shows, as the image's elements (the switches applied). */
export function snapshotItems(
  data: RangeDto,
  shown: (category: string) => boolean,
): SnapshotItem[] {
  return itemsOf(data, shown).map((i) => {
    const place = placeOf(i);
    return {
      id: itemId(i),
      title: i.event.title,
      start: i.event.start,
      end: i.event.end,
      allDay: i.event.allDay,
      category: i.event.category,
      location: place ? shortPlace(place) : null,
      source: i.source,
      ...(i.source === 'own' && i.event.deadline ? { deadline: true } : {}),
      ...(isOptional(i) ? { optional: true } : {}),
      ...((i.source === 'own' && i.event.done) || (i.source === 'task' && i.event.done)
        ? { done: true }
        : {}),
    };
  });
}

/** The days of the image: the week shown, the month's whole weeks, or the day. */
export function snapshotPeriod(
  view: SnapshotView,
  day: string,
): { from: string; to: string; month?: string } {
  if (view === 'month') return { ...monthGrid(day.slice(0, 7)), month: day.slice(0, 7) };
  if (view === 'day') return { from: day, to: day };
  const monday = mondayOf(day);
  return { from: monday, to: addDays(monday, 6) };
}

/** The scene of the page's view (pure: the tests build it too). */
export function snapshotScene(options: {
  data: RangeDto;
  view: SnapshotView;
  day: string;
  mode: SnapshotMode;
  shown: (category: string) => boolean;
}) {
  const period = snapshotPeriod(options.view, options.day);
  return buildSnapshot({
    view: options.view,
    mode: options.mode,
    ...period,
    items: snapshotItems(options.data, options.shown),
    dayStartHour: options.data.dayStartHour,
    dayEndHour: options.data.dayEndHour,
    colorOf: categoryCss,
    order: knownCategories().map((c) => c.name),
  });
}

/** The rules of the page's stylesheets (where the themes' tokens are written). */
function pageRules(): CssRule[] {
  const out: CssRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another origin's sheet: no token there
    }
    for (const rule of Array.from(rules))
      if (rule instanceof CSSStyleRule && rule.selectorText.includes(':root'))
        out.push({ selector: rule.selectorText, body: rule.style.cssText });
  }
  return out;
}

/** Any CSS colour as the browser writes it back (hexadecimal, or with its opacity). */
function normalizer(): (css: string) => string | null {
  const ctx = document.createElement('canvas').getContext('2d');
  return (css) => {
    if (!ctx) return null;
    // An invalid value leaves the previous one: start from « transparent ».
    ctx.fillStyle = 'transparent';
    const before = ctx.fillStyle;
    ctx.fillStyle = css;
    if (ctx.fillStyle === before && !/transparent/i.test(css)) return null;
    return typeof ctx.fillStyle === 'string' ? ctx.fillStyle : null;
  };
}

/** The colours of the image: the app's theme, or « Clair » (readable in any chat). */
export function pageColors(theme: SnapshotTheme) {
  if (theme === 'app') {
    const style = getComputedStyle(document.documentElement);
    return snapshotColors((name) => style.getPropertyValue(name).trim() || undefined, normalizer());
  }
  const tokens = themeTokens(pageRules(), 'clair', 'light');
  return snapshotColors((name) => tokens.get(name), normalizer());
}

/** The PNG of the page's view. */
export async function snapshotPng(
  options: Parameters<typeof snapshotScene>[0] & { theme: SnapshotTheme },
): Promise<{
  png: Uint8Array;
  width: number;
  height: number;
}> {
  const scene = snapshotScene(options);
  const colors = pageColors(options.theme) ?? pageColors('app');
  if (!colors) throw new Error('Les couleurs du thème ne se lisent pas : image impossible.');
  // The theme's font must be ready, else the canvas draws with another one.
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(scene.width * scene.scale);
  canvas.height = Math.round(scene.height * scene.scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Le dessin n’est pas disponible ici.');
  paintScene(ctx as unknown as Canvas2D, scene, colors);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('L’image n’a pas pu être créée.');
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
}
