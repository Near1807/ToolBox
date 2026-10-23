// Finding an element from what someone said or typed (« boumboum » for the
// track « Boum Boum », « le mix » for the task « finir le mix »). Shared by
// the modules' assistant actions: accents, case and spaces are ignored, and an
// ambiguous answer is reported instead of picked at random.

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

export type NameMatch<T> =
  { kind: 'match'; item: T } | { kind: 'ambiguous'; items: T[] } | { kind: 'none' };

/** The element whose name best matches `query`; ambiguous when two are about as good. */
export function matchByName<T>(
  items: T[],
  query: string,
  nameOf: (item: T) => string,
): NameMatch<T> {
  const scored = items
    .map((item) => ({ item, score: nameScore(nameOf(item), query) }))
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { kind: 'none' };
  const [best, second] = scored;
  if (best!.score < 1 && second && second.score >= best!.score - 0.05) {
    return {
      kind: 'ambiguous',
      items: scored.filter((s) => s.score >= best!.score - 0.05).map((s) => s.item),
    };
  }
  return { kind: 'match', item: best!.item };
}
