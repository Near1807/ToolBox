import { describe, expect, it } from 'vitest';
import {
  bestWindow,
  buildReelArgs,
  buildReelAss,
  coverToFill,
  detailMap,
  detectOnsets,
  fillCrop,
  focusPoints,
  hookFontSize,
  planCuts,
  planShots,
  REEL,
  shotFrames,
  zoompanFilter,
  type ReelPlan,
} from '../backend/reel';

/** 16×16 image: flat, with a detailed (checkerboard) square at the given cell. */
function image(size: number, detail: { x: number; y: number; w: number; h: number }) {
  const pixels = new Uint8Array(size * size).fill(128);
  for (let y = detail.y; y < detail.y + detail.h; y++) {
    for (let x = detail.x; x < detail.x + detail.w; x++) {
      pixels[y * size + x] = (x + y) % 2 ? 255 : 0;
    }
  }
  return pixels;
}

/** Mono signal with short clicks (attacks) at the given times, over a quiet tone. */
function clicks(times: number[], duration: number, rate = 11025): Int16Array {
  const samples = new Int16Array(Math.round(duration * rate));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(800 * Math.sin(i / 20));
  for (const t of times) {
    const start = Math.round(t * rate);
    for (let i = 0; i < 400 && start + i < samples.length; i++) {
      samples[start + i] = Math.round(20000 * Math.exp(-i / 80) * (i % 2 ? 1 : -1));
    }
  }
  return samples;
}

describe('Reel image analysis', () => {
  it('finds where the details of the cover are', () => {
    const map = detailMap(image(16, { x: 2, y: 10, w: 4, h: 4 }), 16);
    const [first] = focusPoints(map, 16, 1);
    expect(first!.x).toBeGreaterThan(0.1);
    expect(first!.x).toBeLessThan(0.4);
    expect(first!.y).toBeGreaterThan(0.6);
  });

  it('keeps focus points apart and fills up with the centre', () => {
    const map = detailMap(image(16, { x: 6, y: 6, w: 3, h: 3 }), 16);
    const points = focusPoints(map, 16, 3, 0.3);
    expect(points).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const same = points[i]!.x === 0.5 && points[j]!.x === 0.5;
        if (!same) {
          expect(
            Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y),
          ).toBeGreaterThanOrEqual(0.3);
        }
      }
    }
  });

  it('crops a square cover to 9:16 around its details, never stretching it', () => {
    const map = detailMap(image(16, { x: 0, y: 4, w: 4, h: 8 }), 16);
    const crop = fillCrop(map, 16, 1);
    // Square cover filling a 9:16 frame: 56 % of its width is visible, all of its height.
    expect(crop.window.w).toBeCloseTo(0.5625, 3);
    expect(crop.window.h).toBe(1);
    expect(crop.offsetX).toBeLessThan(0.3);
    expect(crop.offsetY).toBe(0.5);
    expect(coverToFill({ x: 0.1, y: 0.5 }, crop.window).x).toBeLessThan(0.5);
  });

  it('centres the window when the image is evenly detailed', () => {
    expect(bestWindow([1, 1, 1, 1, 1, 1, 1, 1], 0.5)).toBe(0.5);
    expect(bestWindow([5, 1], 1)).toBe(0.5);
  });
});

describe('Reel beat detection', () => {
  it('finds the attacks within a frame', () => {
    const times = [1, 2, 3.5, 5];
    const onsets = detectOnsets(clicks(times, 6), 11025);
    for (const t of times) {
      expect(onsets.some((o) => Math.abs(o.time - t) < 1 / 30)).toBe(true);
    }
  });

  it('cuts on the attacks near the ideal positions, 4 to 6 shots', () => {
    const beats = Array.from({ length: 56 }, (_, i) => i * 0.5);
    const onsets = beats.map((time) => ({ time, strength: time % 2 === 0 ? 4 : 1 }));
    const cuts = planCuts(onsets, 28);
    expect(cuts.length).toBeGreaterThanOrEqual(3);
    expect(cuts.length).toBeLessThanOrEqual(5);
    for (const cut of cuts) expect(cut % 2).toBe(0); // on the strong beats
    for (let i = 1; i < cuts.length; i++)
      expect(cuts[i]! - cuts[i - 1]!).toBeGreaterThanOrEqual(1.6);
  });

  it('falls back to even cuts without attacks', () => {
    expect(planCuts([], 24)).toEqual([4.8, 9.6, 14.4, 19.2]);
  });

  it('splits the clip into whole frames', () => {
    expect(shotFrames([1, 2.5], 4)).toEqual([30, 45, 45]);
  });
});

