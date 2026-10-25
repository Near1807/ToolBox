// The phrases of the assistant for the Boîte à idées, taken apart by code.
import { describe, expect, it } from 'vitest';
import { extractAdd, extractTagParam } from '../backend/commands';

describe('ideas: standardised commands', () => {
  it('« idée : … #tag », « note une idée … », « j’ai une idée : … »', () => {
    expect(extractAdd('idée : un break avec des cordes #arrangement')).toEqual({
      text: 'un break avec des cordes',
      tags: ['arrangement'],
    });
    expect(extractAdd('Note une idée faire un live sur Twitch.')).toEqual({
      text: 'faire un live sur Twitch',
    });
    expect(extractAdd('j’ai une idée : remixer Nuit Blanche en lo-fi avec le tag remix')).toEqual({
      text: 'remixer Nuit Blanche en lo-fi',
      tags: ['remix'],
    });
    expect(extractAdd('nouvelle idée, sample de pluie pour l’intro')).toEqual({
      text: 'sample de pluie pour l’intro',
    });
    expect(extractAdd('garde l’idée d’un featuring avec Léa')).toEqual({
      text: 'un featuring avec Léa',
    });
  });
  it('never takes a reading or another command for an idea', () => {
    expect(extractAdd('une idée au hasard')).toBeNull();
    expect(extractAdd('idée au hasard')).toBeNull();
    expect(extractAdd('montre mes idées')).toBeNull();
    expect(extractAdd('ajoute une tâche finir le mix')).toBeNull();
  });
  it('the tag of a reading', () => {
    expect(extractTagParam('montre mes idées #musique')).toEqual({ tag: 'musique' });
    expect(extractTagParam('une idée au hasard dans le tag clip')).toEqual({ tag: 'clip' });
    expect(extractTagParam('mes idées')).toEqual({});
  });
});
