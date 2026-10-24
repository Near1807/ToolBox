// Colours of the theme, resolved for the canvases (a canvas cannot read CSS
// variables): every colour comes from the theme's tokens, none is written here.
import { useEffect, useState } from 'react';

const TOKENS = [
  'text',
  'text-2',
  'text-3',
  'border',
  'border-strong',
  'surface',
  'surface-2',
  'bg',
  'accent',
  'danger',
  'warning',
  'info',
  'success',
  'series-1',
  'series-2',
  'series-3',
  'series-4',
  'series-5',
  'series-6',
  'series-7',
  'series-8',
] as const;
export type Token = (typeof TOKENS)[number];
export type Colors = Record<Token, string>;

let probe: CanvasRenderingContext2D | null = null;
/** Any CSS colour → its canonical form, as a canvas understands it. */
function normalise(color: string): string {
  probe ??= document.createElement('canvas').getContext('2d');
  if (!probe) return color;
  probe.fillStyle = 'transparent';
  probe.fillStyle = color;
  return String(probe.fillStyle);
}

function read(): Colors {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    TOKENS.map((t) => [t, normalise(style.getPropertyValue(`--${t}`).trim() || 'gray')]),
  ) as Colors;
}

/** The theme's colours, read again when the theme changes. */
export function useColors(): Colors {
  const [colors, setColors] = useState<Colors>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    });
    return () => observer.disconnect();
  }, []);
  return colors;
}

/** Red, green, blue (0…255) of a normalised colour. */
export function channelsOf(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (m) {
    const [r = 0, g = 0, b = 0] = m[1]!.split(',').map((x) => parseFloat(x));
    return [r, g, b];
  }
  return [128, 128, 128];
}

/** The seven bands, always in this order (categorical series 1…7). */
export const BAND_TOKENS: Token[] = [
  'series-1',
  'series-2',
  'series-3',
  'series-4',
  'series-5',
  'series-6',
  'series-7',
];
