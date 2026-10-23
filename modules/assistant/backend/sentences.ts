// Cuts a streamed answer into sentences, so the voice starts on the first one
// while the model is still writing the rest; strips what should not be read
// aloud (markdown, emojis).

const ABBREVIATIONS = /(?:\b(?:M|Mme|Mlle|Dr|St|etc|ex|cf|p|n°|vs|env))\.$/i;

/** Text as it should be spoken: no markdown, no emoji, no list bullets. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class SentenceSplitter {
  private buffer = '';

  /** Adds streamed text; returns the sentences completed by it. */
  push(text: string): string[] {
    this.buffer += text;
    const done: string[] = [];
    for (;;) {
      const match = /[.!?…]+(?=\s)|[\n]+/.exec(this.buffer);
      if (!match) break;
      const end = match.index + match[0].length;
      const candidate = this.buffer.slice(0, end);
      // « M. Dupont », « 3.5 » (no space after the dot), « etc. » mid-sentence: keep going.
      if (match[0] === '.' && ABBREVIATIONS.test(candidate)) {
        const rest = this.buffer.slice(end);
        const nextBreak = /[.!?…]+(?=\s)|\n+/.exec(rest);
        if (!nextBreak) break;
        const merged = this.buffer.slice(0, end + nextBreak.index + nextBreak[0].length);
        this.buffer = this.buffer.slice(merged.length);
        const sentence = speakable(merged);
        if (sentence) done.push(sentence);
        continue;
      }
      this.buffer = this.buffer.slice(end);
      const sentence = speakable(candidate);
      if (sentence) done.push(sentence);
    }
    return done;
  }

  /** What remains at the end of the answer. */
  flush(): string[] {
    const sentence = speakable(this.buffer);
    this.buffer = '';
    return sentence ? [sentence] : [];
  }
}

/** Whole text → sentences (for answers that are not streamed). */
export function splitSentences(text: string): string[] {
  const splitter = new SentenceSplitter();
  return [...splitter.push(`${text} `), ...splitter.flush()];
}
