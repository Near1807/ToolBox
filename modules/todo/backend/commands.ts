// Standardised commands of the To-do (MODULES.md §5.15): example phrases, and
// the parameters taken from what was said by code (no generative AI). Pure
// functions, tested in tests/commands.test.ts.
import {
  extractAfter,
  extractTags,
  extractTrailing,
  normaliseUtterance,
  stripCommand,
  type AssistantParams,
} from '@hub/sdk/backend';
import { parseDue } from '../dates';

export const ADD_EXAMPLES = [
  'ajoute une tâche finir le mix pour vendredi',
  'ajoute finir le mix avec le tag mix',
  'crée une tâche appeler le studio demain',
  'nouvelle tâche acheter des cordes',
  'note de rappeler Paul',
  'rappelle-moi de payer le mastering',
  'mets dans ma to-do envoyer les stems',
  'il faut que je finisse le clip',
];

export const LIST_EXAMPLES = [
  'qu’est-ce que j’ai à faire',
  'qu’est-ce que j’ai à faire aujourd’hui',
  'mes tâches du jour',
  'liste mes tâches',
  'quelles sont mes tâches en retard',
  'qu’est-ce que j’ai cette semaine',
  'mes tâches avec le tag mix',
  'qu’est-ce qui reste à faire',
];

export const COMPLETE_EXAMPLES = [
  'coche la tâche finir le mix',
  'coche finir le mix',
  'marque appeler le studio comme faite',
  'j’ai fini le mix',
  'c’est fait pour la bio',
  'termine la tâche envoyer les stems',
];

export const DELETE_EXAMPLES = [
  'supprime la tâche finir le mix',
  'supprime appeler le studio',
  'efface la tâche de la bio',
  'enlève la tâche acheter des cordes de la liste',
];

const ADD_PREFIXES = [
  /(?:ajouter|ajoute|rajouter|rajoute|créer|crées|crée|creer|cree|mettre|mets|noter|note|inscrire|inscris)(?![\p{L}])(?:[- ]moi)?(?:\s+(?:une|la|ma|un|dans ma|dans la))?(?:\s+(?:nouvelle))?(?:\s+(?:tâche|tache|todo|to-do|to do|chose|rappel|liste))?(?:\s+(?:à faire|a faire))?(?:\s+(?:dans (?:ma|la) (?:to-?do|liste)))?\s*(?::|,)?\s*(?:de |d’|d'|que )?/iu,
  /(?:nouvelle|une)\s+(?:tâche|tache)\s*(?::|,)?\s*/i,
  /(?:rappelle|rappelle-moi|rappelle moi|fais-moi penser|fais moi penser|n’oublie pas|n'oublie pas)(?:[- ]moi)?\s+(?:de |d’|d'|à |a )?/i,
  /(?:il faut que je|je dois|je devrais|pense à|pense a)\s+/i,
];

/** « ajoute une tâche finir le mix #mix pour vendredi sur le morceau Aube ». */
export function extractAdd(utterance: string, today: string): AssistantParams | null {
  const body = stripCommand(utterance, ADD_PREFIXES);
  if (body === null) return null;
  // « note une idée … » belongs to the Boîte à idées, never a task.
  if (/^(?:une |l’|l'|cette |mon |ma )?(?:nouvelle )?id[ée]es?\b/iu.test(body)) return null;
  // « ajoute café aux extras » belongs to Courses.
  if (
    /(?:^|\s)(?:aux extras?|(?:à|a) la liste de courses|dans (?:les|mes|la liste de) courses)\s*[.!?]?$/iu.test(
      body,
    )
  )
    return null;
  const { tags, rest: withoutTags } = extractTags(body);
  const { value: track, rest: withoutTrack } = extractAfter(
    withoutTags,
    /,?\s+(?:sur|pour|du|dans)\s+(?:le\s+)?morceau\s+/i,
  );
  const { value: due, rest } = extractTrailing(withoutTrack, (tail) => parseDue(tail, today));
  const title = rest
    .replace(/^(?:la tâche|la tache|une tâche|une tache)\s+/i, '')
    .replace(/[\s,.!?]+$/, '')
    .trim();
  if (!title) return null;
  const params: AssistantParams = { title };
  if (tags.length) params.tags = tags;
  // An ISO date: the action reads it with the same parser.
  if (due) params.due = due;
  if (track) params.track = track;
  return params;
}

/** « mes tâches du jour », « en retard », « cette semaine », « avec le tag mix ». */
export function extractList(utterance: string): AssistantParams {
  const said = normaliseUtterance(utterance);
  const params: AssistantParams = {};
  if (/\ben retard\b|\bretard/.test(said)) params.filter = 'overdue';
  else if (/aujourd hui|\bdu jour\b|\bce jour\b|\bce soir\b/.test(said)) params.filter = 'today';
  else if (/\bsemaine\b|\b7 jours\b|\bsept jours\b/.test(said)) params.filter = 'week';
  else if (/\b(?:faites|finies|terminees|cochees)\b/.test(said)) params.filter = 'done';
  else if (/\btoutes\b/.test(said)) params.filter = 'all';
  const { tags } = extractTags(utterance);
  if (tags[0]) params.tag = tags[0];
  return params;
}

const COMPLETE_PREFIXES = [
  /(?:cocher|coche|valider|valide|terminer|termine|marquer|marque)(?![\p{L}])(?:\s+(?:la|ma|une))?(?:\s+(?:tâche|tache))?\s*/iu,
  /(?:j’ai fini|j'ai fini|j’ai terminé|j'ai terminé|j’ai fait|j'ai fait|c’est fait pour|c'est fait pour|fini)\s+(?:de |d’|d'|la tâche |la tache )?/i,
];

/** « coche la tâche finir le mix », « marque le mix comme faite », « j'ai fini le mix ». */
export function extractComplete(utterance: string): AssistantParams | null {
  const body = stripCommand(utterance, COMPLETE_PREFIXES);
  if (body === null) return null;
  const task = body
    .replace(/\s+comme\s+(?:faite?|finie?|terminée?|cochée?)$/i, '')
    .replace(/^(?:la|le|les)\s+/i, '')
    .replace(/[\s,.!?]+$/, '')
    .trim();
  return task ? { task } : null;
}

const DELETE_PREFIXES = [
  /(?:supprimer|supprime|effacer|efface|enlever|enlève|enleve|retirer|retire|virer|vire)(?![\p{L}])(?:\s+(?:la|ma|une))?(?:\s+(?:tâche|tache))?\s*/iu,
];

/** « supprime la tâche du mix », « efface appeler le studio de la liste ». */
export function extractDelete(utterance: string): AssistantParams | null {
  const body = stripCommand(utterance, DELETE_PREFIXES);
  if (body === null) return null;
  const task = body
    .replace(/\s+(?:de|dans) (?:la|ma) (?:liste|to-?do)$/i, '')
    .replace(/^(?:du|de la|des|de|d’|d')\s*/i, '')
    .replace(/[\s,.!?]+$/, '')
    .trim();
  return task ? { task } : null;
}
