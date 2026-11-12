// Categories and their colours: each one takes one of the theme's eight
// categorical tokens (--series-1 … --series-8), never a colour of its own.
// The usual ones always get the same token; another one gets a stable one
// from its name.

/** The Agenda's own categories, offered in the form and the bar (« #cours »). */
export const OWN_CATEGORIES = [
  'Rendez-vous',
  'Cours',
  'Réunions',
  'Examens',
  'Loisirs',
  'Perso',
] as const;

export const DEFAULT_CATEGORY = 'Rendez-vous';

const FIXED: Record<string, number> = {
  'rendez-vous': 1,
  cours: 2,
  réunions: 3,
  examens: 4,
  sport: 5,
  repas: 6,
  tâches: 7,
  musique: 8,
  loisirs: 5,
  perso: 6,
  timer: 7,
};

/** 1 … 8: the token « --series-N » of a category. */
export function categoryIndex(category: string): number {
  const key = category.trim().toLowerCase();
  if (FIXED[key]) return FIXED[key]!;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (hash % 8) + 1;
}

/** The CSS value of its colour (a theme token). */
export const categoryColor = (category: string) => `var(--series-${categoryIndex(category)})`;

/** « #cours » → « Cours » (one of ours when it matches, else the word, capitalised). */
export function categoryFromTag(tag: string): string {
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const wanted = fold(tag.replace(/^#/, ''));
  const own = OWN_CATEGORIES.find((c) => {
    const f = fold(c);
    return f === wanted || f.replace(/s$/, '') === wanted.replace(/s$/, '');
  });
  if (own) return own;
  const word = tag.replace(/^#/, '').replace(/-/g, ' ');
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// --- Category switches (v0.35.0) -------------------------------------------
// A switch ON: the category is shown AND counted (load, free time,
// overlaps); OFF: neither. The everyday things are off by default (setting
// « Catégories éteintes par défaut »); each device keeps its own choices.

/** Off by default: the things of every day (Sport, the meals and the batch, the Timer). */
export const DEFAULT_OFF = ['Sport', 'Repas', 'Timer'];

/** « Sport, Repas ; Timer » → ['Sport', 'Repas', 'Timer'] (the setting). */
export function categoryList(text: string | null | undefined): string[] {
  return [
    ...new Set(
      (text ?? '')
        .split(/[,;\n]/)
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  ];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Is this category on? The device's choice first, else the default. */
export function isOn(
  category: string,
  choices: Record<string, boolean>,
  offByDefault: readonly string[],
): boolean {
  const chosen = Object.entries(choices).find(([c]) => same(c, category));
  if (chosen) return chosen[1];
  return !offByDefault.some((c) => same(c, category));
}
