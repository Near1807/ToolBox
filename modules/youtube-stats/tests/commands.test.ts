import { describe, expect, it } from 'vitest';
import { extractDays, extractTrackStats } from '../backend/assistant';

describe('YouTube stats standardised commands', () => {
  it('reads the period of the summary (28 days otherwise)', () => {
    expect(extractDays('résumé de la chaîne')).toEqual({ days: '28' });
    expect(extractDays('les stats de la semaine')).toEqual({ days: '7' });
    expect(extractDays('les stats sur 90 jours')).toEqual({ days: '90' });
    expect(extractDays('les trois derniers mois')).toEqual({ days: '90' });
  });

  it('takes the track, and leaves the channel to the summary', () => {
    expect(extractTrackStats('combien de vues pour Aube')).toEqual({ track: 'Aube' });
    expect(extractTrackStats('les stats du morceau Aube')).toEqual({ track: 'Aube' });
    expect(extractTrackStats('comment marche Nuit blanche sur YouTube')).toEqual({
      track: 'Nuit blanche',
    });
    expect(extractTrackStats('les stats de la chaîne')).toBeNull();
    expect(extractTrackStats('les stats')).toBeNull();
  });
});
