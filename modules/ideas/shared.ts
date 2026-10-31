// Types and pure functions shared by the backend and the page of the
// Boîte à idées: tags, search without accents, the simple formatting of the text.

export interface IdeaDto {
  id: string;
  title: string;
  /** Free text, simple formatting (see `formatText`), may be empty. */
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  /** Track of the library (null when none, or the library is absent). */
  track: { id: number; title: string } | null;
  /** « Transformer en tâche » was done: the task made (its title at that time). */
  task: { id: string; title: string } | null;
}

export interface TagDto {
  name: string;
  /** Ideas with this tag (archives included). */
  count: number;
  /** 0 = none, 1–8 = the theme's series colours (--series-1 … --series-8). */
  color: number;
}

export type IdeaSort = 'recent' | 'old' | 'modified';

export interface IdeasResponse {
  ideas: IdeaDto[];
  tags: TagDto[];
  /** Ideas not archived / archived, whatever the filter. */
  counts: { active: number; archived: number };
  library: boolean;
  tracks: { id: number; title: string }[];
  /** The To-do is there: « Transformer en tâche ». */
  todo: boolean;
}

/** Tags are lower case, without « # », spaces turned into dashes (as in the To-do). */
export function cleanTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').slice(0, 40);
}
export function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(cleanTag).filter(Boolean))];
}

/** Lower case, accents removed: « Élan » and « elan » are the same word. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Every word of the search is in the title, the text or the tags (accents ignored). */
export function matchesSearch(
  idea: { title: string; body: string; tags: string[] },
  query: string,
): boolean {
  const words = fold(query)
    .split(/\s+/)
    .map((w) => w.replace(/^#/, ''))
    .filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(`${idea.title}\n${idea.body}\n${idea.tags.join(' ')}`);
  return words.every((w) => haystack.includes(w));
}

/** Every chosen tag is on the idea (several tags narrow the list). */
export function matchesTags(idea: { tags: string[] }, tags: readonly string[]): boolean {
  return tags.every((t) => idea.tags.includes(t));
}

// --- Simple formatting ---------------------------------------------------------
// **gras**, *italique*, lines starting with « - » are a list, links
// [texte](https://…) or bare https://… Nothing else: no HTML ever.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'link'; text: string; url: string };

export type Block = { kind: 'paragraph'; parts: Inline[] } | { kind: 'list'; items: Inline[][] };

const INLINE =
  /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+[^\s).,;:!?])/g;

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) parts.push({ kind: 'bold', text: m[1] });
    else if (m[2] !== undefined) parts.push({ kind: 'italic', text: m[2] });
    else if (m[3] !== undefined) parts.push({ kind: 'link', text: m[3], url: m[4]! });
    else parts.push({ kind: 'link', text: m[5]!, url: m[5]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

export function formatText(body: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Inline[][] | null = null;
  const flush = () => {
    if (paragraph.length)
      blocks.push({ kind: 'paragraph', parts: parseInline(paragraph.join('\n')) });
    paragraph = [];
    if (list) blocks.push({ kind: 'list', items: list });
    list = null;
  };
  for (const line of body.split(/\r?\n/)) {
    const item = /^\s*[-•*]\s+(.*)$/.exec(line);
    if (item) {
      if (paragraph.length) {
        blocks.push({ kind: 'paragraph', parts: parseInline(paragraph.join('\n')) });
        paragraph = [];
      }
      (list ??= []).push(parseInline(item[1]!));
    } else if (!line.trim()) flush();
    else {
      if (list) {
        blocks.push({ kind: 'list', items: list });
        list = null;
      }
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
