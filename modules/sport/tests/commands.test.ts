// The phrases of the assistant for Sport, taken apart by code.
import { describe, expect, it } from 'vitest';
import { extractComment, extractDone, extractMood, extractMove } from '../backend/commands';

describe('sport: standardised commands', () => {
  it('done or not done', () => {
    expect(extractDone('séance faite')).toEqual({ done: true });
    expect(extractDone('j’ai fait ma séance')).toEqual({ done: true });
    expect(extractDone('séance pas faite')).toEqual({ done: false });
    expect(extractDone('je n’ai pas fait ma séance')).toEqual({ done: false });
    expect(extractDone('humeur 4')).toBeNull();
    expect(extractDone('c’est quoi ma séance aujourd’hui')).toBeNull();
  });
  it('mood, comment, move', () => {
    expect(extractMood('humeur 4')).toEqual({ mood: 4 });
    expect(extractMood('humeur de la séance trois')).toEqual({ mood: 3 });
    expect(extractMood('humeur 8')).toBeNull();
    expect(extractComment('commentaire : bonne séance, dos un peu raide')).toEqual({
      text: 'bonne séance, dos un peu raide',
    });
    expect(extractMove('déplace ma séance de mardi à jeudi')).toEqual({ from: 2, to: 4 });
    expect(extractMove('décale la séance de lundi à lundi')).toBeNull();
    expect(extractMove('déplace ma séance')).toBeNull();
  });
});
