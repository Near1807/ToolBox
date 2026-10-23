// Helpers for standardised commands (MODULES.md §5.15): the modules' code
// takes the parameters out of what was said, so no generative AI is needed.
// Spoken French is messy (« euh », « s'il te plaît », « tu peux… »): these
// helpers clean it, then cut the phrase into a command and its values.

/** Lower case, no accents, single spaces, apostrophes and dashes as spaces (for matching only). */
export function normaliseUtterance(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`-]/g, ' ')
    .replace(/[^a-z0-9#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words that carry nothing in a spoken request. */
const FILLERS =
  /^(?:(?:euh+|heu+|hum+|bon|bah|ben|alors|donc|ok|okay|dis|hey|toolbox|s(?:’|')il te pla[iî]t|stp|merci|vas[- ]y|allez)(?![\p{L}])[\s,.!]*)+/iu;
const POLITE =
  /^(?:(?:est[- ]ce que )?(?:tu peux|tu pourrais|peux[- ]tu|pourrais[- ]tu)|je (?:voudrais|veux|aimerais) (?:que tu|bien)?|il faudrait)\s+/i;
const TRAILING = /[\s,.!?]*(?:s(?:’|')il te pla[iî]t|stp|merci)?[\s,.!?]*$/i;

/** « Euh, tu peux ajouter… s'il te plaît » → « ajouter… ». Keeps accents and case. */
export function cleanUtterance(text: string): string {
  let rest = text.trim();
  for (let i = 0; i < 3; i++) {
    const next = rest.replace(FILLERS, '').replace(POLITE, '').trim();
    if (next === rest) break;
    rest = next;
  }
  return rest.replace(TRAILING, '').trim();
}

/** Removes the first matching command prefix (patterns tried on the cleaned text); null if none matches. */
export function stripCommand(text: string, prefixes: RegExp[]): string | null {
  const cleaned = cleanUtterance(text);
  for (const prefix of prefixes) {
    const match = prefix.exec(cleaned);
    if (match && match.index === 0) return cleaned.slice(match[0].length).trim();
  }
  return null;
}

/**
 * Tags said or typed: « #mix », « avec le tag mix », « tag mix », « avec les
 * tags mix et studio ». Returns them (lower case) and the text without them.
 */
export function extractTags(text: string): { tags: string[]; rest: string } {
  const tags: string[] = [];
  let rest = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_all, space: string, tag: string) => {
    tags.push(tag.toLowerCase());
    return space;
  });
  rest = rest.replace(
    /,?\s*(?:avec |et )?(?:les |le |un |une )?(?:tags?|étiquettes?|etiquettes?)\s+([\p{L}\p{N}_-]+(?:\s*(?:,|et)\s*[\p{L}\p{N}_-]+)*)/giu,
    (_all, list: string) => {
      for (const tag of list.split(/\s*(?:,|\bet\b)\s*/))
        if (tag.trim()) tags.push(tag.trim().toLowerCase());
      return ' ';
    },
  );
  return { tags: [...new Set(tags)], rest: rest.replace(/\s+/g, ' ').trim() };
}

/**
 * Takes a value from the END of the text when `parse` understands it (a date
 * « pour vendredi », « le 12 novembre »): tries the longest tail first.
 */
export function extractTrailing<T>(
  text: string,
  parse: (tail: string) => T | null,
  maxWords = 6,
): { value: T | null; rest: string; tail: string | null } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (let take = Math.min(maxWords, words.length - 1); take >= 1; take--) {
    const tail = words.slice(-take).join(' ');
    const value = parse(tail);
    if (value !== null) {
      const rest = words
        .slice(0, -take)
        .join(' ')
        .replace(/[\s,]+(?:pour|avant|d’ici|d'ici|le|la|à rendre)$/i, '')
        .trim();
      return { value, rest, tail };
    }
  }
  return { value: null, rest: text.trim(), tail: null };
}

/** A segment introduced by one of `markers` (« sur le morceau Aube ») and the text without it. */
export function extractAfter(
  text: string,
  markers: RegExp,
): { value: string | null; rest: string } {
  const match = markers.exec(text);
  if (!match) return { value: null, rest: text };
  const value = text
    .slice(match.index + match[0].length)
    .trim()
    .replace(/[,.!?]+$/, '');
  return { value: value || null, rest: text.slice(0, match.index).trim() };
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  quinze: 15,
  vingt: 20,
  trente: 30,
  quatre_vingt_dix: 90,
};

/** First number of the text (« 7 », « sept », « quatre-vingt-dix »), or null. */
export function extractNumber(text: string): number | null {
  const normal = normaliseUtterance(text).replace(/quatre vingt dix/g, 'quatre_vingt_dix');
  const digits = /\b(\d{1,6})\b/.exec(normal);
  if (digits) return Number(digits[1]);
  for (const word of normal.split(' ')) if (word in NUMBER_WORDS) return NUMBER_WORDS[word]!;
  return null;
}

/**
 * A name after a command (« stats du morceau Aube » → « Aube »): the text
 * after the first matching prefix, without « le morceau », « de », « du »…
 * Matched later with matchByName, so an approximate name is fine.
 */
export function extractName(text: string, prefixes: RegExp[]): string | null {
  const body = stripCommand(text, prefixes);
  if (body === null) return null;
  const name = body
    .replace(/^(?:(?:de la|des|du|de|sur|pour|les|le|la)\s+|[dl][’']\s*)+/i, '')
    .replace(/^(?:morceau|titre|track|son)\s+/i, '')
    .replace(/^(?:(?:de la|du|de|le|la)\s+|[dl][’']\s*)+/i, '')
    .replace(/[\s,.!?]+$/, '')
    .trim();
  return name || null;
}
