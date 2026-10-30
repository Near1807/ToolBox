// Readability of every theme, checked on its tokens (docs/THEMES.md,
// « Lisibilité »): WCAG AA contrast of the texts on every surface they are
// read on, text on the accent, discreet and disabled text, accent and focus
// marks, chart series on the cards; series told apart from each other, also
// with deuteranopia; controls visible without hover.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contrast,
  deuteranopia,
  oklabDistance,
  surfaces,
  themeChecks,
  themeTokens,
  tokenColor,
} from './helpers/contrast';

const dir = path.resolve(__dirname, '../frontend/src/themes');
const themes = readdirSync(dir).filter((f) => f.endsWith('.css'));

describe.each(themes)('lisibilité de %s', (file) => {
  const tokens = themeTokens(path.join(dir, file));

  it('texts, text on the accent, accent and focus marks: WCAG AA', () => {
    const failing = themeChecks(tokens)
      .filter((c) => c.ratio < c.min)
      .map((c) => `${c.what} : ${c.ratio} (minimum ${c.min})`);
    expect(failing).toEqual([]);
  });

  it('chart series are told apart (also with deuteranopia, for the four most used)', () => {
    const series = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => tokenColor(tokens, `--series-${i}`)!);
    const close: string[] = [];
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++) {
        const d = oklabDistance(series[i]!, series[j]!);
        if (d < (i < 4 && j < 4 ? 0.09 : 0.055)) close.push(`${i + 1}-${j + 1} : ${d.toFixed(3)}`);
        if (i < 4 && j < 4) {
          const cvd = oklabDistance(deuteranopia(series[i]!), deuteranopia(series[j]!));
          if (cvd < 0.05) close.push(`${i + 1}-${j + 1} (deutéranopie) : ${cvd.toFixed(3)}`);
        }
      }
    expect(close).toEqual([]);
  });

  it('controls (fields, secondary buttons) have a visible edge without hover', () => {
    const edge = tokenColor(tokens, '--control-border') ?? tokenColor(tokens, '--border-strong')!;
    expect(contrast(edge, surfaces(tokens).surface)).toBeGreaterThanOrEqual(1.4);
  });
});
