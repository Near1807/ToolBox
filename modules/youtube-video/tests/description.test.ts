import { describe, expect, it } from 'vitest';
import {
  buildDescription,
  buildHashtags,
  buildVideoTitle,
  videoFileName,
} from '../backend/description';

describe('YouTube texts', () => {
  it('formats the title as "Artist - Title"', () => {
    expect(buildVideoTitle({ title: 'Night Drive', artist: 'Thomas' })).toBe(
      'Thomas - Night Drive',
    );
    expect(buildVideoTitle({ title: 'Night Drive', artist: '' })).toBe('Night Drive');
  });

  it('merges track tags and default hashtags without duplicates', () => {
    expect(buildHashtags(['lofi', 'chill beats'], '#LoFi #music, beat')).toEqual([
      '#lofi',
      '#chillbeats',
      '#music',
      '#beat',
    ]);
  });

  it('builds the description with date, links and hashtags', () => {
    const text = buildDescription({
      title: 'Night Drive',
      artist: 'Thomas',
      releaseDate: '2026-11-01',
      tags: ['lofi'],
      links: 'Spotify : https://example.com',
      hashtags: '#music',
    });
    expect(text).toBe(
      'Thomas - Night Drive\nSortie le 1 novembre 2026\n\nSpotify : https://example.com\n\n#lofi #music',
    );
  });

  it('makes safe Windows file names', () => {
    expect(videoFileName({ title: 'What? / Why: "now"', artist: 'A*B' }, 'YouTube')).toBe(
      'A B - What Why now (YouTube).mp4',
    );
  });
});
