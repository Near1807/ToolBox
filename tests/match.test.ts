import { describe, expect, it } from 'vitest';
import { matchByName, nameScore, phoneticKey, soundScore } from '@hub/sdk/backend';

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
    const nuit = matchByName(tracks, 'nuit', (t) => t);
    expect(nuit.kind).toBe('ambiguous');
    expect(nuit.kind === 'ambiguous' && [...nuit.items].sort()).toEqual([
      'Nuit blanche',
      'Nuit d’été',
    ]);
    expect(matchByName(tracks, 'zèbre', (t) => t)).toEqual({ kind: 'none', suggestions: [] });
  });

  it('scores whole titles above partial ones', () => {
    expect(nameScore('finir le mix', 'finir le mix')).toBe(1);
    expect(nameScore('finir le mix de Boum Boum', 'le mix')).toBeGreaterThan(0.5);
    expect(nameScore('appeler Paul', 'le mix')).toBe(0);
  });
});

describe('names that sound alike (French speech recognition)', () => {
  const library = ['Obsidian', 'Obsession', 'GrosKaillou', 'Boumboum', 'Aube', 'Midnight Drive'];
  const find = (said: string) => matchByName(library, said, (t) => t);

  it('finds a track written as it sounds', () => {
    expect(find('obsidienne')).toEqual({ kind: 'match', item: 'Obsidian' });
    expect(find('boum boum')).toEqual({ kind: 'match', item: 'Boumboum' });
    expect(find('gros caillou')).toEqual({ kind: 'match', item: 'GrosKaillou' });
    expect(phoneticKey('obsidienne')).toBe(phoneticKey('Obsidian'));
    expect(soundScore('gros caillou', 'GrosKaillou')).toBe(1);
  });

  it('does not match what only looks a little alike', () => {
    expect(soundScore('obsidienne', 'Obsession')).toBeLessThan(0.85);
    expect(find('eau')).toMatchObject({ kind: 'none' });
    expect(find('drip')).toMatchObject({ kind: 'none' });
    expect(find('zèbre')).toEqual({ kind: 'none', suggestions: [] });
  });

  it('keeps reporting ambiguity', () => {
    expect(matchByName(['Obsidian', 'Obsidienne'], 'obsidiane', (t) => t)).toMatchObject({
      kind: 'ambiguous',
    });
  });

  it('matches the nicknames like the title', () => {
    const tracks = [
      { title: 'GrosKaillou', nicknames: ['le gros caillou', 'GK'] },
      { title: 'Aube', nicknames: [] },
    ];
    expect(matchByName(tracks, 'GK', (t) => [t.title, ...t.nicknames])).toMatchObject({
      kind: 'match',
      item: { title: 'GrosKaillou' },
    });
  });

  it('suggests the closest names when nothing matches', () => {
    const result = matchByName(library, 'obsi', (t) => t);
    expect(
      result.kind === 'match' || (result.kind === 'none' && result.suggestions.length > 0),
    ).toBe(true);
    // Too far to be taken, close enough to be offered (« Tu voulais dire … ? »).
    expect(matchByName(library, 'midnite drave', (t) => t)).toEqual({
      kind: 'none',
      suggestions: ['Midnight Drive'],
    });
  });
});
