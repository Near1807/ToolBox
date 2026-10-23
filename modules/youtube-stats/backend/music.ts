// Retention × music: the energy of the track (or of a Short's excerpt) on the
// same axis as the retention curve, its sections estimated from the energy
// (intro, montée, drop, pause, outro), and the places where viewers leave or
// watch again, tied to the section they fall in.
import type { RetentionPoint } from '../shared';
import { mean, smooth } from './stats';

export type SectionLabel = 'Intro' | 'Montée' | 'Drop' | 'Pause' | 'Outro' | 'Corps';

export interface Section {
  /** 0..1 of the segment (whole track, or the excerpt of a Short). */
  from: number;
  to: number;
  label: SectionLabel;
  /** Mean energy (0..1) of the section. */
  energy: number;
}

/**
 * Energy of a segment of the track, resampled to `points` values on 0..1 of
 * the segment. `peaks` covers the whole track (videoEngine.waveform).
 */
export function segmentEnergy(
  peaks: number[],
  trackDuration: number,
  start: number,
  duration: number,
  points = 100,
): number[] {
  if (peaks.length === 0 || trackDuration <= 0) return [];
  const max = Math.max(...peaks, 1e-6);
  return Array.from({ length: points }, (_, i) => {
    const t = start + ((i + 0.5) / points) * duration;
    const position = Math.min(
      peaks.length - 1,
      Math.max(0, Math.floor((t / trackDuration) * peaks.length)),
    );
    return peaks[position]! / max;
  });
}

/**
 * Sections estimated from the energy only (no musical analysis): a drop is a
 * sharp rise to a high level, a montée the rising stretch before it, a pause a
 * low stretch in the middle, intro/outro the low stretches at the ends.
 */
export function sections(energy: number[]): Section[] {
  const n = energy.length;
  if (n < 10) return [];
  const level = smooth(energy, Math.max(3, Math.round(n / 25) | 1));
  const high = mean(level) + 0.15 * (Math.max(...level) - Math.min(...level));
  const low = mean(level) - 0.15 * (Math.max(...level) - Math.min(...level));
  const labels: SectionLabel[] = level.map((value, i) => {
    if (value <= low) {
      if (i < n * 0.2 && level.slice(0, i + 1).every((v) => v <= high)) return 'Intro';
      if (i > n * 0.8 && level.slice(i).every((v) => v <= high)) return 'Outro';
      return 'Pause';
    }
    return value >= high ? 'Drop' : 'Corps';
  });
  // A "Corps" stretch that leads into a Drop and rises is a Montée.
  for (let i = n - 2; i >= 0; i--) {
    if (labels[i] === 'Corps' && (labels[i + 1] === 'Drop' || labels[i + 1] === 'Montée')) {
      if (level[i + 1]! >= level[i]! - 0.01) labels[i] = 'Montée';
    }
  }
  const result: Section[] = [];
  let startIndex = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || labels[i] !== labels[startIndex]) {
      result.push({
        from: startIndex / n,
        to: i / n,
        label: labels[startIndex]!,
        energy: mean(energy.slice(startIndex, i)),
      });
      startIndex = i;
    }
  }
  // Merge sections shorter than 3 % into their neighbour (noise).
  const merged: Section[] = [];
  for (const section of result) {
    const last = merged[merged.length - 1];
    if (last && section.to - section.from < 0.03) {
      last.to = section.to;
    } else if (last && last.label === section.label) {
      last.to = section.to;
    } else {
      merged.push({ ...section });
    }
  }
  return merged;
}

export function sectionAt(list: Section[], ratio: number): Section | null {
  return list.find((s) => ratio >= s.from && ratio < s.to) ?? list[list.length - 1] ?? null;
}

export interface RetentionEvent {
  ratio: number;
  kind: 'drop' | 'rewatch';
  /** Change of the watch ratio over the step (negative for a drop). */
  change: number;
  section: SectionLabel | null;
}

/**
 * Notable moments of a retention curve: the steepest losses (outside the first
 * 5 %, where every video loses viewers) and the stretches watched again.
 */
export function retentionEvents(
  points: RetentionPoint[],
  list: Section[],
  top = 3,
): RetentionEvent[] {
  if (points.length < 10) return [];
  const steps = points.slice(1).map((p, i) => ({
    ratio: p.ratio,
    change: p.watch - points[i]!.watch,
  }));
  // Steeper than usual for this video (relative: Shorts lose slowly, long videos fast).
  const typicalLoss = mean(steps.filter((s) => s.ratio > 0.05).map((s) => s.change));
  const drops = steps
    .filter((s) => s.ratio > 0.05 && s.change < Math.min(typicalLoss * 1.5, -0.001))
    .sort((a, b) => a.change - b.change)
    .slice(0, top)
    .map((s) => ({ ...s, kind: 'drop' as const }));
  const rewatches = steps
    .filter((s) => s.change > 0.002)
    .sort((a, b) => b.change - a.change)
    .slice(0, top)
    .map((s) => ({ ...s, kind: 'rewatch' as const }));
  return [...drops, ...rewatches]
    .map((e) => ({ ...e, section: sectionAt(list, e.ratio)?.label ?? null }))
    .sort((a, b) => a.ratio - b.ratio);
}

/** Mean watch ratio by section kind, and the local loss per 10 % of the video. */
export function retentionBySection(
  points: RetentionPoint[],
  list: Section[],
): { label: SectionLabel; lossPer10: number; share: number }[] {
  const result = new Map<SectionLabel, { loss: number; length: number }>();
  for (let i = 1; i < points.length; i++) {
    const ratio = points[i]!.ratio;
    if (ratio <= 0.05) continue;
    const section = sectionAt(list, ratio);
    if (!section) continue;
    const entry = result.get(section.label) ?? { loss: 0, length: 0 };
    entry.loss += points[i]!.watch - points[i - 1]!.watch;
    entry.length += ratio - points[i - 1]!.ratio;
    result.set(section.label, entry);
  }
  return [...result.entries()]
    .filter(([, e]) => e.length > 0)
    .map(([label, e]) => ({ label, lossPer10: (e.loss / e.length) * 0.1, share: e.length }));
}
