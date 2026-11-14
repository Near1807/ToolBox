// The « Ajouter » bar (v0.36.0, ADR 0046): this module's destination.
import { describe, expect, it } from 'vitest';
import todo from '../frontend/index';

const TODAY = '2026-11-12'; // a Thursday

describe('the « Ajouter » bar', () => {
  it('Tâche: the To-do quick-add rules (tags, due date, estimate, planned hour)', () => {
    const t = todo.quickAdd!;
    expect(t.preview('réviser stats ~2h mercredi 14h #cours', TODAY)).toMatchObject({
      ok: true,
      text: 'Tâche « réviser stats » · #cours · prévue mer. 18 nov. 14:00 · ~2 h',
    });
    expect(t.preview('finir le mix pour vendredi', TODAY)).toMatchObject({
      ok: true,
      text: expect.stringContaining('échéance'),
    });
    expect(t.preview('#tag', TODAY).ok).toBe(false);
  });
});
