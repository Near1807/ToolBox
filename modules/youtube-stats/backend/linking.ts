// Videos published outside ToolBox: a track is suggested from the title
// (words of the track's title found in the video's title).

const normalise = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const STOP = new Set([
  'the',
  'le',
  'la',
  'les',
  'de',
  'des',
  'du',
  'a',
  'and',
  'et',
  'feat',
  'ft',
  'official',
  'clip',
  'shorts',
  'video',
]);

/** 0..1: share of the track title's words found in the video title (all of them for 1). */
export function titleScore(videoTitle: string, trackTitle: string): number {
  const words = normalise(trackTitle)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w));
  if (words.length === 0) return 0;
  const haystack = ` ${normalise(videoTitle)} `;
  const found = words.filter((w) => haystack.includes(` ${w} `)).length;
  return found / words.length;
}

/** Best track for a video title, when at least half of its title is there. */
export function suggestTrack<T extends { id: number; title: string }>(
  videoTitle: string,
  tracks: T[],
): { track: T; score: number } | null {
  let best: { track: T; score: number } | null = null;
  for (const track of tracks) {
    const score = titleScore(videoTitle, track.title);
    // Longer titles first on ties (« Aube rouge » before « Aube »).
    if (
      score >= 0.5 &&
      (!best ||
        score > best.score ||
        (score === best.score && track.title.length > best.track.title.length))
    ) {
      best = { track, score };
    }
  }
  return best;
}
