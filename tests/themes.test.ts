import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(__dirname, '../frontend/src/themes');
const themes = readdirSync(dir).filter((f) => f.endsWith('.css'));
const tokens = (css: string) =>
  new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));

describe('interface themes', () => {
  const reference = tokens(readFileSync(path.join(dir, 'nebula.css'), 'utf8'));

  it('ships several themes, one of them light', () => {
    expect(themes.length).toBeGreaterThanOrEqual(4);
    const headers = themes.map((f) => readFileSync(path.join(dir, f), 'utf8'));
    expect(headers.some((css) => /scheme=light/.test(css))).toBe(true);
  });

  it.each(themes)('%s has a valid header and defines every token', (file) => {
    const css = readFileSync(path.join(dir, file), 'utf8');
    const id = file.replace(/\.css$/, '');
    expect(css).toMatch(new RegExp(`@theme id=${id}; label=[^;]+; scheme=(dark|light); swatch=`));
    expect(css).toContain(`:root[data-theme='${id}']`);
    const own = tokens(css);
    expect([...reference].filter((t) => !own.has(t))).toEqual([]);
    expect([...own].filter((t) => !reference.has(t))).toEqual([]);
  });
});
