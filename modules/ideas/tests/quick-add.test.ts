// The « Ajouter » bar (v0.36.0, ADR 0046): this module's destination.
import { describe, expect, it } from 'vitest';
import ideas from '../frontend/index';

const TODAY = '2026-11-12'; // a Thursday

describe('the « Ajouter » bar', () => {
  it('Idée: a title and its tags', () => {
    const i = ideas.quickAdd!;
    expect(i.preview('refrain en mineur #mix #Voix', TODAY)).toEqual({
      ok: true,
      text: 'Idée « refrain en mineur » · #mix #voix',
    });
    expect(i.preview('  #mix ', TODAY).ok).toBe(false);
  });
});
