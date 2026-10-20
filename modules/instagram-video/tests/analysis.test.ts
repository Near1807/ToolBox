import { describe, expect, it } from 'vitest';
import {
  analyzeSamples,
  clampExcerpt,
  downsamplePeaks,
  introOutroSkip,
  overlaps,
  pickExcerpts,
} from '../backend/analysis';
import { buildCaption, buildHashtags, itemFileName, packFolderName } from '../backend/caption';

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

  it('picks 4 distinct excerpts, most energetic first, outside intro and outro', () => {
    // 3 min: quiet, with loud passages at 40-70 s, 100-130 s and 140-170 s (outro).
    const levels = Array.from({ length: 180 }, (_, t) =>
      t >= 40 && t < 70 ? 0.9 : t >= 100 && t < 130 ? 0.7 : t >= 168 ? 1 : 0.2,
    );
    const analysis = analyzeSamples(signal(levels), 1000, 0.5);
    const { starts } = pickExcerpts(analysis, { count: 4, clipSec: 28 });
    expect(starts).toHaveLength(4);
    expect(starts[0]).toBeGreaterThanOrEqual(40);
    expect(starts[0]! + 28).toBeLessThanOrEqual(70.5);
    expect(starts[1]).toBeGreaterThanOrEqual(100);
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) expect(overlaps(starts[a]!, starts[b]!, 28)).toBe(false);
    }
    // The loud outro (last 12 s, inside the skipped 14.4 s) is never chosen.
    for (const start of starts)
      expect(start + 28).toBeLessThanOrEqual(180 - introOutroSkip(180) + 0.5);
  });

  it('returns fewer excerpts for a short track, or overlapping ones when allowed', () => {
    const analysis = analyzeSamples(signal(Array.from({ length: 90 }, () => 0.5)), 1000, 0.5);
    expect(pickExcerpts(analysis, { count: 4, clipSec: 28 }).starts.length).toBeLessThan(4);
    const overlapping = pickExcerpts(analysis, {
      count: 4,
      clipSec: 28,
      allowOverlap: true,
    }).starts;
    expect(overlapping.length).toBeGreaterThan(
      pickExcerpts(analysis, { count: 4, clipSec: 28 }).starts.length,
    );
  });

  it('keeps clear of excerpts already taken', () => {
    const analysis = analyzeSamples(signal(Array.from({ length: 200 }, () => 0.5)), 1000, 0.5);
    const { starts } = pickExcerpts(analysis, { count: 2, clipSec: 28, fixed: [60] });
    expect(starts).toHaveLength(2);
    for (const start of starts) expect(overlaps(start, 60, 28)).toBe(false);
  });

  it('starts at 0 when the track is shorter than one excerpt', () => {
    expect(
      pickExcerpts(
        { rms: [0.5, 0.5], windowSec: 0.1, durationSec: 0.2 },
        { count: 4, clipSec: 28 },
      ),
    ).toEqual({
      starts: [0],
    });
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
  const input = {
    template: '{titre} — {artiste}\n\nLien en bio\n\n{hashtags}',
    title: 'Night Drive',
    artist: 'Thomas',
    tags: ['lofi'],
    hashtags: '#reels #LoFi',
  };

  it('fills the template with title, artist and hashtags', () => {
    expect(buildCaption(input)).toBe('Night Drive — Thomas\n\nLien en bio\n\n#lofi #reels');
  });

  it('drops the separator without artist, and falls back to the default template', () => {
    expect(buildCaption({ ...input, artist: '' })).toBe(
      'Night Drive\n\nLien en bio\n\n#lofi #reels',
    );
    expect(buildCaption({ ...input, template: '  ', hashtags: '' })).toBe(
      'Night Drive — Thomas\n\nNouveau son 🎧 lien en bio\n\n#lofi',
    );
  });

  it('dedupes hashtags and names files safely', () => {
    expect(buildHashtags(['a b', 'A'], 'ab, #c')).toEqual(['#ab', '#A', '#c']);
    expect(packFolderName({ title: 'Mix: v2?', artist: 'Thomas' })).toBe('Thomas - Mix v2');
    expect(itemFileName('Mix: v2?', 3)).toBe('Mix v2 - Reel 3.mp4');
    expect(itemFileName('Night Drive', 0)).toBe('Night Drive - Post.jpg');
  });
});
