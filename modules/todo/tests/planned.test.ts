// The planned start of a task (v0.35.0): the quick add's rule (decided with
// Thomas: an hour ending the phrase is when the task is planned), and what
// stays as before.
import { describe, expect, it } from 'vitest';
import { formatPlanned, parseTimeOfDay, splitQuickAdd } from '@hub/sdk/dates';

const TODAY = '2026-11-12'; // a Thursday
const q = (text: string) => splitQuickAdd(text, TODAY);

describe('planned start in the quick add', () => {
  it('an hour ending the phrase plans the task (today without a day)', () => {
    expect(q('appeler Paul 14h')).toMatchObject({
      title: 'appeler Paul',
      start: '2026-11-12T14:00',
      due: null,
    });
    expect(q('appeler Paul demain 14h')).toMatchObject({ start: '2026-11-13T14:00' });
    expect(q('appeler Paul demain à 14h')).toMatchObject({
      title: 'appeler Paul',
      start: '2026-11-13T14:00',
    });
    expect(q('rdv 14h demain')).toMatchObject({ title: 'rdv', start: '2026-11-13T14:00' });
    expect(q('rdv banque vendredi 10h30')).toMatchObject({
      title: 'rdv banque',
      start: '2026-11-13T10:30',
    });
    expect(q('rdv le 18 novembre à 9h30 #banque')).toMatchObject({
      title: 'rdv',
      tags: ['banque'],
      start: '2026-11-18T09:30',
    });
  });

  it('with an estimate, with a due date, with both', () => {
    expect(q('réviser stats ~2h mercredi 14h')).toMatchObject({
      title: 'réviser stats',
      start: '2026-11-18T14:00',
      durationMin: 120,
      due: null,
    });
    expect(q('préparer ~1h jeudi 9h avant vendredi')).toMatchObject({
      title: 'préparer',
      start: '2026-11-19T09:00',
      due: '2026-11-13',
      durationMin: 60,
    });
    expect(q('préparer ~1h avant vendredi jeudi 9h')).toMatchObject({
      title: 'préparer',
      start: '2026-11-19T09:00',
      due: '2026-11-13',
    });
    expect(q('appeler Paul 14h avant vendredi')).toMatchObject({
      title: 'appeler Paul',
      start: '2026-11-12T14:00',
      due: '2026-11-13',
    });
  });

  it('unchanged: a day alone is the due date; an hour inside the title or after « avant » is text', () => {
    expect(q('réviser stats ~2h mercredi')).toMatchObject({
      title: 'réviser stats',
      due: '2026-11-18',
      start: null,
    });
    expect(q('préparer la réunion ~1h avant vendredi')).toMatchObject({
      due: '2026-11-13',
      start: null,
    });
    expect(q('réunion 14h avec Léa')).toMatchObject({ title: 'réunion 14h avec Léa', start: null });
    expect(q('acheter du pain avant 19h')).toMatchObject({
      title: 'acheter du pain avant 19h',
      start: null,
    });
    expect(q('appel 25h')).toMatchObject({ title: 'appel 25h', start: null });
    // Only an hour: a title, not an empty task.
    expect(q('14h')).toMatchObject({ title: '14h', start: null });
    expect(q('finir le mix #mix pour lundi')).toMatchObject({ due: '2026-11-16', start: null });
    // « ce n'est pas une heure »: the whole text.
    expect(q('appeler Paul 14h #pro').plain).toBe('appeler Paul 14h');
  });

  it('times and display', () => {
    expect(parseTimeOfDay('9h')).toBe(540);
    expect(parseTimeOfDay('14:30')).toBe(870);
    expect(parseTimeOfDay('14:')).toBeNull();
    expect(parseTimeOfDay('24h')).toBeNull();
    expect(formatPlanned('2026-11-18T14:00', TODAY)).toBe('mer. 18 nov. 14:00');
  });
});
