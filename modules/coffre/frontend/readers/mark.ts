// v0.47.0: the words of a search marked in what a reader shows (text, code,
// Markdown, a PDF's text layer) — insensitive to accents and case, as the
// index. Only text nodes are wrapped in <mark class="coffre-hit">: nothing of
// the file becomes HTML.
import { useEffect, type RefObject } from 'react';

const foldChar = (c: string) =>
  c
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** The words of a query (folded), the longest first. */
export function wordsOf(query: string | null | undefined): string[] {
  return [
    ...new Set(
      foldChar(query ?? '')
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 0),
    ),
  ].sort((a, b) => b.length - a.length);
}

/** Where the words start in a text: [start, end) in the ORIGINAL text, in order. */
export function findWords(text: string, words: string[]): [number, number][] {
  if (!words.length) return [];
  // The folded text, with for each folded character its original index.
  let folded = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = foldChar(text[i]!);
    for (let k = 0; k < f.length; k++) at.push(i);
    folded += f;
  }
  at.push(text.length);
  const out: [number, number][] = [];
  let i = 0;
  while (i < folded.length) {
    const w = words.find((word) => folded.startsWith(word, i));
    if (w) {
      // The accents that follow the last letter (a decomposed « é ») belong to it.
      let end = at[i + w.length - 1]! + 1;
      while (end < text.length && foldChar(text[end]!) === '') end++;
      out.push([at[i]!, end]);
      i += w.length;
    } else i++;
  }
  return out;
}

/** Removes the marks a previous call put in `root`. */
export function unmark(root: HTMLElement): void {
  for (const m of [...root.querySelectorAll('mark.coffre-hit')]) {
    m.replaceWith(document.createTextNode(m.textContent ?? ''));
  }
  root.normalize();
}

/** Marks the words in `root`'s text; the marks, in reading order. */
export function markWords(root: HTMLElement, query: string | null | undefined): HTMLElement[] {
  unmark(root);
  const words = wordsOf(query);
  if (!words.length) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const marks: HTMLElement[] = [];
  for (const node of nodes) {
    const text = node.data;
    const found = findWords(text, words);
    if (!found.length) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const [a, b] of found) {
      if (a > last) frag.append(text.slice(last, a));
      const m = document.createElement('mark');
      m.className = 'coffre-hit';
      m.textContent = text.slice(a, b);
      frag.append(m);
      marks.push(m);
      last = b;
    }
    if (last < text.length) frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return marks;
}

/** Marks the words once the reader has drawn its text, and shows the first one. */
export function useMarks(
  root: RefObject<HTMLElement | null>,
  query: string | null | undefined,
  ready: unknown,
): void {
  useEffect(() => {
    const el = root.current;
    if (!el || ready === null || ready === undefined) return;
    const marks = markWords(el, query);
    marks[0]?.classList.add('coffre-hit--current');
    marks[0]?.scrollIntoView({ block: 'center' });
    return () => unmark(el);
  }, [root, query, ready]);
}
