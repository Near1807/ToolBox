import { describe, expect, it } from 'vitest';
import { fillTemplate, formatTags, parseTags, toTemplate } from '@hub/sdk/texts';

describe('shared text templates', () => {
  const values = {
    titre: 'Night Drive',
    artiste: 'Thomas',
    titre_youtube: 'Thomas - Night Drive',
    sortie: '',
    hashtags: '#lofi #chill',
  };

  it('fills placeholders, keeps unknown ones and collapses blank lines', () => {
    expect(fillTemplate('{titre_youtube}\n{sortie}\n\n{liens}\n\n{hashtags}', values)).toBe(
      'Thomas - Night Drive\n\n{liens}\n\n#lofi #chill',
    );
  });

  it('turns an edited text back into a template (longest values first)', () => {
    const text = 'Thomas - Night Drive (clip)\nNight Drive par Thomas\n#lofi #chill';
    const template = toTemplate(text, values);
    expect(template).toBe('{titre_youtube} (clip)\n{titre} par {artiste}\n{hashtags}');
    expect(
      fillTemplate(template, { ...values, titre: 'Rain', titre_youtube: 'Thomas - Rain' }),
    ).toBe('Thomas - Rain (clip)\nRain par Thomas\n#lofi #chill');
  });

  it('ignores values too short to be meaningful', () => {
    expect(toTemplate('Episode 1 of 4', { n: '1', total: '4' })).toBe('Episode 1 of 4');
  });

  it('reads tags with or without #, without duplicates', () => {
    expect(parseTags('lofi, #chill ,\nLofi, , beat')).toEqual(['lofi', 'chill', 'beat']);
    expect(formatTags(['a', 'b'])).toBe('a, b');
  });
});
