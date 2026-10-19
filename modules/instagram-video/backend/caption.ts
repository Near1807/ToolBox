// Pure builders of the Instagram caption and file names (unit-tested).

export const DEFAULT_CAPTION_TEMPLATE =
  '{titre} — {artiste}\n\nNouveau son 🎧 lien en bio\n\n{hashtags}';

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

export interface CaptionInput {
  template: string;
  title: string;
  artist: string;
  tags: string[];
  hashtags: string;
}

/**
 * Fills the caption template: {titre}, {artiste}, {hashtags}. Without an
 * artist, the separator before {artiste} disappears ("Titre — {artiste}" → "Titre").
 */
export function buildCaption(input: CaptionInput): string {
  const template = input.template.trim() ? input.template : DEFAULT_CAPTION_TEMPLATE;
  const hashtags = buildHashtags(input.tags, input.hashtags).join(' ');
  return template
    .replace(/[ \t]*[—–-][ \t]*\{artiste\}/g, (match) => (input.artist ? match : ''))
    .replace(/\{titre\}/g, input.title)
    .replace(/\{artiste\}/g, input.artist)
    .replace(/\{hashtags\}/g, hashtags)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Text safe for a Windows file or folder name. */
export function safeFileName(text: string, fallback: string): string {
  const clean = text
    // eslint-disable-next-line no-control-regex -- control characters are invalid in Windows file names
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 100);
  return clean || fallback;
}

/** Folder of a track's pack: "Thomas - Night Drive". */
export function packFolderName(input: { title: string; artist: string }): string {
  return safeFileName(input.artist ? `${input.artist} - ${input.title}` : input.title, 'Pack');
}

/** "Night Drive - Reel 2.mp4", "Night Drive - Post.jpg". */
export function itemFileName(title: string, position: number): string {
  const base = safeFileName(title, 'Morceau');
  return position === 0 ? `${base} - Post.jpg` : `${base} - Reel ${position}.mp4`;
}
