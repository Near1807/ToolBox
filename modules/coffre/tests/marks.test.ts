// v0.47.0: a search's words found in a reader's text (accents and case
// ignored, the original text kept), and the extracts' marks (never HTML).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkedText } from '@hub/sdk/components';
import { findWords, wordsOf } from '../frontend/readers/mark';

describe('mots surlignés', () => {
  it('accents et casse ignorés, positions dans le texte d’origine', () => {
    const text = 'La loi : Électricité, puis ELECTRICITE et électrique.';
    const words = wordsOf('electricite');
    expect(findWords(text, words).map(([a, b]) => text.slice(a, b))).toEqual([
      'Électricité',
      'ELECTRICITE',
    ]);
    // Composed characters (NFD in the file) stay whole.
    const nfd = 'électricité';
    expect(findWords(nfd, words).map(([a, b]) => nfd.slice(a, b))).toEqual([nfd]);
    expect(wordsOf('  ')).toEqual([]);
  });

  it('un extrait : les mots marqués, le reste en texte (aucun HTML du fichier)', () => {
    const html = renderToStaticMarkup(
      createElement(MarkedText, { text: '<b>avant</b> \u0001mot\u0002 après' }),
    );
    expect(html).toBe('<span>&lt;b&gt;avant&lt;/b&gt; <mark>mot</mark> après</span>');
  });
});
