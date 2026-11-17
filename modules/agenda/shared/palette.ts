// v0.42.0: the colours a category can take. Sixteen hues of the palette, each
// a theme token (« --hue-<id> », defined for the light AND the dark schemes in
// frontend/src/themes/palette.css, the text's contrast checked in both), or a
// free colour « #rrggbb » chosen by Thomas (the block's text colour is then
// computed). Stored as « p:<id> » or « #rrggbb »; null = the category's own default.
// Pure (PC, phone, tests).

export const PALETTE = [
  { id: 'rouge', label: 'Rouge' },
  { id: 'corail', label: 'Corail' },
  { id: 'orange', label: 'Orange' },
  { id: 'ambre', label: 'Ambre' },
  { id: 'jaune', label: 'Jaune' },
  { id: 'olive', label: 'Olive' },
  { id: 'vert', label: 'Vert' },
  { id: 'emeraude', label: 'Émeraude' },
  { id: 'turquoise', label: 'Turquoise' },
  { id: 'cyan', label: 'Cyan' },
  { id: 'bleu', label: 'Bleu' },
  { id: 'indigo', label: 'Indigo' },
  { id: 'violet', label: 'Violet' },
  { id: 'mauve', label: 'Mauve' },
  { id: 'rose', label: 'Rose' },
  { id: 'ardoise', label: 'Ardoise' },
] as const;

export type PaletteId = (typeof PALETTE)[number]['id'];

const FREE = /^#[0-9a-f]{6}$/i;

/** Is this a colour a category may store (« p:<id> » of the palette, or « #rrggbb »)? */
export function isColorValue(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (FREE.test(v)) return true;
  return v.startsWith('p:') && PALETTE.some((p) => `p:${p.id}` === v);
}

export const isFreeColor = (v: string | null | undefined): v is string =>
  typeof v === 'string' && FREE.test(v);

/** The CSS value of a stored colour, or `fallback` (the category's default token). */
export function colorValue(stored: string | null | undefined, fallback: string): string {
  if (stored && stored.startsWith('p:')) return `var(--hue-${stored.slice(2)})`;
  if (isFreeColor(stored)) return stored.toLowerCase();
  return fallback;
}

/** « Violet », « Couleur libre », or « D’origine ». */
export function colorLabel(stored: string | null | undefined): string {
  if (!stored) return 'Couleur d’origine';
  if (isFreeColor(stored)) return `Couleur libre (${stored.toLowerCase()})`;
  return PALETTE.find((p) => `p:${p.id}` === stored)?.label ?? 'Couleur d’origine';
}

// --- Contrast (WCAG 2.1), pure: the tests and the free colour's text ---------------

export type Rgb = [number, number, number];

/** « #rrggbb », « #rgb », « rgb(1 2 3) », « rgb(1, 2, 3 / 50%) » (alpha ignored) → [r, g, b], else null. */
export function parseColor(text: string): Rgb | null {
  const t = text.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(t);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(t);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** `share` of `a` over `b` (like color-mix(in srgb, a share, b)). */
export const mix = (a: Rgb, b: Rgb, share: number): Rgb =>
  a.map((v, i) => Math.round(v * share + b[i]! * (1 - share))) as Rgb;

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const luminance = (c: Rgb) =>
  0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);

/** Contrast ratio between two colours (1 … 21). */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** The share of the category's colour in a block's background (agenda.css). */
export const BLOCK_MIX = 0.3;

/**
 * The text of a block of colour `color` on `surface`: the theme's text, or
 * the other ink when it reads better; `low` when even the best stays under
 * 4.5:1 (a warning is shown when the colour is chosen).
 */
export function blockInk(
  color: Rgb,
  surface: Rgb,
  inks: { text: Rgb; other: Rgb },
): { ink: 'text' | 'other'; ratio: number; low: boolean } {
  const bg = mix(color, surface, BLOCK_MIX);
  const t = contrast(inks.text, bg);
  const o = contrast(inks.other, bg);
  const ink = o > t ? 'other' : 'text';
  const ratio = Math.max(t, o);
  return { ink, ratio, low: ratio < 4.5 };
}

/** [r, g, b] → « #rrggbb » (the free colour's picker). */
export const toHex = (c: Rgb) =>
  `#${c
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
