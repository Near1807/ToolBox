import { describe, expect, it } from 'vitest';
import { matchByName, nameScore } from '@hub/sdk/backend';

const tracks = ['Boum Boum', 'Aube', 'Nuit blanche', 'Nuit d’été', 'Lumière'];

describe('matchByName', () => {
  it('finds what was said, accents, case and spaces aside', () => {
    expect(matchByName(tracks, 'boumboum', (t) => t)).toEqual({ kind: 'match', item: 'Boum Boum' });
    expect(matchByName(tracks, 'lumiere', (t) => t)).toEqual({ kind: 'match', item: 'Lumière' });
    expect(matchByName(tracks, 'le morceau aube', (t) => t)).toEqual({
      kind: 'match',
      item: 'Aube',
    });
    expect(matchByName(tracks, 'boum boom', (t) => t)).toEqual({
      kind: 'match',
      item: 'Boum Boum',
    });
  });

  it('reports ambiguity and absence instead of guessing', () => {
    expect(matchByName(tracks, 'nuit', (t) => t)).toEqual({
      kind: 'ambiguous',
      items: ['Nuit blanche', 'Nuit d’été'],
    });
    expect(matchByName(tracks, 'zèbre', (t) => t)).toEqual({ kind: 'none' });
  });

  it('scores whole titles above partial ones', () => {
    expect(nameScore('finir le mix', 'finir le mix')).toBe(1);
    expect(nameScore('finir le mix de Boum Boum', 'le mix')).toBeGreaterThan(0.5);
    expect(nameScore('appeler Paul', 'le mix')).toBe(0);
  });
});
