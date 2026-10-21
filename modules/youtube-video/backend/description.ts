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

/** "Sortie le 3 novembre 2026", or "" without a release date. */
export function releaseLine(releaseDate: string | null): string {
  if (!releaseDate) return '';
  const date = new Date(`${releaseDate}T12:00:00`);
  return `Sortie le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

export function buildDescription(input: DescriptionInput): string {
  const lines = [`${buildVideoTitle(input)}`];
  if (input.releaseDate) lines.push(releaseLine(input.releaseDate));
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

/** Values of the placeholders of the title and description templates. */
export function templateValues(input: DescriptionInput): Record<string, string> {
  return {
    titre: input.title,
    artiste: input.artist,
    titre_youtube: buildVideoTitle(input),
    sortie: releaseLine(input.releaseDate),
    liens: input.links.trim(),
    hashtags: buildHashtags(input.tags, input.hashtags).join(' '),
  };
}
