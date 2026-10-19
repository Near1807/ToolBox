// Pure builders of the YouTube title and description (unit-tested).

export interface DescriptionInput {
  title: string;
  artist: string;
  releaseDate: string | null;
  tags: string[];
  links: string;
  hashtags: string;
}

/** "Artist - Title", the usual format for music on YouTube. */
export function buildVideoTitle(input: Pick<DescriptionInput, 'title' | 'artist'>): string {
  return input.artist ? `${input.artist} - ${input.title}` : input.title;
}

/** Hashtags from the track tags then the default ones, without duplicates (max 15). */
export function buildHashtags(tags: string[], defaults: string): string[] {
  const fromDefaults = defaults.split(/[\s,]+/).filter(Boolean);
  const all = [...tags, ...fromDefaults]
    .map((tag) => tag.replace(/^#+/, '').replace(/\s+/g, '').trim())
    .filter(Boolean)
    .map((tag) => `#${tag}`);
  const seen = new Set<string>();
  return all
    .filter((tag) => !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()))
    .slice(0, 15);
}

export function buildDescription(input: DescriptionInput): string {
  const lines = [`${buildVideoTitle(input)}`];
  if (input.releaseDate) {
    const date = new Date(`${input.releaseDate}T12:00:00`);
    lines.push(
      `Sortie le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    );
  }
  const links = input.links.trim();
  if (links) lines.push('', links);
  const hashtags = buildHashtags(input.tags, input.hashtags);
  if (hashtags.length) lines.push('', hashtags.join(' '));
  return lines.join('\n');
}

/** Safe Windows file name: "Thomas - Night Drive (YouTube).mp4" */
export function videoFileName(
  input: Pick<DescriptionInput, 'title' | 'artist'>,
  suffix: string,
): string {
  const base = buildVideoTitle(input)
    // eslint-disable-next-line no-control-regex -- control characters are invalid in Windows file names
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120);
  return `${base || 'Video'} (${suffix}).mp4`;
}
