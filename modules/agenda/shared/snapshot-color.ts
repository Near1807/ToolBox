// v0.44.0: the colours of the calendar's image (ADR 0050). The image is drawn
// with the theme's tokens (never a colour written in the code): a token's
// value is read from the theme (the app's, or « Clair »), its « var(--x) »
// replaced, then turned into numbers the drawing can mix. Pure (PC, phone, tests).
import { mix, type Rgb } from './palette';

/** A colour and its opacity (0 … 1). */
export interface Rgba {
  rgb: Rgb;
  alpha: number;
}

const number = (text: string, max: number) => {
  const t = text.trim();
  if (t.endsWith('%')) return (Number(t.slice(0, -1)) / 100) * max;
  return Number(t);
};

/**
 * « #rgb », « #rgba », « #rrggbb », « #rrggbbaa », « rgb(1 2 3) »,
 * « rgb(1 2 3 / 50%) », « rgba(1, 2, 3, 0.5) » → a colour with its opacity,
 * else null (a value the drawing then asks the browser to read).
 */
export function parseRgba(text: string): Rgba | null {
  const t = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);
  if (hex) {
    const h = hex[1]!.length <= 4 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
    return { rgb, alpha: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(t);
  if (!fn) return null;
  const [channels, slash] = fn[1]!.split('/');
  const parts = channels!
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  const rgb = parts.slice(0, 3).map((p) => number(p, 255)) as Rgb;
  const a = slash ?? parts[3];
  const alpha = a === undefined ? 1 : number(a, 1);
  if ([...rgb, alpha].some((v) => !Number.isFinite(v))) return null;
  return { rgb, alpha: Math.max(0, Math.min(1, alpha)) };
}

/** `fg` laid over an opaque `bg`. */
export const over = (fg: Rgba, bg: Rgb): Rgb => mix(fg.rgb, bg, fg.alpha);

/** An opaque colour as the canvas reads it. */
export const cssOf = (c: Rgb, alpha = 1): string =>
  alpha >= 1
    ? `rgb(${c.map((v) => Math.round(v)).join(' ')})`
    : `rgb(${c.map((v) => Math.round(v)).join(' ')} / ${Math.round(alpha * 1000) / 10}%)`;

/**
 * A CSS value with its « var(--x[, fallback]) » replaced by the theme's
 * tokens (`lookup`), several levels deep; null when a token is missing.
 */
export function substitute(
  value: string,
  lookup: (name: string) => string | undefined,
  depth = 0,
): string | null {
  if (depth > 8) return null;
  let out = '';
  let rest = value;
  for (;;) {
    const at = rest.indexOf('var(');
    if (at < 0) return out + rest;
    out += rest.slice(0, at);
    // The matching parenthesis (a fallback may hold another var()).
    let level = 0;
    let end = -1;
    for (let i = at + 3; i < rest.length; i++) {
      if (rest[i] === '(') level++;
      else if (rest[i] === ')' && --level === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) return null;
    const inner = rest.slice(at + 4, end);
    const comma = inner.indexOf(',');
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const found = lookup(name)?.trim();
    const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
    const chosen = found || fallback;
    if (!chosen) return null;
    const resolved = substitute(chosen, lookup, depth + 1);
    if (resolved === null) return null;
    out += resolved;
    rest = rest.slice(end + 1);
  }
}

/** A CSS rule as read from a stylesheet: its selector and its declarations. */
export interface CssRule {
  selector: string;
  body: string;
}

/**
 * The tokens of a theme, from the stylesheets' rules (the themes are written
 * on `:root[data-theme='…']`, palette.css adds `:root[data-scheme='light']`):
 * first `:root`, then the scheme, then the theme itself (the later wins).
 */
export function themeTokens(
  rules: readonly CssRule[],
  theme: string,
  scheme: 'light' | 'dark',
): Map<string, string> {
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/"/g, "'");
  const rank = (selector: string) => {
    const parts = selector.split(',').map(norm);
    if (parts.includes(`:root[data-theme='${theme}']`)) return 3;
    if (scheme === 'light' && parts.includes(":root[data-scheme='light']")) return 2;
    if (parts.includes(':root')) return 1;
    return 0;
  };
  const tokens = new Map<string, string>();
  for (const level of [1, 2, 3])
    for (const rule of rules) {
      if (rank(rule.selector) !== level) continue;
      const body = rule.body.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) tokens.set(m[1]!, m[2]!.trim());
    }
  return tokens;
}

/** The rules of a CSS text (the tests read the theme files themselves). */
export function cssRules(text: string): CssRule[] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim(),
    body: m[2]!,
  }));
}
