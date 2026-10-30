// Contrast of the theme tokens (WCAG 2.x), read from the theme files: used by
// tests/theme-contrast.test.ts and to tune a new theme (docs/THEMES.md).
import { readFileSync } from 'node:fs';

export type Rgba = [number, number, number, number];

/** The tokens of a theme file: name → raw value. */
export function themeTokens(file: string): Record<string, string> {
  const css = readFileSync(file, 'utf8');
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) out[m[1]!] = m[2]!.trim();
  return out;
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r g b / a%)`, `rgb(r, g, b)` → RGBA (0–255, alpha 0–1). */
export function parseColor(value: string): Rgba | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean);
    const alpha =
      parts[3] === undefined
        ? 1
        : parts[3].endsWith('%')
          ? parseFloat(parts[3]) / 100
          : parseFloat(parts[3]);
    return [Number(parts[0]), Number(parts[1]), Number(parts[2]), alpha];
  }
  return null;
}

/** A token's colour, following `var(--x)` (a gradient gives its first colour). */
export function tokenColor(tokens: Record<string, string>, name: string, depth = 0): Rgba | null {
  const raw = tokens[name];
  if (!raw || depth > 5) return null;
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(raw);
  if (ref) return tokenColor(tokens, ref[1]!, depth + 1);
  return parseColor(raw);
}

/** All the colours of a gradient token (`linear-gradient(…, #a 0%, #b 100%)`). */
export function gradientColors(raw: string): Rgba[] {
  return [...raw.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)/gi)]
    .map((m) => parseColor(m[0]))
    .filter((c): c is Rgba => c !== null);
}

/** `top` laid over `bottom` (opaque result). */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of `fg` (laid over `bg` if translucent) on `bg`. */
export function contrast(fg: Rgba, bg: Rgba): number {
  const f = luminance(over(fg, bg));
  const b = luminance(bg);
  return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
}

/** Distance between two colours in OKLab (0 = same; ≈ 0.1 = clearly different). */
export function oklabDistance(a: Rgba, b: Rgba): number {
  const lab = ([r, g, bl]: Rgba) => {
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const [R, G, B] = [lin(r), lin(g), lin(bl)];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const [x, y] = [lab(a), lab(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
}

/** The opaque surfaces text is read on, as they render (translucent ones laid over the background). */
export type SurfaceName =
  'bg' | 'surface' | 'surface-2' | 'surface-hover' | 'surface-solid' | 'field';

export function surfaces(tokens: Record<string, string>): Record<SurfaceName, Rgba> {
  const bg = tokenColor(tokens, '--bg')!;
  const surface = over(tokenColor(tokens, '--surface')!, bg);
  return {
    bg,
    surface,
    'surface-2': over(tokenColor(tokens, '--surface-2')!, surface),
    'surface-hover': over(tokenColor(tokens, '--surface-hover')!, surface),
    'surface-solid': over(tokenColor(tokens, '--surface-solid')!, bg),
    field: over(tokenColor(tokens, '--field')!, surface),
  };
}

export interface Check {
  what: string;
  ratio: number;
  min: number;
}

/**
 * Every pair that must be readable, with its WCAG AA minimum: text 4.5:1
 * (normal and small text), discreet / disabled text and graphical marks
 * (accent, focus, chart series) 3:1.
 */
export function themeChecks(tokens: Record<string, string>): Check[] {
  const s = surfaces(tokens);
  const c = (name: string) => tokenColor(tokens, name)!;
  const checks: Check[] = [];
  const add = (what: string, fg: Rgba, bg: Rgba, min: number) =>
    checks.push({ what, ratio: Math.round(contrast(fg, bg) * 100) / 100, min });
  for (const [where, bg] of Object.entries(s)) {
    add(`--text sur ${where}`, c('--text'), bg, 4.5);
    add(`--text-2 sur ${where}`, c('--text-2'), bg, 4.5);
    add(`--text-3 sur ${where}`, c('--text-3'), bg, 3);
  }
  for (const state of ['--success', '--warning', '--danger', '--accent-2', '--info'])
    for (const where of ['surface', 'surface-2'] as const)
      add(`${state} (texte) sur ${where}`, c(state), s[where], 4.5);
  // Text on the accent: the solid accent and every colour of the button gradient.
  for (const [i, color] of [
    c('--accent'),
    ...gradientColors(tokens['--accent-grad'] ?? ''),
  ].entries())
    add(
      `--text-on-accent sur l’accent (${i === 0 ? '--accent' : `dégradé ${i}`})`,
      c('--text-on-accent'),
      color,
      4.5,
    );
  add('--accent (repère, onglet, bordure active) sur surface', c('--accent'), s.surface, 3);
  const focus = tokens['--focus-color'] ? tokenColor(tokens, '--focus-color') : c('--accent-2');
  add('focus sur bg', focus!, s.bg, 3);
  add('focus sur surface', focus!, s.surface, 3);
  for (let i = 1; i <= 8; i++) add(`--series-${i} sur surface`, c(`--series-${i}`), s.surface, 3);
  return checks;
}

/**
 * A colour as seen with deuteranopia (the most common colour blindness),
 * Viénot, Brettel & Mollon 1999 simulation in linear RGB.
 */
export function deuteranopia([r, g, b, a]: Rgba): Rgba {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const back = (c: number) =>
    255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const r2 = 0.29275 * R + 0.70725 * G;
  const b2 = -0.02234 * R + 0.02234 * G + B;
  return [back(r2), back(r2), back(b2), a];
}
