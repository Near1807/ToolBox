import { describe, expect, it } from 'vitest';
import { formatDue, parseDue, splitQuickAdd, spokenDue } from '../dates';

// Friday 23 October 2026.
const TODAY = '2026-10-23';

describe('parseDue', () => {
  it.each([
    ['aujourd’hui', '2026-10-23'],
    ["aujourd'hui", '2026-10-23'],
    ['ce soir', '2026-10-23'],
    ['demain', '2026-10-24'],
    ['demain matin', '2026-10-24'],
    ['après-demain', '2026-10-25'],
    ['jeudi', '2026-10-29'],
    ['vendredi', '2026-10-23'],
    ['pour samedi', '2026-10-24'],
    ['lundi', '2026-10-26'],
    ['Mercredi', '2026-10-28'],
    ['vendredi prochain', '2026-10-30'],
    ['prochain lundi', '2026-10-26'],
    ['mardi de la semaine prochaine', '2026-10-27'],
    ['lundi en huit', '2026-11-02'],
    ['dans 3 jours', '2026-10-26'],
    ['dans trois jours', '2026-10-26'],
    ['dans une semaine', '2026-10-30'],
    ['dans deux semaines', '2026-11-06'],
    ['dans huit jours', '2026-10-30'],
    ['dans quinze jours', '2026-11-06'],
    ['dans un mois', '2026-11-23'],
    ['la semaine prochaine', '2026-10-26'],
    ['cette semaine', '2026-10-23'],
    ['d’ici la fin de la semaine', '2026-10-23'],
    ['ce week-end', '2026-10-24'],
    ['fin du mois', '2026-10-31'],
    ['d’ici la fin du mois', '2026-10-31'],
    ['le mois prochain', '2026-11-01'],
    ['le 12', '2026-11-12'],
    ['le 30', '2026-10-30'],
    ['le 12 novembre', '2026-11-12'],
    ['12 novembre', '2026-11-12'],
    ['le douze novembre', '2026-11-12'],
    ['le premier décembre', '2026-12-01'],
    ['le 1er janvier', '2027-01-01'],
    ['le 3 mars 2027', '2027-03-03'],
    ['10 octobre', '2027-10-10'],
    ['vendredi 30', '2026-10-30'],
    ['vendredi 30 octobre', '2026-10-30'],
    ['12/11', '2026-11-12'],
    ['01/02/2027', '2027-02-01'],
    ['2026-12-24', '2026-12-24'],
  ])('« %s » → %s', (text, expected) => {
    expect(parseDue(text, TODAY)).toBe(expected);
  });

  it.each(['', 'bientôt', 'un jour', '12', 'le 32', '31/02', 'mix', 'dans des jours'])(
    'never guesses: « %s » → null',
    (text) => {
      expect(parseDue(text, TODAY)).toBeNull();
    },
  );

  it('handles the end of the year and Sundays', () => {
    expect(parseDue('demain', '2026-12-31')).toBe('2027-01-01');
    expect(parseDue('lundi', '2026-10-25')).toBe('2026-10-26');
    expect(parseDue('semaine prochaine', '2026-10-25')).toBe('2026-10-26');
    expect(parseDue('le mois prochain', '2026-12-10')).toBe('2027-01-01');
  });
});

describe('formatDue and spokenDue', () => {
  it('says the day in words when close', () => {
    expect(formatDue('2026-10-23', TODAY)).toBe('aujourd’hui');
    expect(formatDue('2026-10-24', TODAY)).toBe('demain');
    expect(formatDue('2026-10-22', TODAY)).toBe('hier');
    expect(formatDue('2026-10-27', TODAY)).toBe('mardi');
    expect(formatDue('2026-11-12', TODAY)).toBe('jeu. 12 nov.');
    expect(formatDue('2027-07-01', TODAY)).toBe('jeu. 1 juil. 2027');
    expect(spokenDue('2026-10-30', TODAY)).toBe('vendredi 30 octobre');
    expect(spokenDue('2026-11-01', TODAY)).toBe('dimanche 1er novembre');
  });
});

describe('splitQuickAdd', () => {
  it('takes the tags and a date at the end', () => {
    expect(splitQuickAdd('finir le mix de boumboum #mix pour lundi', TODAY)).toEqual({
      title: 'finir le mix de boumboum',
      tags: ['mix'],
      due: '2026-10-26',
      dueText: 'pour lundi',
    });
    expect(splitQuickAdd('appeler le studio demain #Studio #studio', TODAY)).toMatchObject({
      title: 'appeler le studio',
      tags: ['studio'],
      due: '2026-10-24',
    });
  });

  it('leaves a title without date alone', () => {
    expect(splitQuickAdd('acheter 2 cordes', TODAY)).toEqual({
      title: 'acheter 2 cordes',
      tags: [],
      due: null,
      dueText: null,
    });
    // A date alone is a title, not an empty task.
    expect(splitQuickAdd('demain', TODAY).title).toBe('demain');
  });
});
