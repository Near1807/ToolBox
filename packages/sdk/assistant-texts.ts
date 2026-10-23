// French wording shared by the modules' assistant actions.

/** State of a generated element (Pack Insta, Reels perso…), as said aloud. */
export const ELEMENT_STATES: Record<string, string> = {
  draft: 'à générer',
  rendering: 'en cours de rendu',
  ready: 'prêt',
  outdated: 'à régénérer',
  failed: 'en échec',
  missing: 'fichier introuvable',
};

/** « a, b et c ». */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} et ${items.at(-1)}`;
}
