// Standardised commands of the Timer (MODULES.md §5.15): example phrases, and
// the parameters taken from what was said by code (no generative AI). Pure
// functions, tested in tests/commands.test.ts.
import {
  cleanUtterance,
  normaliseUtterance,
  stripCommand,
  type AssistantParams,
} from '@hub/sdk/backend';

export const START_EXAMPLES = [
  'lance un timer de 27 minutes',
  'lance un timer de 27 minutes sur finir le mix',
  'démarre un minuteur de 45 minutes pour la bio',
  'mets un timer d’une heure',
  'timer de 25 minutes',
  'lance un chrono de vingt minutes sur appeler le studio',
  'lance un minuteur d’une heure',
];

export const PRESET_EXAMPLES = [
  'lance mon démarrage doux',
  'lance le pomodoro classique',
  'démarre ma session démarrage doux',
  'lance le préréglage pomodoro classique',
];

export const PAUSE_EXAMPLES = [
  'pause',
  'mets le timer en pause',
  'pause le timer',
  'mets en pause',
];
export const RESUME_EXAMPLES = [
  'reprends',
  'reprends le timer',
  'relance le timer',
  'continue le timer',
];
export const STOP_EXAMPLES = [
  'arrête le timer',
  'stoppe le minuteur',
  'arrête la session',
  'coupe le timer',
];
export const SKIP_EXAMPLES = ['passe la pause', 'saute la pause', 'pas de pause'];
export const STATUS_EXAMPLES = [
  'combien de temps il reste',
  'il reste combien de temps',
  'où en est le timer',
  'combien de temps reste-t-il',
  'c’est quoi le temps restant',
];

const UNITS: Record<string, number> = {
  zero: 0,
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
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
};
const TENS: Record<string, number> = {
  dix: 10,
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
};

/** « 27 », « vingt sept », « vingt et un », « quarante cinq » → number (normalised text). */
function numberAt(words: string[], i: number): { value: number; next: number } | null {
  const word = words[i];
  if (word === undefined) return null;
  if (/^\d{1,3}$/.test(word)) return { value: Number(word), next: i + 1 };
  if (word in TENS) {
    let value = TENS[word]!;
    let next = i + 1;
    if (words[next] === 'et' && (words[next + 1] === 'un' || words[next + 1] === 'une')) {
      value += 1;
      next += 2;
    } else if (words[next] && words[next]! in UNITS && UNITS[words[next]!]! < 10) {
      value += UNITS[words[next]!]!;
      next += 1;
    }
    return { value, next };
  }
  if (word in UNITS) return { value: UNITS[word]!, next: i + 1 };
  return null;
}

const HOUR = /^(?:h|heure|heures)$/;
const MINUTE = /^(?:m|mn|min|mins|minute|minutes)$/;

/**
 * A duration said in French, in minutes: « 27 minutes », « vingt-sept min »,
 * « une heure », « 1 h 30 », « une heure et demie », « une demi-heure »,
 * « un quart d'heure », « trois quarts d'heure ». Null when none.
 */
export function parseDuration(
  text: string,
): { minutes: number; start: number; end: number } | null {
  const normal = normaliseUtterance(text).replace(/(\d)\s*h\s*(\d)/g, '$1 h $2');
  const words = normal.split(' ').filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (words[i] === 'une' && words[i + 1] === 'demi' && words[i + 2] === 'heure')
      return { minutes: 30, start: i, end: i + 3 };
    if (
      (words[i] === 'un' || words[i] === 'trois') &&
      /^quarts?$/.test(words[i + 1] ?? '') &&
      words[i + 2] === 'd' &&
      words[i + 3] === 'heure'
    )
      return { minutes: words[i] === 'un' ? 15 : 45, start: i, end: i + 4 };
    const n = numberAt(words, i);
    if (!n) continue;
    const unit = words[n.next] ?? '';
    if (HOUR.test(unit)) {
      let minutes = n.value * 60;
      let end = n.next + 1;
      if (words[end] === 'et' && words[end + 1] === 'demie') {
        minutes += 30;
        end += 2;
      } else if (words[end] === 'et' && words[end + 1] === 'quart') {
        minutes += 15;
        end += 2;
      } else {
        const m = numberAt(words, end);
        if (m && m.value < 60) {
          minutes += m.value;
          end = MINUTE.test(words[m.next] ?? '') ? m.next + 1 : m.next;
        }
      }
      return { minutes, start: i, end };
    }
    if (MINUTE.test(unit)) return { minutes: n.value, start: i, end: n.next + 1 };
  }
  return null;
}

