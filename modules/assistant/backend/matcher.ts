// Recognition of the standardised commands (no generative AI). Each action of
// the modules declares example phrases and an extractor in code (MODULES.md
// §5.15). A request is compared with the phrases of every command:
// - by meaning (embeddings, when the small model is installed),
// - by the words they share (weighted: rare words count more),
// - an identical phrase scores 1.
// The values of the parameters (a task title, a track) are masked first, with
// each command's own extractor: « ajoute une tâche appeler Paul » is compared
// as « ajoute une tâche … », like the example « ajoute une tâche finir le mix ».
// Strict on purpose: a command runs only if its score is high, clearly ahead of
// the second one, and its required parameters were found. In doubt: nothing.
import {
  cleanUtterance,
  normaliseUtterance,
  type AssistantParams,
  type AssistantRisk,
} from '@hub/sdk/backend';
import { cosine, type Embedder } from './embedder';

export interface CommandPhrase {
  text: string;
  source: 'module' | 'user';
}

export interface CommandSpec {
  id: string;
  moduleName: string;
  description: string;
  risk: AssistantRisk;
  required: string[];
  /** Visible phrases (module ones not hidden, and Thomas's). */
  phrases: CommandPhrase[];
  extract: (utterance: string) => Promise<AssistantParams | null>;
}

export interface MatchSettings {
  /** Minimum score (0…1). */
  threshold: number;
  /** Minimum lead over the second command. */
  margin: number;
}

export const DEFAULT_MATCH: MatchSettings = { threshold: 0.7, margin: 0.08 };

export interface Candidate {
  actionId: string;
  score: number;
  /** Closest phrase of the command. */
  phrase: string;
  params: AssistantParams | null;
  /** Its required parameters were found in the request. */
  complete: boolean;
}

export type MatchVerdict =
  | 'recognised'
  /** Nothing close enough. */
  | 'low-score'
  /** Two commands too close to choose. */
  | 'ambiguous'
  /** The command is clear but a required parameter is missing. */
  | 'missing-params'
  | 'empty';

export interface MatchResult {
  verdict: MatchVerdict;
  best: Candidate | null;
  second: Candidate | null;
  /** best.score − second.score. */
  gap: number;
  /** Best first, one entry per command. */
  ranking: Candidate[];
  /** Embeddings used (false: words only). */
  semantic: boolean;
  /** Not recognised, but a command came close: « Tu voulais dire … ? » (never run). */
  suggestion: Candidate | null;
  /**
   * Two commands about as close (« Tu voulais dire : … ou … ? »), both with
   * their required parameters: Thomas picks one, the code never does.
   */
  choices: Candidate[];
  ms: number;
}

// Words that say nothing about which command is meant.
const STOPWORDS = new Set(
  (
    'a ai as au aux avec c ca ce ces cet cette d dans de des du elle en est et il j je l la le les leur lui m ma mais me mes moi mon n ne nous on ou par pas pour qu que qui s sa se ses si son sur t ta te tes toi ton tu un une vos votre vous y ' +
    'est ce que qu est ce qui ya il y euh bon alors donc'
  ).split(' '),
);

