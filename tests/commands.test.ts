import { describe, expect, it } from 'vitest';
import {
  cleanUtterance,
  extractAfter,
  extractName,
  extractNumber,
  extractTags,
  extractTrailing,
  normaliseUtterance,
  stripCommand,
} from '@hub/sdk/backend';

describe('standardised command helpers', () => {
  it('normalises for matching (accents, case, apostrophes)', () => {
    expect(normaliseUtterance('  Qu’est-ce que J’AI à faire ?  ')).toBe(
      'qu est ce que j ai a faire',
    );
  });

  it('drops spoken fillers and polite forms, keeps the request', () => {
    expect(cleanUtterance('Euh, bon, tu peux ajouter une tâche s’il te plaît')).toBe(
      'ajouter une tâche',
    );
    expect(cleanUtterance('est-ce que tu pourrais ouvrir le planning, merci')).toBe(
      'ouvrir le planning',
    );
    expect(cleanUtterance('je voudrais que tu coches le mix')).toBe('coches le mix');
  });

  it('cuts a command prefix only at the start', () => {
    const prefixes = [/(?:ajoute|ajouter)(?![\p{L}])\s*/iu];
    expect(stripCommand('euh ajoute finir le mix', prefixes)).toBe('finir le mix');
    expect(stripCommand('il faut ajouter le mix', prefixes)).toBeNull();
  });

  it('finds tags said or typed', () => {
    expect(extractTags('finir le mix #studio avec les tags mix et voix')).toEqual({
      tags: ['studio', 'mix', 'voix'],
      rest: 'finir le mix',
    });
    expect(extractTags('rien ici')).toEqual({ tags: [], rest: 'rien ici' });
  });

  it('takes a value from the end when the parser understands it', () => {
    const parse = (tail: string) => (/^vendredi$/i.test(tail) ? 'V' : null);
    expect(extractTrailing('finir le mix pour vendredi', parse)).toEqual({
      value: 'V',
      rest: 'finir le mix',
      tail: 'vendredi',
    });
    expect(extractTrailing('finir le mix', parse).value).toBeNull();
  });

  it('takes a segment after a marker, and names after a command', () => {
    expect(extractAfter('finir le mix sur le morceau Aube', /\s+sur le morceau\s+/i)).toEqual({
      value: 'Aube',
      rest: 'finir le mix',
    });
    const prefixes = [/(?:où en est)(?![\p{L}])/iu];
    expect(extractName('où en est le morceau Aube ?', prefixes)).toBe('Aube');
    expect(extractName('où en est la fin du monde', prefixes)).toBe('fin du monde');
    expect(extractName('où en est', prefixes)).toBeNull();
  });

  it('reads numbers in digits or words', () => {
    expect(extractNumber('les 90 derniers jours')).toBe(90);
    expect(extractNumber('sept jours')).toBe(7);
    expect(extractNumber('quatre-vingt-dix jours')).toBe(90);
    expect(extractNumber('aucun')).toBeNull();
  });
});