const START_PREFIXES = [
  /(?:lance|lancer|démarre|demarre|démarrer|mets|mettre|met|commence|programme|démarrer|go)(?![\p{L}])(?:[- ]moi)?\s+(?:un|une|le|mon|ma)?\s*(?:timer|minuteur|chrono|chronomètre|chronometre|compte à rebours|session|pomodoro)\b/iu,
  /(?:un\s+)?(?:timer|minuteur|chrono|chronomètre)\b/iu,
];

/** « lance un timer de 27 minutes sur finir le mix » → { minutes: 27, task: "finir le mix" }. */
export function extractStart(utterance: string): AssistantParams | null {
  const body = stripCommand(utterance, START_PREFIXES);
  if (body === null) return null;
  const found = parseDuration(body);
  if (!found || found.minutes < 1) return null;
  const params: AssistantParams = { minutes: found.minutes };
  const task =
    /(?:^|\s)(?:sur|pour)\s+(?:la\s+tâche\s+|la\s+tache\s+|ma\s+tâche\s+|ma\s+tache\s+)?(.+)$/iu.exec(
      cleanUtterance(body),
    );
  if (task) {
    const name = task[1]!
      .replace(/\b\d+\s*(?:h|min|minutes?|heures?)\b.*$/iu, '')
      .replace(/[\s,.!?]+$/, '')
      .trim();
    if (name && !parseDuration(name)) params.task = name;
  }
  return params;
}

const PRESET_PREFIXES = [
  /(?:lance|lancer|démarre|demarre|démarrer|commence|commencer)(?![\p{L}])\s+(?:mon|ma|le|la|mes)?\s*(?:session|préréglage|prereglage|programme)?\s*/iu,
];

/** « lance mon démarrage doux » → { preset: "démarrage doux" } (matched by name later). */
export function extractPreset(utterance: string): AssistantParams | null {
  const body = stripCommand(utterance, PRESET_PREFIXES);
  if (!body) return null;
  // « lance un timer de 27 minutes » is the simple timer, not a preset.
  if (/^(?:un|une)\s/i.test(body) || /\b(?:timer|minuteur|chrono)\b/i.test(body)) return null;
  if (parseDuration(body)) return null;
  const preset = body.replace(/[\s,.!?]+$/, '').trim();
  return preset ? { preset } : null;
}

const has = (utterance: string, pattern: RegExp) => pattern.test(normaliseUtterance(utterance));

export const extractPause = (u: string): AssistantParams | null =>
  has(u, /\b(?:pause|suspends?|suspendre)\b/) && !has(u, /\b(?:passe|saute|pas de)\b/) ? {} : null;
export const extractResume = (u: string): AssistantParams | null =>
  has(u, /\b(?:reprends?|reprendre|continue|relance)\b/) ? {} : null;
export const extractStop = (u: string): AssistantParams | null =>
  has(u, /\b(?:arrete|arreter|stoppe|stop|coupe|termine)\b/) ? {} : null;
export const extractSkip = (u: string): AssistantParams | null =>
  has(u, /\b(?:passe|saute|zappe)\b.*\bpause\b|\bpas de pause\b/) ? {} : null;
export const extractStatus = (u: string): AssistantParams | null =>
  has(u, /\b(?:reste|restant|ou en est|ou j en suis)\b/) ? {} : null;
