// Passages of a Reel's video: each one is a START and a duration, never a
// start and an end. One passage (the usual case) lasts exactly the Reel's
// duration; chained passages share it (their durations add up to it). Pure
// functions, unit-tested.

/** Shortest chained passage (s). */
export const MIN_PASSAGE = 0.5;
/** At most this many chained passages. */
export const MAX_PASSAGES = 12;

export interface Passage {
  sourceId: number;
  /** In the video, seconds (0.1 s steps). */
  start: number;
  /** Seconds (0.1 s steps). */
  duration: number;
}

const tenth = (n: number) => Math.round(n * 10) / 10;

/** Stored JSON → passages. Before v0.14 a passage had an `end`: its duration is end − start. */
export function readPassages(json: string): Passage[] {
  const raw = JSON.parse(json) as {
    sourceId: number;
    start: number;
    end?: number;
    duration?: number;
  }[];
  return raw.map((p) => ({
    sourceId: p.sourceId,
    start: p.start,
    duration: p.duration ?? Math.max(0, (p.end ?? p.start) - p.start),
  }));
}

export class PassageError extends Error {}

/**
 * Fits the passages to the Reel's duration `reel` (s):
 * - one passage: its duration IS the Reel's; its start is moved back if the
 *   window would pass the end of the video. A video shorter than the Reel is
 *   played from its start and looped (`loops`).
 * - chained passages: each keeps its duration (≥ 0.5 s, within its video), the
 *   LAST one takes what remains so that the total is exactly the Reel's; it is
 *   refused when that is impossible (said clearly).
 * `videoDuration(id)` is the length of each video.
 */
export function fitPassages(
  passages: Passage[],
  reel: number,
  videoDuration: (sourceId: number) => number,
): { passages: Passage[]; loops: boolean } {
  if (passages.length === 0) throw new PassageError('Choisis au moins un passage vidéo');
  if (passages.length > MAX_PASSAGES) {
    throw new PassageError(`${MAX_PASSAGES} passages au plus`);
  }
  const place = (p: Passage, duration: number): Passage => {
    const length = videoDuration(p.sourceId);
    return {
      sourceId: p.sourceId,
      start: tenth(
        Math.min(
          Math.max(0, Number.isFinite(p.start) ? p.start : 0),
          Math.max(0, length - duration),
        ),
      ),
      duration: tenth(duration),
    };
  };
  if (passages.length === 1) {
    const only = passages[0]!;
    const length = videoDuration(only.sourceId);
    if (length < reel) return { passages: [{ ...place(only, reel), start: 0 }], loops: true };
    return { passages: [place(only, reel)], loops: false };
  }
  const head = passages.slice(0, -1).map((p) => {
    const length = videoDuration(p.sourceId);
    const duration = Math.min(
      length,
      Math.max(MIN_PASSAGE, Number.isFinite(p.duration) ? p.duration : 0),
    );
    return place(p, duration);
  });
  const used = tenth(head.reduce((sum, p) => sum + p.duration, 0));
  const rest = tenth(reel - used);
  const last = passages[passages.length - 1]!;
  if (rest < MIN_PASSAGE) {
    throw new PassageError(
      `Les passages font déjà ${used.toFixed(1).replace('.', ',')} s pour un Reel de ${reel} s : raccourcis-en un`,
    );
  }
  if (rest > videoDuration(last.sourceId) + 1e-6) {
    throw new PassageError(
      `Le dernier passage devrait durer ${rest.toFixed(1).replace('.', ',')} s, plus que sa vidéo : allonge les autres`,
    );
  }
  return { passages: [...head, place(last, rest)], loops: false };
}

/** Engine segments (start, end) of fitted passages. */
export function toSegments(
  passages: Passage[],
): { sourceId: number; start: number; end: number }[] {
  return passages.map((p) => ({
    sourceId: p.sourceId,
    start: p.start,
    end: tenth(p.start + p.duration),
  }));
}
