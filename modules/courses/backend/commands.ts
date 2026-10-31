// Standardised commands of Courses (MODULES.md §5.15): example phrases and the
// parameters taken by code (no generative AI). Tested in tests/commands.test.ts.
import { normaliseUtterance, stripCommand, type AssistantParams } from '@hub/sdk/backend';

export const WHAT_EXAMPLES = [
  'qu’est-ce que je mange ce soir',
  'qu’est-ce que je mange demain midi',
  'c’est quoi le repas de ce midi',
  'on mange quoi ce soir',
];
export const LIST_EXAMPLES = [
  'montre ma liste de courses',
  'qu’est-ce qu’il faut acheter',
  'ma liste de courses',
];
export const EXTRA_EXAMPLES = [
  'ajoute café aux extras',
  'ajoute des filtres à la liste de courses',
  'mets du café dans les courses',
];
export const PLAN_EXAMPLES = [
  'mets risotto mardi soir',
  'planifie un curry demain midi',
  'ajoute le chili jeudi soir au planning',
];

export const NUTRITION_EXAMPLES = [
  'combien de protéines cette semaine',
  'combien de calories aujourd’hui',
  'combien de glucides demain',
  'c’est quoi mes apports de la semaine',
];
export const COST_EXAMPLES = [
  'combien coûte ma liste de courses',
  'combien coûte la semaine',
  'c’est quoi le budget des courses',
];

const DAYS: [RegExp, string][] = [
  [/\blundi\b/, '1'],
  [/\bmardi\b/, '2'],
  [/\bmercredi\b/, '3'],
  [/\bjeudi\b/, '4'],
  [/\bvendredi\b/, '5'],
  [/\bsamedi\b/, '6'],
  [/\bdimanche\b/, '7'],
  [/\bdemain\b/, 'tomorrow'],
  [/\baujourd hui\b|\bce soir\b|\bce midi\b|\bce matin\b/, 'today'],
];
const MOMENTS: [RegExp, string][] = [
  [/\bmatin\b|\bpetit dej(?:euner)?\b/, 'matin'],
  [/\bmidi\b|\bdejeuner\b/, 'midi'],
  [/\bsoir\b|\bdiner\b/, 'soir'],
  [/\bcollation\b|\bgouter\b/, 'collation'],
];
const dayOf = (said: string) => DAYS.find(([re]) => re.test(said))?.[1];
const momentOf = (said: string) => MOMENTS.find(([re]) => re.test(said))?.[1];

/** « qu'est-ce que je mange ce soir » → today, soir. */
export function extractWhatToEat(utterance: string): AssistantParams | null {
  const said = normaliseUtterance(utterance);
  if (!/\bmange|\brepas\b|\bmenu\b/.test(said)) return null;
  const params: AssistantParams = { day: dayOf(said) ?? 'today' };
  const moment = momentOf(said);
  if (moment) params.moment = moment;
  return params;
}

const EXTRA_PREFIXES = [
  /(?:ajoute|ajouter|rajoute|mets|mettre|note)\s+(?:du |de la |des |de l’|de l'|un |une |le |la |les )?/iu,
];

/** « ajoute café aux extras » → { name: café }. */
export function extractAddExtra(utterance: string): AssistantParams | null {
  const said = normaliseUtterance(utterance);
  if (!/\bextras?\b|\bcourses\b|\bliste de courses\b/.test(said)) return null;
  const body = stripCommand(utterance, EXTRA_PREFIXES);
  if (body === null) return null;
  const name = body
    .replace(
      /\s+(?:aux|dans les|à la|a la|dans la|sur la)\s+(?:extras?|courses|liste(?: de courses)?)\s*$/iu,
      '',
    )
    .replace(/[\s,.!?]+$/, '')
    .trim();
  return name && !/\b(?:extras?|courses)\b/i.test(name) ? { name } : null;
}

const PLAN_PREFIXES = [
  /(?:mets|mettre|planifie|planifier|prévois|prevois|ajoute)\s+(?:le |la |les |un |une |du |des )?/iu,
];

/** « mets risotto mardi soir » → { meal: risotto, day: 2, moment: soir }. */
export function extractPlanMeal(utterance: string): AssistantParams | null {
  const said = normaliseUtterance(utterance);
  const day = dayOf(said);
  const moment = momentOf(said);
  if (!day || !moment) return null;
  const body = stripCommand(utterance, PLAN_PREFIXES);
  if (body === null) return null;
  const meal = body
    .replace(/\s+au planning\s*$/i, '')
    .replace(
      /\s+(?:pour\s+)?(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|aujourd’hui|aujourd'hui|ce)\b.*$/iu,
      '',
    )
    .replace(/[\s,.!?]+$/, '')
    .trim();
  if (!meal || /\bextras?\b|\bcourses\b/i.test(meal)) return null;
  const servings = /\bpour\s+(\d+)\s+(?:portions?|personnes?)\b/.exec(said);
  const params: AssistantParams = { meal, day, moment };
  if (servings) params.servings = Number(servings[1]);
  return params;
}

const NUTRIENT_WORDS: [RegExp, string][] = [
  [/\bproteine/, 'protein'],
  [/\bcalorie|\bkcal\b/, 'kcal'],
  [/\bglucide/, 'carbs'],
  [/\bsucre/, 'sugars'],
  [/\blipide|\bgras\b|\bmatiere grasse/, 'fat'],
  [/\bfibre/, 'fiber'],
  [/\bsel\b/, 'salt'],
];

/** « combien de protéines cette semaine » → protein, week; « … aujourd'hui » → today. */
export function extractNutrition(utterance: string): AssistantParams | null {
  const said = normaliseUtterance(utterance);
  const nutrient = NUTRIENT_WORDS.find(([re]) => re.test(said))?.[1];
  if (!nutrient && !/\bapports?\b|\bnutrition/.test(said)) return null;
  if (/\bcoute|\bprix\b|\bbudget\b/.test(said)) return null;
  const day = /\bsemaine\b/.test(said) ? 'week' : (dayOf(said) ?? 'week');
  return { ...(nutrient ? { nutrient } : {}), day };
}

/** « combien coûte ma liste » → list; « combien coûte la semaine » → week. */
export function extractCost(utterance: string): AssistantParams | null {
  const said = normaliseUtterance(utterance);
  if (!/\bcoute|\bcout\b|\bprix\b|\bbudget\b|\bdepense/.test(said)) return null;
  if (!/\bcourses?\b|\bliste\b|\bsemaine\b|\brepas\b/.test(said)) return null;
  return {
    what: /\bliste\b|\bcourses?\b/.test(said) && !/\bsemaine\b/.test(said) ? 'list' : 'week',
  };
}
