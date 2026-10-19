import { describe, expect, it } from 'vitest';
import { analyzeSamples, clampExcerpt, downsamplePeaks, suggestStart } from '../backend/analysis';
import { buildCaption, buildHashtags, reelFileName } from '../backend/caption';

/** 1 kHz sample rate, `levels` = amplitude per second. */
function signal(levels: number[]): Int16Array {
  const samples = new Int16Array(levels.length * 1000);
  levels.forEach((level, second) => {
    for (let i = 0; i < 1000; i++)
      samples[second * 1000 + i] = Math.round(Math.sin(i) * level * 32767);
  });
  return samples;
}

describe('audio analysis', () => {
  it('computes peaks and RMS per window', () => {
    const analysis = analyzeSamples(signal([0, 1, 0.5]), 1000, 1);
    expect(analysis.durationSec).toBe(3);
    expect(analysis.peaks[0]).toBe(0);
    expect(analysis.peaks[1]).toBeGreaterThan(0.99);
    expect(analysis.rms[1]).toBeGreaterThan(analysis.rms[2]!);
  });

  it('suggests the most energetic passage', () => {
    // Quiet intro, loud drop at 6–9 s, quiet outro.
    const analysis = analyzeSamples(
      signal([0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.9, 1, 0.9, 0.2, 0.1, 0.1]),
      1000,
      0.5,
    );
    expect(suggestStart(analysis, 3)).toBe(6);
  });

  it('starts at 0 when the track is shorter than the excerpt', () => {
    expect(suggestStart({ rms: [0.5, 0.5], windowSec: 0.1 }, 30)).toBe(0);
  });

  it('keeps the excerpt inside the track', () => {
    expect(clampExcerpt(170, 30, 180)).toEqual({ start: 150, duration: 30 });
    expect(clampExcerpt(-5, 30, 180)).toEqual({ start: 0, duration: 30 });
    expect(clampExcerpt(10, 30, 20)).toEqual({ start: 0, duration: 20 });
  });

  it('downsamples peaks for drawing', () => {
    expect(downsamplePeaks([0.1, 0.5, 0.2, 0.9], 2)).toEqual([0.5, 0.9]);
    expect(downsamplePeaks([0.1], 10)).toEqual([0.1]);
  });
});

describe('caption', () => {
  it('builds the caption with call to action and hashtags', () => {
    expect(
      buildCaption({
        title: 'Night Drive',
        artist: 'Thomas',
        tags: ['lofi'],
        callToAction: 'Lien en bio',
        hashtags: '#reels #LoFi',
      }),
    ).toBe('Night Drive — Thomas\n\nLien en bio\n\n#lofi #reels');
  });

  it('dedupes hashtags and names files safely', () => {
    expect(buildHashtags(['a b', 'A'], 'ab, #c')).toEqual(['#ab', '#A', '#c']);
    expect(reelFileName({ title: 'Mix: v2?', artist: 'Thomas' })).toBe(
      'Thomas - Mix v2 (Reel).mp4',
    );
  });
});
