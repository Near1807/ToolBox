import { describe, expect, it } from 'vitest';
import { extractPeriod, extractRelease } from '../backend/assistant';

describe('release planner standardised commands', () => {
  it('reads the period of the agenda', () => {
    expect(extractPeriod('qu’est-ce que je dois publier aujourd’hui')).toEqual({ period: 'today' });
    expect(extractPeriod('euh qu’est-ce que je publie cette semaine')).toEqual({ period: 'week' });
    expect(extractPeriod('qu’est-ce qui est en retard dans le planning')).toEqual({
      period: 'late',
    });
    expect(extractPeriod('qu’est-ce qui sort')).toEqual({ period: 'today' });
  });

  it('takes the track of a release', () => {
    expect(extractRelease('où en est la sortie de Aube')).toEqual({ track: 'Aube' });
    expect(extractRelease('quand sort Nuit blanche ?')).toEqual({ track: 'Nuit blanche' });
    expect(extractRelease('quand sort')).toBeNull();
  });
});
