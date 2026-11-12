// The estimated duration of a task (v0.34.0): written with « ~ » first, so
// that it is never taken for a time of day (« 14h » is an hour, « ~2h » a
// duration).
import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration, splitQuickAdd, takeDuration } from '../dates';

const TODAY = '2026-11-12'; // A Thursday.

describe('estimated duration', () => {
  it('reads the usual ways to write a duration', () => {
    expect(parseDuration('~2h')).toBe(120);
    expect(parseDuration('2 h')).toBe(120);
    expect(parseDuration('~1h30')).toBe(90);
    expect(parseDuration('1 h 30')).toBe(90);
    expect(parseDuration('1h30min')).toBe(90);
    expect(parseDuration('1,5h')).toBe(90);
    expect(parseDuration('1.5 h')).toBe(90);
    expect(parseDuration('~30min')).toBe(30);
    expect(parseDuration('45 minutes')).toBe(45);
    expect(parseDuration('90mn')).toBe(90);
    expect(parseDuration('2 heures')).toBe(120);
    expect(parseDuration('≈ 20 min')).toBe(20);
  });

  it('refuses what is not a duration', () => {
    for (const text of ['', 'deux heures', '0 min', '1h75', '1,5h30', 'demain', '14h00x', '200h'])
      expect(parseDuration(text), text).toBeNull();
  });

  it('formats it discreetly', () => {
    expect(formatDuration(120)).toBe('~2 h');
    expect(formatDuration(30)).toBe('~30 min');
    expect(formatDuration(90)).toBe('~1 h 30');
    expect(formatDuration(65)).toBe('~1 h 05');
  });

  it('only with « ~ » in a text: « 14h » stays a time of day', () => {
    expect(takeDuration('appeler le dentiste 14h')).toEqual({
      text: 'appeler le dentiste 14h',
      durationMin: null,
    });
    expect(takeDuration('réviser ~2h maths')).toEqual({ text: 'réviser maths', durationMin: 120 });
    expect(takeDuration('mail~2h')).toEqual({ text: 'mail~2h', durationMin: null });
  });

  it('in the quick add, with tags and a due date', () => {
    expect(splitQuickAdd('finir le mix #mix ~2h vendredi', TODAY)).toEqual({
      title: 'finir le mix',
      tags: ['mix'],
      due: '2026-11-13',
      dueText: 'vendredi',
      durationMin: 120,
    });
    expect(splitQuickAdd('préparer la réunion ~1h avant vendredi', TODAY)).toMatchObject({
      title: 'préparer la réunion',
      due: '2026-11-13',
      durationMin: 60,
    });
    expect(splitQuickAdd('ranger ~ 30 min', TODAY)).toMatchObject({
      title: 'ranger',
      due: null,
      durationMin: 30,
    });
    // Without « ~ »: unchanged behaviour (no duration).
    expect(splitQuickAdd('rdv 14h demain', TODAY)).toMatchObject({
      title: 'rdv 14h',
      due: '2026-11-13',
      durationMin: null,
    });
  });
});
