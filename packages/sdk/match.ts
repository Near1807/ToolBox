// Finding an element from what someone said or typed (« boumboum » for the
// track « Boum Boum », « le mix » for the task « finir le mix »). Shared by
// the modules' assistant actions: accents, case and spaces are ignored, an
// element can have several names (title and nicknames), names that SOUND the
// same match too (« obsidienne » for « Obsidian », read by the French speech
// recognition), and an ambiguous answer is reported instead of picked at random.

const STOP = new Set([
  'le',
  'la',
  'les',
  'l',
  'de',
  'des',
  'du',
  'd',
  'un',
  'une',
  'et',
  'a',
  'au',
  'aux',
  'the',
]);

export function normaliseName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  return normaliseName(text)
    .split(' ')
    .filter((w) => w && !STOP.has(w));
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Dice coefficient on letter pairs (0…1). */
function similarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let common = 0;
  for (const [gram, count] of ga) common += Math.min(count, gb.get(gram) ?? 0);
  return (2 * common) / (a.length - 1 + (b.length - 1));
}

/** How well `name` matches `query` (0…1). */
export function nameScore(name: string, query: string): number {
  const n = normaliseName(name);
  const q = normaliseName(query);
  if (!n || !q) return 0;
  const nc = n.replace(/ /g, '');
  const qc = q.replace(/ /g, '');
  if (n === q || nc === qc) return 1;
  if (qc.length >= 3 && (nc.includes(qc) || qc.includes(nc))) return 0.9;
  const qw = words(query);
  const nw = words(name);
  let found = 0;
  for (const w of qw) {
    if (nw.some((x) => x === w || (w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))) found++;
  }
  const overlap = qw.length ? found / qw.length : 0;
  const byWords =
    overlap > 0 ? 0.5 + 0.35 * overlap * (found / Math.max(nw.length, 1)) + 0.1 * overlap : 0;
  const bySpelling = similarity(nc, qc);
  return Math.max(byWords, bySpelling >= 0.6 ? bySpelling * 0.8 : 0);
}

/**
 * How a name sounds in French (also English names said the French way):
 * « Obsidian » and « obsidienne » → « obsidian » ; « GrosKaillou » and « gros
 * caillou » → « groskelu ». Rough on purpose: only used to compare two names.
 */
export function phoneticKey(text: string): string {
  let s = normaliseName(text).replace(/ /g, '');
  if (!s) return '';
  const rules: [RegExp, string][] = [
    [/ph/g, 'f'],
    [/sch|sh|ch/g, 'C'],
    [/qu|q/g, 'k'],
    [/ck/g, 'k'],
    [/c(?=[eiy])/g, 's'],
    [/c/g, 'k'],
    [/gu(?=[eiy])/g, 'g'],
    [/g(?=[eiy])/g, 'j'],
    [/x/g, 'ks'],
    [/w/g, 'v'],
    [/y/g, 'i'],
    [/h/g, ''],
    [/(?<=[aeiou])s(?=[aeiou])/g, 'z'],
    [/eau|au/g, 'o'],
    // « ou » is never nasal (« boum »): a mark the nasal rules do not touch.
    [/oo|ou/g, 'U'],
    [/(?:ain|ein)(?![aeiou])/g, 'I'],
    [/ai|ei|ay|ey/g, 'e'],
    [/ienne$|ian$|ien$|iane$/g, 'ian'],
    [/(?:an|en|am|em)(?![aeiou])/g, 'A'],
    [/(?:on|om)(?![aeiou])/g, 'O'],
    [/(?:ain|ein|in|im|un|um)(?![aeiou])/g, 'I'],
    [/ll/g, 'l'],
    [/(.)\1+/g, '$1'],
    [/(?<=.{3})[esdtx]+$/g, ''],
  ];
  for (const [pattern, replacement] of rules) s = s.replace(pattern, replacement);
  return s.toLowerCase();
}

/** How alike two names sound (0…1). */
export function soundScore(a: string, b: string): number {
  const ka = phoneticKey(a);
  const kb = phoneticKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  return similarity(ka, kb);
}

export type NameMatch<T> =
  | { kind: 'match'; item: T }
  | { kind: 'ambiguous'; items: T[] }
  /** Nothing close enough; `suggestions`: the elements that came near (« Tu voulais dire … ? »). */
  | { kind: 'none'; suggestions: T[] };

/** Best score of `query` against any name of an element (spelling, then sound). */
function bestScore(names: string[], query: string): { score: number; near: number } {
  let score = 0;
  let near = 0;
  for (const name of names) {
    if (!name) continue;
    const spelling = nameScore(name, query);
    const sound = soundScore(name, query);
    // Same sound: almost as good as the same spelling (the exact spelling still wins).
    score = Math.max(score, spelling, sound === 1 ? 0.95 : sound >= 0.85 ? sound * 0.8 : 0);
    near = Math.max(near, spelling, sound * 0.9);
  }
  return { score, near };
}

/**
 * The element whose name best matches `query`; ambiguous when two are about as
 * good. `nameOf` gives one name or several (title and nicknames).
 */
export function matchByName<T>(
  items: T[],
  query: string,
  nameOf: (item: T) => string | string[],
): NameMatch<T> {
  const all = items.map((item) => {
    const names = nameOf(item);
    return { item, ...bestScore(Array.isArray(names) ? names : [names], query) };
  });
  const scored = all.filter((s) => s.score >= 0.5).sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    const suggestions = all
      .filter((s) => s.near >= 0.45)
      .sort((a, b) => b.near - a.near)
      .slice(0, 3)
      .map((s) => s.item);
    return { kind: 'none', suggestions };
  }
  const [best, second] = scored;
  if (best!.score < 1 && second && second.score >= best!.score - 0.05) {
    return {
      kind: 'ambiguous',
      items: scored.filter((s) => s.score >= best!.score - 0.05).map((s) => s.item),
    };
  }
  return { kind: 'match', item: best!.item };
}
