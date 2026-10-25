// Standardised commands of the Boîte à idées (MODULES.md §5.15): example
// phrases and the parameters taken from what was said by code (no generative
// AI). Pure functions, tested in tests/commands.test.ts.
import { extractTags, stripCommand, type AssistantParams } from '@hub/sdk/backend';

export const ADD_EXAMPLES = [
  'idée : un break avec des cordes',
  'idée un clip en noir et blanc #clip',
  'note une idée faire un live sur Twitch',
  'nouvelle idée : sample de pluie pour l’intro',
  'j’ai une idée : remixer Nuit Blanche en lo-fi',
  'garde l’idée d’un featuring avec Léa',
  'ajoute une idée pochette avec une photo de nuit',
];

export const LIST_EXAMPLES = [
  'montre mes idées',
  'montre mes idées #musique',
  'quelles sont mes idées',
  'mes idées avec le tag clip',
  'lis-moi mes dernières idées',
  'qu’est-ce que j’ai comme idées',
];

export const RANDOM_EXAMPLES = [
  'une idée au hasard',
  'donne-moi une idée au hasard',
  'pioche une idée',
  'tire une idée au hasard #musique',
  'une idée au hasard dans le tag clip',
];

const ADD_PREFIXES = [
  /(?:j’ai|j'ai)\s+une\s+(?:nouvelle\s+)?id[ée]e\s*(?::|,)?\s*(?:de |d’|d'|que )?/iu,
  /(?:noter|note|ajouter|ajoute|rajoute|mets|garde|garder|retiens|enregistre)(?![\p{L}])(?:[- ]moi)?\s+(?:une|l’|l'|cette|mon|ma)\s*(?:nouvelle\s+)?id[ée]e\s*(?::|,)?\s*(?:de |d’|d'|que |:)?\s*/iu,
  /(?:une\s+)?nouvelle\s+id[ée]e\s*(?::|,)?\s*/iu,
  /id[ée]e\s*(?::|,)\s*/iu,
  /id[ée]e\s+/iu,
];

/** « idée : un break avec des cordes #arrangement », « note une idée … ». */
export function extractAdd(utterance: string): AssistantParams | null {
  const body = stripCommand(utterance, ADD_PREFIXES);
  if (body === null) return null;
  const { tags, rest } = extractTags(body);
  const text = rest
    .replace(/^(?:au hasard|aléatoire)\b.*$/i, '')
    .replace(/[\s,.!?]+$/, '')
    .trim();
  // « une idée au hasard » is a reading, never an idea to note.
  if (!text || /^(?:au hasard|des idées|mes idées)$/i.test(text)) return null;
  const params: AssistantParams = { text };
  if (tags.length) params.tags = tags;
  return params;
}

/** The tag of « mes idées #musique » / « avec le tag clip » / « dans le tag clip ». */
export function extractTagParam(utterance: string): AssistantParams {
  const { tags } = extractTags(utterance);
  return tags[0] ? { tag: tags[0] } : {};
}
