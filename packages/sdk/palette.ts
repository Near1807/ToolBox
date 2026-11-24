// v0.42.0 (moved to the SDK in v0.45.0: the Agenda's categories and the
// Coffre's contexts share it): the colours of a category. Sixteen hues of the
// palette, each a theme token (« --hue-<id> », defined for the light AND the
// dark schemes in frontend/src/themes/palette.css, the text's contrast
// checked in both), or a free colour « #rrggbb » chosen by Thomas. Stored as
// « p:<id> » or « #rrggbb »; null = the element's own default. Pure.

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
