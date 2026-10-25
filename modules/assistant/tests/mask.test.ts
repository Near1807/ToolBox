// What the parameters leave of a phrase before it is compared with the examples.
import { describe, expect, it } from 'vitest';
import { maskParams } from '../backend/matcher';

describe('masking the parameters', () => {
  it('a tag written « #mix » goes with its value, like « avec le tag mix »', () => {
    const params = { title: 'finir le mix', tags: ['studio'] };
    expect(maskParams('ajoute une tâche finir le mix #studio', params)).toBe('ajoute une tache');
    expect(maskParams('ajoute une tâche finir le mix avec le tag studio', params)).toBe(
      'ajoute une tache',
    );
    expect(
      maskParams('idée : un break #arrangement', { text: 'un break', tags: ['arrangement'] }),
    ).toBe('idee');
  });
});
