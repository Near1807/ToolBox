// Default excerpts of the Reels: the loudest windows of the track, outside the
// intro and the outro, without overlap (pure, unit-tested).

/** Start (s) of `count` excerpts of `clip` seconds on a waveform of `peaks` bars. */
export function suggestStarts(
  peaks: number[],
  durationSec: number,
  clip: number,
  count: number,
): number[] {
  if (durationSec <= clip) return Array.from({ length: count }, () => 0);
  const bars = peaks.length;
  const perBar = durationSec / bars;
  const window = Math.max(1, Math.round(clip / perBar));
  const margin = Math.min(15, Math.max(5, durationSec * 0.08));
  const first = Math.ceil(margin / perBar);
  const last = Math.floor((durationSec - margin - clip) / perBar);
  const starts: number[] = [];
  const taken: [number, number][] = [];
  for (let n = 0; n < count; n++) {
    let best = -1;
    let bestScore = -1;
    for (let i = Math.max(0, first); i <= Math.max(first, last); i++) {
      const from = i * perBar;
      if (from + clip > durationSec) break;
      if (taken.some(([a, b]) => from < b && from + clip > a)) continue;
      let score = 0;
      for (let j = i; j < Math.min(bars, i + window); j++) score += peaks[j]! ** 2;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    // No room left: excerpts may overlap (a short track).
    const start =
      best === -1 ? Math.max(0, ((durationSec - clip) * (n + 1)) / (count + 1)) : best * perBar;
    const rounded = Math.round(start * 10) / 10;
    starts.push(rounded);
    taken.push([rounded, rounded + clip]);
  }
  return starts;
}

/** Keeps an excerpt inside the track. */
export function clampExcerpt(start: number, clip: number, durationSec: number): number {
  return Math.round(Math.min(Math.max(0, start), Math.max(0, durationSec - clip)) * 10) / 10;
}
