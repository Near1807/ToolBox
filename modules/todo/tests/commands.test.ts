import { describe, expect, it } from 'vitest';
import { extractAdd, extractComplete, extractDelete, extractList } from '../backend/commands';

// Friday 23 October 2026.
const TODAY = '2026-10-23';

describe('standardised commands of the To-do (parameters taken by code)', () => {
  it.each([
    ['ajoute une tâche finir le mix pour vendredi', { title: 'finir le mix', due: '2026-10-30' }],
    ['Ajoute finir le mix avec le tag mix', { title: 'finir le mix', tags: ['mix'] }],
    [
      'euh, tu peux ajouter une tâche appeler le studio demain s’il te plaît',
      { title: 'appeler le studio', due: '2026-10-24' },
    ],
    [
      'crée une tâche envoyer les stems #mix #urgent pour le 12 novembre',
      { title: 'envoyer les stems', tags: ['mix', 'urgent'], due: '2026-11-12' },
    ],
    ['rappelle-moi de payer le mastering', { title: 'payer le mastering' }],
    ['note de rappeler Paul dans 3 jours', { title: 'rappeler Paul', due: '2026-10-26' }],
    ['ajoute finir le mix sur le morceau boumboum', { title: 'finir le mix', track: 'boumboum' }],
    ['nouvelle tâche : acheter des cordes', { title: 'acheter des cordes' }],
    ['il faut que je finisse le clip avant lundi', { title: 'finisse le clip', due: '2026-10-26' }],
  ])('« %s »', (said, expected) => {
    expect(extractAdd(said, TODAY)).toEqual(expected);
  });

  it('refuses an addition without title (never asks for optional ones)', () => {
    expect(extractAdd('ajoute une tâche', TODAY)).toBeNull();
    expect(extractAdd('quelle heure est-il', TODAY)).toBeNull();
  });

  it('reads the list filters', () => {
    expect(extractList('qu’est-ce que j’ai à faire aujourd’hui')).toEqual({ filter: 'today' });
    expect(extractList('mes tâches en retard')).toEqual({ filter: 'overdue' });
    expect(extractList('qu’est-ce que j’ai cette semaine')).toEqual({ filter: 'week' });
    expect(extractList('mes tâches avec le tag mix')).toEqual({ tag: 'mix' });
    expect(extractList('liste mes tâches')).toEqual({});
  });

  it('finds the task to tick or delete', () => {
    expect(extractComplete('coche la tâche finir le mix')).toEqual({ task: 'finir le mix' });
    expect(extractComplete('marque appeler le studio comme faite')).toEqual({
      task: 'appeler le studio',
    });
    expect(extractComplete('j’ai fini le mix')).toEqual({ task: 'mix' });
    expect(extractDelete('supprime la tâche de la bio')).toEqual({ task: 'bio' });
    expect(extractDelete('efface acheter des cordes de la liste')).toEqual({
      task: 'acheter des cordes',
    });
    expect(extractDelete('supprime')).toBeNull();
  });
});

describe('ideas are not tasks', () => {
  it('« note une idée … » is left to the Boîte à idées', () => {
    expect(extractAdd('note une idée faire un clip', '2026-10-24')).toBeNull();
    expect(extractAdd('ajoute une nouvelle idée pochette', '2026-10-24')).toBeNull();
    expect(extractAdd('ajoute café aux extras', '2026-10-24')).toBeNull();
    expect(extractAdd('ajoute des filtres à la liste de courses', '2026-10-24')).toBeNull();
    expect(extractAdd('note de rappeler Paul', '2026-10-24')).toMatchObject({
      title: 'rappeler Paul',
    });
  });
});
