// Pure builder of the Instagram caption (unit-tested).

export interface CaptionInput {
  title: string;
  artist: string;
  tags: string[];
  callToAction: string;
  hashtags: string;
}

/** Track tags then default hashtags, without duplicates (Instagram allows 30; we keep 15). */
export function buildHashtags(tags: string[], defaults: string): string[] {
  const all = [...tags, ...defaults.split(/[\s,]+/)]
    .map((tag) => tag.replace(/^#+/, '').replace(/\s+/g, '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return all
    .filter((tag) => !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()))
    .slice(0, 15)
    .map((tag) => `#${tag}`);
}

export function buildCaption(input: CaptionInput): string {
  const lines = [input.artist ? `${input.title} — ${input.artist}` : input.title];
  if (input.callToAction.trim()) lines.push('', input.callToAction.trim());
  const hashtags = buildHashtags(input.tags, input.hashtags);
  if (hashtags.length) lines.push('', hashtags.join(' '));
  return lines.join('\n');
}

/** Safe Windows file name: "Thomas - Night Drive (Reel).mp4" */
export function reelFileName(input: Pick<CaptionInput, 'title' | 'artist'>): string {
  const base = (input.artist ? `${input.artist} - ${input.title}` : input.title)
    // eslint-disable-next-line no-control-regex -- control characters are invalid in Windows file names
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120);
  return `${base || 'Reel'} (Reel).mp4`;
}
