import { describe, expect, it } from 'vitest';
import {
  extractPeriod,
  extractRelease,
  periodRange,
  review,
  type AgendaItem,
} from '../backend/assistant';
import { weekEnd } from '../backend/time';

describe('release planner standardised commands', () => {
  it('reads the period: this calendar week, next week, 7 days, today, late', () => {
    expect(extractPeriod('qu’est-ce que je dois publier aujourd’hui')).toEqual({ period: 'today' });
    expect(extractPeriod('quel est le planning de cette semaine')).toEqual({ period: 'week' });
    expect(extractPeriod('où en sont les sorties de cette semaine')).toEqual({ period: 'week' });
    expect(extractPeriod('le point sur la semaine')).toEqual({ period: 'week' });
    expect(extractPeriod('le planning de la semaine prochaine')).toEqual({ period: 'next-week' });
    expect(extractPeriod('qu’est-ce qui sort les 7 prochains jours')).toEqual({ period: 'next7' });
    expect(extractPeriod('qu’est-ce qui est en retard dans le planning')).toEqual({
      period: 'late',
    });
    expect(extractPeriod('qu’est-ce qui sort')).toEqual({ period: 'today' });
  });

  it('takes the track of a release, never a period', () => {
    expect(extractRelease('où en est la sortie de Aube')).toEqual({ track: 'Aube' });
    expect(extractRelease('quand sort Nuit blanche ?')).toEqual({ track: 'Nuit blanche' });
    expect(extractRelease('quand sort')).toBeNull();
    expect(extractRelease('où en sont les sorties de cette semaine')).toBeNull();
    expect(extractRelease('le point sur la sortie d’Obsidian')).toEqual({ track: 'Obsidian' });
  });
});

describe('« cette semaine » = the calendar week, Monday → Sunday', () => {
  // 2026-10-26 is a Monday, 2026-10-28 a Wednesday, 2026-11-01 a Sunday.
  it.each([
    ['2026-10-26', ['2026-10-26', '2026-11-01'], ['2026-11-02', '2026-11-08']],
    ['2026-10-28', ['2026-10-26', '2026-11-01'], ['2026-11-02', '2026-11-08']],
    ['2026-11-01', ['2026-10-26', '2026-11-01'], ['2026-11-02', '2026-11-08']],
  ])('asked on %s', (today, week, next) => {
    expect(periodRange('week', today)).toEqual(week);
    expect(periodRange('next-week', today)).toEqual(next);
    expect(weekEnd(today)).toBe(week[1]);
  });

  it('the 7 next days start today', () => {
    expect(periodRange('next7', '2026-10-28')).toEqual(['2026-10-28', '2026-11-03']);
  });

  it('what happened (published, late), then what is to come, in the order of the days', () => {
    const item = (date: string, label: string, status: AgendaItem['status'], late = false) =>
      ({
        trackId: 1,
        trackTitle: 'Aube',
        label,
        platform: label.startsWith('Reel') ? 'instagram' : 'youtube',
        date,
        time: '18:00',
        status,
        late,
      }) as AgendaItem;
    const parts = review(
      [
        item('2026-10-30', 'Short 2', 'scheduled'),
        item('2026-10-26', 'Vidéo', 'published'),
        item('2026-10-27', 'Reel 1', 'planned', true),
        item('2026-10-31', 'Reel 2', 'planned'),
      ],
      '2026-10-28',
    );
    expect(parts.done.map((i) => i.label)).toEqual(['Vidéo']);
    expect(parts.late.map((i) => i.label)).toEqual(['Reel 1']);
    expect(parts.upcoming.map((i) => i.label)).toEqual(['Short 2', 'Reel 2']);
  });
});
