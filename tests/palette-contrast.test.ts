// v0.42.0: the categories' palette (frontend/src/themes/palette.css). In every
// theme, a block mixes 30 % of the category's colour into the card's surface
// and keeps the theme's text: 4.5:1 at least, for the 16 colours, in the
// light themes (deep tones) and the dark ones (bright tones). The colour
// itself is a mark (the block's edge, the switch's dot): 3:1 on the surface.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, over, parseColor, surfaces, themeTokens, tokenColor } from './helpers/contrast';

const dir = path.resolve(__dirname, '../frontend/src/themes');
const themes = readdirSync(dir).filter(
  (f) => f.endsWith('.css') && readFileSync(path.join(dir, f), 'utf8').includes('@theme'),
);
const paletteCss = readFileSync(path.join(dir, 'palette.css'), 'utf8');
const block = (selector: string) => {
  const body = new RegExp(`${selector.replace(/[[\]'()]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(
    paletteCss,
  )![1]!;
  return Object.fromEntries(
    [...body.matchAll(/(--hue-[a-z]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
};
const dark = block(':root');
const light = block(":root[data-scheme='light']");
// The socle knows no module: the hues are read from palette.css (the Agenda checks its list matches).
const PALETTE = Object.keys(dark).map((name) => ({ id: name.replace('--hue-', '') }));

describe('the categories’ palette', () => {
  it('16 colours, each defined for the light and the dark schemes', () => {
    expect(PALETTE).toHaveLength(16);
    for (const p of PALETTE) {
      expect(dark[`--hue-${p.id}`], p.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(light[`--hue-${p.id}`], p.id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(themes)(
    '%s: the text of a block of each colour reads (4.5:1), the colour shows (3:1)',
    (file) => {
      const css = readFileSync(path.join(dir, file), 'utf8');
      const scheme = /scheme=light/.test(css) ? light : dark;
      const tokens = themeTokens(path.join(dir, file));
      const surface = surfaces(tokens).surface;
      const text = tokenColor(tokens, '--text')!;
      const failing: string[] = [];
      for (const p of PALETTE) {
        const c = parseColor(scheme[`--hue-${p.id}`]!)!;
        const bg = over([c[0], c[1], c[2], 0.3], surface);
        const t = contrast(text, bg);
        if (t < 4.5) failing.push(`${p.id} : texte ${t.toFixed(2)}`);
        const mark = contrast(c, surface);
        if (mark < 3) failing.push(`${p.id} : marque ${mark.toFixed(2)}`);
      }
      expect(failing).toEqual([]);
    },
  );
});
