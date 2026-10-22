// The release plan of a track: which element goes out which day, from a
// template the user edits in the settings, then spread so that no day gets
// more than N publications per platform. Pure functions, unit-tested.
import { addDays, weekday } from './time';

export type ItemKind = 'youtube' | 'short' | 'insta-post' | 'insta-reel';
export type Platform = 'youtube' | 'instagram';

export const PLATFORM: Record<ItemKind, Platform> = {
  youtube: 'youtube',
  short: 'youtube',
  'insta-post': 'instagram',
  'insta-reel': 'instagram',
};

export const DEFAULT_TEMPLATE = [
  'J : vidéo YouTube, post Insta',
  'J+1 : Reel 1, Short 1',
  'J+2 : Reel 2, Short 2',
  'J+3 : Reel 3, Short 3',
  'J+4 : Reel 4, Short 4',
].join('\n');

/** Positions above this are the user's own Reels (custom-reels): 100 + their position. */
export const CUSTOM_OFFSET = 100;

export interface PlanEntry {
  kind: ItemKind;
  /** 0 for the video and the post, 1..4 for Reels and Shorts. */
  position: number;
  /** Days after the release day J. */
  offset: number;
}

export function itemLabel(kind: ItemKind, position: number): string {
  if (position > CUSTOM_OFFSET) {
    return `${kind === 'short' ? 'Short' : 'Reel'} perso ${position - CUSTOM_OFFSET}`;
  }
  switch (kind) {
    case 'youtube':
      return 'Vidéo YouTube';
    case 'short':
      return `Short ${position}`;
    case 'insta-post':
      return 'Post Insta';
    case 'insta-reel':
      return `Reel ${position}`;
  }
}

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Reads the template: one line per day, "J+2 : Reel 1, Short 1". Known
 * elements: « vidéo YouTube », « post Insta », « Reel 1…4 », « Short 1…4 ».
 * Returns the entries and the errors (French, with the line number).
 */
export function parseTemplate(template: string): { entries: PlanEntry[]; errors: string[] } {
  const entries: PlanEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  template.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const where = `ligne ${index + 1}`;
    const match = /^j\s*(?:\+\s*(\d{1,3}))?\s*:\s*(.+)$/.exec(normalize(line));
    if (!match) {
      errors.push(`${where} : « ${line} » — format attendu « J+2 : Reel 1 »`);
      return;
    }
    const offset = Number(match[1] ?? 0);
    for (const token of match[2]!.split(/[,;]| et /)) {
      const word = token.trim();
      if (word === '') continue;
      let entry: PlanEntry;
      const numbered = /^(reel|short)s?\s*(\d)$/.exec(word);
      if (numbered) {
        const position = Number(numbered[2]);
        if (position < 1 || position > 4) {
          errors.push(`${where} : « ${word} » — numéro de 1 à 4`);
          continue;
        }
        entry = { kind: numbered[1] === 'reel' ? 'insta-reel' : 'short', position, offset };
      } else if (/^(la )?(video|youtube)( youtube)?$/.test(word)) {
        entry = { kind: 'youtube', position: 0, offset };
      } else if (/^(le )?post( insta(gram)?)?$/.test(word)) {
        entry = { kind: 'insta-post', position: 0, offset };
      } else {
        errors.push(
          `${where} : « ${word} » inconnu (vidéo YouTube, post Insta, Reel 1…4, Short 1…4)`,
        );
        continue;
      }
      const key = `${entry.kind}:${entry.position}`;
      if (seen.has(key)) {
        errors.push(`${where} : « ${word} » apparaît deux fois`);
        continue;
      }
      seen.add(key);
      entries.push(entry);
    }
  });
  if (entries.length === 0 && errors.length === 0) errors.push('Le modèle est vide');
  return { entries, errors };
}

/** What can be published for a track (generated files chosen by the user). */
export interface Availability {
  video: boolean;
  post: boolean;
  /** Positions of the Reels of the pack (a Short n is the Reel n). */
  reels: number[];
}

export interface ProposedItem {
  kind: ItemKind;
  position: number;
  /** Day proposed by the template. */
  templateDate: string;
  /** Day after the anti-congestion (may be later). */
  date: string;
}

