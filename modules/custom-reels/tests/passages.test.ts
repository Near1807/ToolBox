import { describe, expect, it } from 'vitest';
import { fitPassages, PassageError, readPassages, toSegments } from '../backend/passages';

/** Video 1 lasts 120 s, video 2 lasts 10 s. */
const length = (id: number) => (id === 1 ? 120 : 10);

describe('passages: a start and the Reel’s duration', () => {
  it('one passage lasts exactly the Reel’s duration, from its start', () => {
    const { passages, loops } = fitPassages([{ sourceId: 1, start: 72, duration: 3 }], 28, length);
    expect(passages).toEqual([{ sourceId: 1, start: 72, duration: 28 }]);
    expect(loops).toBe(false);
    expect(toSegments(passages)).toEqual([{ sourceId: 1, start: 72, end: 100 }]);
  });

  it('a longer Reel resizes the window from its start, moved back at the end of the video', () => {
    const at = (start: number, reel: number) =>
      fitPassages([{ sourceId: 1, start, duration: 28 }], reel, length).passages[0]!;
    expect(at(72, 40)).toMatchObject({ start: 72, duration: 40 }); // 72 → 112, fits
    expect(at(100, 40)).toMatchObject({ start: 80, duration: 40 }); // would pass 120: moved back
    expect(at(-5, 15)).toMatchObject({ start: 0 });
  });

  it('a video shorter than the Reel is played from its start and looped', () => {
    const fitted = fitPassages([{ sourceId: 2, start: 4, duration: 28 }], 28, length);
    expect(fitted).toEqual({ passages: [{ sourceId: 2, start: 0, duration: 28 }], loops: true });
  });

  it('chained passages add up to the Reel’s duration: the last one takes the rest', () => {
    const { passages } = fitPassages(
      [
        { sourceId: 1, start: 10, duration: 12.34 },
        { sourceId: 2, start: 9.5, duration: 3 },
        { sourceId: 1, start: 50, duration: 99 },
      ],
      28,
      length,
    );
    expect(passages).toEqual([
      { sourceId: 1, start: 10, duration: 12.3 },
      { sourceId: 2, start: 7, duration: 3 }, // moved back inside its 10 s video
      { sourceId: 1, start: 50, duration: 12.7 },
    ]);
    expect(passages.reduce((sum, p) => sum + p.duration, 0)).toBeCloseTo(28, 6);
  });

  it('refuses chains that cannot add up to the Reel’s duration, with the reason', () => {
    expect(() =>
      fitPassages(
        [
          { sourceId: 1, start: 0, duration: 20 },
          { sourceId: 1, start: 30, duration: 8 },
          { sourceId: 1, start: 60, duration: 5 },
        ],
        28,
        length,
      ),
    ).toThrow(/font déjà 28,0 s pour un Reel de 28 s/);
    expect(() =>
      fitPassages(
        [
          { sourceId: 1, start: 0, duration: 5 },
          { sourceId: 2, start: 0, duration: 5 },
        ],
        28,
        length,
      ),
    ).toThrow(PassageError);
    expect(() => fitPassages([], 28, length)).toThrow(/au moins un passage/);
  });

  it('reads the passages saved before v0.14 (start, end)', () => {
    expect(readPassages(JSON.stringify([{ sourceId: 1, start: 2, end: 9.5 }]))).toEqual([
      { sourceId: 1, start: 2, duration: 7.5 },
    ]);
    expect(readPassages(JSON.stringify([{ sourceId: 1, start: 2, duration: 4 }]))).toEqual([
      { sourceId: 1, start: 2, duration: 4 },
    ]);
  });
});
