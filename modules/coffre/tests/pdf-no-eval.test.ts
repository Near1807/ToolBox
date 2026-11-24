// v0.47.1: no code is ever built from a PDF's data, in the preview nor in the
// text extraction. pdf.js 6 removed its `isEvalSupported` option together with
// its last eval path: this test fails if a later pdf.js brings one back (then
// the option, or its successor, must be set in both places), and if the app's
// page policy ever allowed eval.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PDFJS = path.join(ROOT, 'node_modules', 'pdfjs-dist');

describe('PDF : jamais de code construit depuis le fichier', () => {
  it('pdf.js embarqué (aperçu et extraction) ne contient ni eval ni new Function', () => {
    for (const f of [
      'build/pdf.mjs',
      'build/pdf.worker.min.mjs',
      'legacy/build/pdf.mjs',
      'legacy/build/pdf.worker.mjs',
    ]) {
      const code = readFileSync(path.join(PDFJS, f), 'utf8');
      expect(code.includes('new Function('), f).toBe(false);
      expect(/[^\w.]eval\(/.test(code), f).toBe(false);
    }
  });

  it('la page de ToolBox interdit eval (pas de « unsafe-eval »)', () => {
    const html = readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');
    const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).not.toMatch(/unsafe-eval/);
  });
});