/** « ajoutes », « ajouter », « ajouté » → « ajout » (rough French stemming, enough here). */
export function stem(word: string): string {
  let w = word;
  if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  if (w.length > 5 && /(?:er|ez|ee|ai)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export const tokens = (text: string) =>
  normaliseUtterance(text)
    .replace(/#/g, ' ')
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem);

const DATE_WORDS =
  / (?:pour|avant|d ici|le|la|au plus tard|aujourd hui|demain|apres demain|ce soir|ce matin|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|prochaine?|semaine|mois|dans|jours?|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|\d{1,4}|premier|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|matin|soir|midi|h|heures?)(?= )/g;

/** Removes the parameter values found in the request (kept: the command words). */
export function maskParams(text: string, params: AssistantParams | null): string {
  let masked = ` ${normaliseUtterance(cleanUtterance(text))} `;
  if (!params) return masked.trim();
  const values: string[] = [];
  for (const value of Object.values(params)) {
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) for (const v of value) if (typeof v === 'string') values.push(v);
  }
  // Longest first: « finir le mix » before « mix ».
  for (const value of values.sort((a, b) => b.length - a.length)) {
    const normal = normaliseUtterance(value);
    if (normal.length < 2) continue;
    masked = masked.split(` ${normal} `).join(' ');
  }
  // A date was read (ISO value): its words are a value too (« pour vendredi »).
  if (values.some((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) masked = masked.replace(DATE_WORDS, ' ');
  // Tags: « avec le tag mix » → the tag word goes with its value.
  if (Array.isArray(params.tags) || typeof params.tag === 'string')
    masked = masked.replace(/ (?:avec )?(?:les |le )?(?:tags?|etiquettes?) /g, ' ');
  // What the values leave dangling (« rappelle-moi d'… » → « rappelle moi d »):
  // an elision or a little word at the end says nothing about the command.
  return masked
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?: (?:d|l|de|du|des|le|la|les|a|au|aux|pour|sur|avec|dans|en|que|qu))+$/g, '')
    .trim();
}

interface IndexedPhrase {
  text: string;
  source: CommandPhrase['source'];
  masked: string;
  /** Cleaned phrase as said (for the identical-phrase check). */
  plain: string;
  tokens: string[];
}

interface IndexedCommand {
  spec: CommandSpec;
  phrases: IndexedPhrase[];
}

export class CommandIndex {
  private commands: IndexedCommand[] = [];
  private idf = new Map<string, number>();
  private maxIdf = 1;
  private readonly vectors = new Map<string, Float32Array>();

  constructor(private embedder: Embedder | null = null) {}

  get semantic(): boolean {
    return this.embedder !== null;
  }

  setEmbedder(embedder: Embedder | null): void {
    this.embedder = embedder;
    this.vectors.clear();
  }

  get size(): number {
    return this.commands.length;
  }

  /** (Re)builds the index; the vectors of phrases already seen are kept. */
  async build(commands: CommandSpec[]): Promise<void> {
    const indexed: IndexedCommand[] = [];
    for (const spec of commands) {
      const phrases: IndexedPhrase[] = [];
      for (const phrase of spec.phrases) {
        const params = await spec.extract(phrase.text).catch(() => null);
        const masked = maskParams(phrase.text, params);
        phrases.push({
          ...phrase,
          masked,
          plain: normaliseUtterance(cleanUtterance(phrase.text)),
          tokens: tokens(masked),
        });
      }
      indexed.push({ spec, phrases });
    }
    // Rare words weigh more (log inverse frequency over the phrases).
    const df = new Map<string, number>();
    let count = 0;
    for (const command of indexed)
      for (const phrase of command.phrases) {
        count++;
        for (const token of new Set(phrase.tokens)) df.set(token, (df.get(token) ?? 0) + 1);
      }
    this.idf = new Map([...df].map(([token, n]) => [token, Math.log(1 + count / n)]));
    this.maxIdf = Math.log(1 + Math.max(1, count));
    this.commands = indexed;
    if (this.embedder)
      for (const command of indexed)
        for (const phrase of command.phrases) await this.vector(phrase.masked);
  }

  private async vector(text: string): Promise<Float32Array | null> {
    if (!this.embedder) return null;
    let vector = this.vectors.get(text);
    if (!vector) {
      vector = await this.embedder.embed(text || '…');
      this.vectors.set(text, vector);
    }
    return vector;
  }

  /** Weighted overlap of the words (cosine of the IDF-weighted word sets). */
  private lexical(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const weight = (t: string) => this.idf.get(t) ?? this.maxIdf;
    const setA = new Set(a);
    const setB = new Set(b);
    let common = 0;
    let normA = 0;
    let normB = 0;
    for (const t of setA) {
      normA += weight(t) ** 2;
      if (setB.has(t)) common += weight(t) ** 2;
    }
    for (const t of setB) normB += weight(t) ** 2;
    return common / Math.sqrt(normA * normB);
  }

  /** Score of a request against one command (0…1), and its parameters. */
  private async scoreCommand(utterance: string, command: IndexedCommand): Promise<Candidate> {
    const params = await command.spec.extract(utterance).catch(() => null);
    const complete = params !== null;
    const masked = maskParams(utterance, params);
    const plain = normaliseUtterance(cleanUtterance(utterance));
    const words = tokens(masked);
    const vector = await this.vector(masked);
    let best = { score: 0, phrase: '' };
    const few = tokens(plain).length < 2;
    for (const phrase of command.phrases) {
      let score: number;
      if (phrase.plain === plain || (phrase.masked === masked && masked !== '' && !few)) score = 1;
      else {
        const lexical = this.lexical(words, phrase.tokens);
        const semantic = vector ? cosine(vector, (await this.vector(phrase.masked))!) : null;
        score = semantic === null ? lexical : 0.6 * semantic + 0.4 * lexical;
        // One word said (« tâche », « supprime »): never enough, unless identical.
        if (few) score *= 0.6;
      }
      if (score > best.score) best = { score, phrase: phrase.text };
    }
    return {
      actionId: command.spec.id,
      score: Math.max(0, Math.min(1, best.score)),
      phrase: best.phrase,
      params,
      complete,
    };
  }

  async match(utterance: string, settings: MatchSettings = DEFAULT_MATCH): Promise<MatchResult> {
    const started = Date.now();
    const done = (verdict: MatchVerdict, ranking: Candidate[]): MatchResult => {
      const [best = null, second = null] = ranking;
      const close = best !== null && best.score >= Math.max(0.4, settings.threshold - 0.2);
      return {
        verdict,
        best,
        second,
        gap: best ? best.score - (second?.score ?? 0) : 0,
        ranking,
        semantic: this.semantic,
        suggestion: verdict !== 'recognised' && close ? best : null,
        choices:
          verdict !== 'recognised' &&
          best &&
          second &&
          best.complete &&
          second.complete &&
          best.score >= settings.threshold - 0.1 &&
          best.score - second.score < settings.margin
            ? [best, second]
            : [],
        ms: Date.now() - started,
      };
    };
    if (!normaliseUtterance(cleanUtterance(utterance)) || this.commands.length === 0)
      return done('empty', []);
    const ranking: Candidate[] = [];
    for (const command of this.commands) {
      if (command.phrases.length === 0) continue;
      ranking.push(await this.scoreCommand(utterance, command));
    }
    ranking.sort((a, b) => b.score - a.score);
    const [best, second] = ranking;
    if (!best || best.score < settings.threshold) return done('low-score', ranking);
    if (best.score - (second?.score ?? 0) < settings.margin) return done('ambiguous', ranking);
    if (!best.complete) return done('missing-params', ranking);
    return done('recognised', ranking);
  }

  /** The other commands a new phrase would be too close to (conflict warning). */
  async conflicts(
    actionId: string,
    text: string,
    settings: MatchSettings = DEFAULT_MATCH,
  ): Promise<Candidate[]> {
    const limit = settings.threshold - settings.margin;
    const result = await this.match(text, { threshold: 0, margin: 0 });
    return result.ranking.filter((c) => c.actionId !== actionId && c.score >= limit);
  }
}
