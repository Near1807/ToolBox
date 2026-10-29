// Standardised commands of Sport (MODULES.md §5.15): example phrases and the
// parameters taken by code (no generative AI). Tested in tests/commands.test.ts.
import { normaliseUtterance, stripCommand, type AssistantParams } from '@hub/sdk/backend';

export const TODAY_EXAMPLES = [
  'c’est quoi ma séance aujourd’hui',
  'quelle est ma séance du jour',
  'qu’est-ce que j’ai comme sport aujourd’hui',
  'j’ai sport aujourd’hui',
];
export const SUMMARY_EXAMPLES = [
  'mon bilan sport de la semaine',
  'bilan sport',
  'combien de séances j’ai faites cette semaine',
  'où j’en suis au sport cette semaine',
];
export const DONE_EXAMPLES = [
  'séance faite',
  'j’ai fait ma séance',
  'valide ma séance',
  'séance pas faite',
  'je n’ai pas fait ma séance',
];
export const MOOD_EXAMPLES = ['humeur 4', 'humeur de la séance 3', 'mets humeur 5 à ma séance'];
export const COMMENT_EXAMPLES = [
  'commentaire : bonne séance, dos un peu raide',
  'ajoute un commentaire à ma séance : genou sensible',
];
export const MOVE_EXAMPLES = [
  'déplace ma séance de mardi à jeudi',
  'décale la séance de lundi à mercredi',
  'mets ma séance de vendredi à samedi',
];

const DAYS: [RegExp, number][] = [
  [/\blundi\b/, 1],
  [/\bmardi\b/, 2],
  [/\bmercredi\b/, 3],
  [/\bjeudi\b/, 4],
  [/\bvendredi\b/, 5],
  [/\bsamedi\b/, 6],
  [/\bdimanche\b/, 7],
];
const WORDS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5 };

/** « séance faite » → done; « pas faite », « je n'ai pas fait » → not done. */
export function extractDone(utterance: string): AssistantParams | null {
  const said = normaliseUtterance(utterance);
  if (!/\bseance\b/.test(said) && !/\bfait\b|\bfaite\b|\bvalide\b/.test(said)) return null;
  if (/\bhumeur\b|\bcommentaire\b|\bdeplace|\bdecale|\bbilan\b/.test(said)) return null;
  const negative = /\bpas\s+(?:fait|faite)\b|\bn ai pas fait\b|\bratee?\b|\bmanquee?\b/.test(said);
  if (!negative && !/\bfaite?\b|\bvalide\b|\bfini\b|\bterminee?\b/.test(said)) return null;
  return { done: !negative };
}

/** « humeur 4 », « humeur quatre ». */
export function extractMood(utterance: string): AssistantParams | null {
  const said = normaliseUtterance(utterance);
  const m = /\bhumeur\b(?:\s+de la seance)?\s+(?:a\s+)?(\d|un|une|deux|trois|quatre|cinq)\b/.exec(
    said,
  );
  if (!m) return null;
  const mood = /\d/.test(m[1]!) ? Number(m[1]) : WORDS[m[1]!]!;
  return mood >= 1 && mood <= 5 ? { mood } : null;
}

const COMMENT_PREFIXES = [
  /(?:ajoute|mets|note|écris|ecris)?\s*(?:un\s+)?commentaire\s*(?:à|a)?\s*(?:ma|la)?\s*(?:séance|seance)?\s*(?::|,)?\s*/iu,
];

/** « commentaire : bonne séance ». */
export function extractComment(utterance: string): AssistantParams | null {
  const body = stripCommand(utterance, COMMENT_PREFIXES);
  if (body === null) return null;
  const text = body.replace(/[\s,.!?]+$/, '').trim();
  return text ? { text } : null;
}

/** « déplace ma séance de mardi à jeudi » → { from: 2, to: 4 }. */
export function extractMove(utterance: string): AssistantParams | null {
  const said = normaliseUtterance(utterance);
  if (!/\b(?:deplace|decale|bouge|mets|passe)\b/.test(said)) return null;
  const m = /\b(?:de|du)\s+(\w+)\s+(?:a|au|vers|pour)\s+(\w+)\b/.exec(said);
  if (!m) return null;
  const day = (w: string) => DAYS.find(([re]) => re.test(w))?.[1];
  const from = day(m[1]!);
  const to = day(m[2]!);
  return from && to && from !== to ? { from, to } : null;
}