/** Template applied to a release day, keeping only what exists. */
export function buildPlan(
  entries: PlanEntry[],
  releaseDate: string,
  available: Availability,
): ProposedItem[] {
  return entries
    .filter((entry) => {
      if (entry.kind === 'youtube') return available.video;
      if (entry.kind === 'insta-post') return available.post;
      return available.reels.includes(entry.position);
    })
    .map((entry) => {
      const date = addDays(releaseDate, entry.offset);
      return { kind: entry.kind, position: entry.position, templateDate: date, date };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Allowed publication days: 0 = Monday … 6 = Sunday (default Monday to Friday). */
export const DEFAULT_ALLOWED_DAYS = [0, 1, 2, 3, 4];

/** "1,2,3,4,5" (ISO, 1 = Monday) → [0, 1, 2, 3, 4]; empty or invalid → every day. */
export function parseAllowedDays(value: string | null | undefined): number[] {
  const days = [
    ...new Set(
      String(value ?? '')
        .split(',')
        .map((d) => Number(d.trim()) - 1)
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    ),
  ].sort();
  return days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6];
}

/** The release day J: moved to the next Monday when « J tombe toujours un lundi » is on. */
export function releaseDay(date: string, onMonday: boolean): string {
  if (!onMonday) return date;
  const day = weekday(date);
  return day === 0 ? date : addDays(date, 7 - day);
}

export interface Occupied {
  platform: Platform;
  date: string;
}

export interface Shift {
  kind: ItemKind;
  position: number;
  from: string;
  to: string;
  /** « full »: the day had its N publications; « day »: not an allowed publication day. */
  reason: 'full' | 'day';
}

/**
 * Anti-congestion: at most `maxPerDay` publications per day and per platform,
 * counting what is already planned for other tracks, and only on allowed
 * days. An element on a full or forbidden day moves to the next free allowed
 * day (never to a forbidden one); the next elements of the same platform
 * never come before it (the order of the plan is kept).
 */
export function spreadPlan(
  items: ProposedItem[],
  occupied: Occupied[],
  maxPerDay: number,
  allowedDays: number[] = [0, 1, 2, 3, 4, 5, 6],
): { items: ProposedItem[]; shifts: Shift[] } {
  const allowed = new Set(allowedDays.length > 0 ? allowedDays : [0, 1, 2, 3, 4, 5, 6]);
  const max = Math.max(1, Math.floor(maxPerDay));
  const counts = new Map<string, number>();
  const count = (platform: Platform, date: string) => counts.get(`${platform}|${date}`) ?? 0;
  for (const slot of occupied) {
    counts.set(`${slot.platform}|${slot.date}`, count(slot.platform, slot.date) + 1);
  }
  const lastDate: Partial<Record<Platform, string>> = {};
  const shifts: Shift[] = [];
  const placed = [...items]
    .sort((a, b) =>
      a.templateDate < b.templateDate ? -1 : a.templateDate > b.templateDate ? 1 : 0,
    )
    .map((item) => {
      const platform = PLATFORM[item.kind];
      // Reported as « day » when the template's own day is not allowed.
      const reason: Shift['reason'] = allowed.has(weekday(item.date)) ? 'full' : 'day';
      let date = item.date;
      const floor = lastDate[platform];
      if (floor && date < floor) date = floor;
      // Never onto a day that is not allowed, nor onto a full one.
      while (!allowed.has(weekday(date)) || count(platform, date) >= max) date = addDays(date, 1);
      counts.set(`${platform}|${date}`, count(platform, date) + 1);
      lastDate[platform] = date;
      if (date !== item.templateDate) {
        shifts.push({
          kind: item.kind,
          position: item.position,
          from: item.templateDate,
          to: date,
          reason,
        });
      }
      return { ...item, date };
    });
  return { items: placed, shifts };
}

/** Fills a text template: {titre}, {artiste}, {n}… (shared with every module, docs/MODULES.md §7.3). */
export { fillTemplate } from '@hub/sdk/texts';

/**
 * YouTube refuses "<" and ">" in titles and descriptions; titles are limited
 * to 100 characters, descriptions to 5000 bytes, tags to 500 characters in all.
 */
export function sanitizeMetadata(input: { title: string; description: string; tags: string[] }) {
  const clean = (text: string) => text.replace(/[<>]/g, '');
  let title = clean(input.title).replace(/\s+/g, ' ').trim();
  if (title === '') title = 'Sans titre';
  if (title.length > 100) title = `${title.slice(0, 99).trimEnd()}…`;
  let description = clean(input.description);
  while (Buffer.byteLength(description, 'utf8') > 5000) description = description.slice(0, -1);
  const tags: string[] = [];
  let total = 0;
  for (const tag of input.tags.map((t) => clean(t).replace(/^#/, '').trim()).filter(Boolean)) {
    // Tags with spaces count their quotes.
    const size = tag.length + (tag.includes(' ') ? 2 : 0) + (tags.length > 0 ? 1 : 0);
    if (total + size > 500 || tags.includes(tag)) continue;
    tags.push(tag);
    total += size;
  }
  return { title, description, tags };
}