describe('Reel shots and commands', () => {
  const details = [
    { x: 0.3, y: 0.4 },
    { x: 0.7, y: 0.6 },
    { x: 0.5, y: 0.2 },
  ];

  it('plans one shot per style, or one per cut', () => {
    const reveal = planShots('reveal', { duration: 28, details, coverFocus: { x: 0.4, y: 0.45 } });
    expect(reveal).toEqual([
      expect.objectContaining({ still: 'wide', frames: 840, zoomFrom: 3, zoomTo: 1 }),
    ]);
    const cuts = planShots('cuts', {
      duration: 28,
      cuts: [5, 10, 15, 20],
      details,
      coverFocus: details[0]!,
    });
    expect(cuts).toHaveLength(5);
    expect(cuts.reduce((sum, s) => sum + s.frames, 0)).toBe(840);
    expect(new Set(cuts.map((s) => s.still))).toEqual(new Set(['fill', 'wide']));
    expect(
      planShots('ambient', { duration: 28, details, coverFocus: details[0]! })[0]!.zoomTo,
    ).toBeLessThan(1.1);
  });

  it('builds a zoompan move that stays inside the image', () => {
    const filter = zoompanFilter(
      {
        still: 'fill',
        frames: 60,
        zoomFrom: 2,
        zoomTo: 1,
        from: { x: 0.3, y: 0.3 },
        to: { x: 0.5, y: 0.5 },
        easing: 'out',
      },
      1080,
      1920,
    );
    expect(filter).toContain("x='max(0,min(iw-iw/zoom,");
    expect(filter).toContain(':d=60:s=1080x1920:fps=30');
  });

  it('keeps the text discreet, left-aligned, inside the safe zones', () => {
    const ass = buildReelAss({
      width: 1080,
      height: 1920,
      title: 'Night Drive',
      artist: 'Thomas',
      tone: 'light',
    });
    expect(ass).toContain(`{\\pos(${REEL.safe.left},${REEL.text.titleTop})}Night Drive`);
    expect(ass).toContain('THOMAS');
    // No outline: border style 1 with outline 0.
    expect(ass).toMatch(/Style: Title,[^\n]*,1,0,1,7,/);
    expect(REEL.text.artistTop + REEL.text.artistSize).toBeLessThan(REEL.height - REEL.safe.bottom);
    expect(REEL.bar.top + REEL.bar.height).toBeLessThan(REEL.height - REEL.safe.bottom);
    const dark = buildReelAss({ width: 1080, height: 1920, title: 'x', artist: '', tone: 'dark' });
    expect(dark).toContain('&H00161616');
  });

  it('shows the hook phrase from the start, then fades it out', () => {
    const ass = buildReelAss({
      width: 1080,
      height: 1920,
      title: 'x',
      artist: 'y',
      tone: 'light',
      hook: 'Monte le son',
      hookSeconds: 4.5,
    });
    expect(ass).toMatch(
      /Dialogue: 1,0:00:00\.00,0:00:04\.50,Hook,[^\n]*\\fad\(0,700\)\}Monte le son/,
    );
    expect(hookFontSize('Monte le son', 112, 858)).toBe(112);
    expect(
      hookFontSize(
        'Une phrase bien plus longue qui doit tenir sur trois lignes au maximum',
        112,
        858,
      ),
    ).toBeLessThan(96);
  });

  it('assembles the Reel: square pixels, fade-out, sound copied, exact frame count', () => {
    const plan: ReelPlan = {
      style: 'ambient',
      width: 1080,
      height: 1920,
      duration: 28,
      shots: planShots('ambient', { duration: 28, details, coverFocus: details[0]! }),
      encoding: { videoBitrate: '6M', maxrate: '8M', bufsize: '12M', gop: 60 },
      files: {
        fill: 'fill.png',
        wide: 'wide.png',
        scrim: 'scrim.png',
        dust: 'dust.png',
        ass: 'text.ass',
        fontsDir: 'fonts',
        audio: 'soundtrack.m4a',
        output: 'out.mp4',
      },
    };
    const args = buildReelArgs(plan);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('fade=t=out:st=27.5:d=0.5,format=yuv420p,setsar=1');
    expect(graph).not.toContain('showcqt');
    expect(graph).toContain('alphamerge[bar]'); // progress bar
    expect(graph).toContain('vstack[dust]');
    expect(args).toEqual(expect.arrayContaining(['-frames:v', '840', '-c:a', 'copy']));
    expect(args.at(-1)).toBe('out.mp4');
  });
});
