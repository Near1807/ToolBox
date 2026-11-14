// The « Ajouter » bar (v0.36.0, ADR 0046): this module's destination.
import { describe, expect, it } from 'vitest';
import agenda from '../frontend/index';

const TODAY = '2026-11-12'; // a Thursday

describe('the « Ajouter » bar', () => {
  it('Rendez-vous: the Agenda bar rules; a task phrase says to choose Tâche', () => {
    const a = agenda.quickAdd!;
    expect(a.preview('dentiste jeudi 14h 1h', TODAY)).toEqual({
      ok: true,
      text: 'Sera ajouté : Dentiste · jeu. 19 nov. 14:00–15:00',
    });
    expect(a.preview('badminton tous les jeudis 19h 2h', TODAY).ok).toBe(true);
    const task = a.preview('préparer ~1h avant vendredi', TODAY);
    expect(task.ok).toBe(false);
    expect(task.text).toContain('Tâche');
  });
});
