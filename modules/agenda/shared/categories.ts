import { colorValue as colorOf } from './palette';

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
  // v0.38.0: the batch cooking sessions (Courses), not the colour of the meals.
  cuisine: 8,
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
  const own = FIXED_CATEGORIES.find((c) => {
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

/**
 * Off by default: the things of every day (Sport, the meals, the Timer).
 * « Cuisine » (the batch sessions, v0.38.0) is ON: cooking has to be fitted in.
 */
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

// --- v0.42.0: the categories, a list managed by Thomas ----------------------
// The table agenda__categories holds only what Thomas changed or created:
// without a row, a category keeps exactly its values of before (its token,
// counted, shown by default from the setting). So nothing changes until he
// acts, and nothing is written at the opening.

/** « normale » (a block of time), or « deadline » (a moment: a red line or band). */
export type CategoryShape = 'normal' | 'deadline';

/** The Agenda's own one for deadlines (v0.42.0), red by default. */
export const DEADLINE_CATEGORY = 'Deadline';

/** The fixed ones (offered, never renamed nor deleted): the Agenda's own, and « Deadline ». */
export const FIXED_CATEGORIES: readonly string[] = [...OWN_CATEGORIES, DEADLINE_CATEGORY];

/** The categories the other tools give (their colour can change, nothing else is theirs to lose). */
export const TOOL_CATEGORIES: readonly string[] = [
  'Tâches',
  'Sport',
  'Repas',
  'Cuisine',
  'Timer',
  'Musique',
];

/** The key of a category: its name, trimmed, lower case (« Cours » = « cours »). */
export const categoryKey = (name: string) => name.trim().toLowerCase();

export const defaultShape = (name: string): CategoryShape =>
  categoryKey(name) === 'deadline' ? 'deadline' : 'normal';

/** Its colour before any choice: a theme token (« Deadline »: the theme's danger red). */
export const defaultColor = (name: string) =>
  categoryKey(name) === 'deadline' ? 'var(--danger)' : categoryColor(name);

/** Where a category comes from (what can be done with it). */
export type CategoryOrigin = 'fixed' | 'tool' | 'mine' | 'used';

/** A category as the Agenda shows and offers it. */
export interface CategoryDto {
  /** The row's id when Thomas changed or created it, else null. */
  id: string | null;
  key: string;
  name: string;
  /** « p:<palette id> », « #rrggbb », or null: its own default. */
  color: string | null;
  /** The CSS value used (the colour chosen, else the default token). */
  css: string;
  /** The CSS value of its own default (« Revenir à la couleur d'origine »). */
  defaultCss: string;
  shape: CategoryShape;
  /** In the load, the free time and the overlaps (when switched on). */
  counted: boolean;
  /** Switched on when this device has no choice of its own. */
  shownByDefault: boolean;
  origin: CategoryOrigin;
  /** Events and week-type entries in it. */
  events: number;
}

/** What Thomas stored for a category (a row of agenda__categories). */
export interface CategoryRowLike {
  id: string;
  name: string;
  color: string | null;
  shape: string;
  counted: number;
  shown: number;
  sort: number | null;
  mine: number;
}

/**
 * The list (Réglages › Agenda › Catégories, the choices of a category): the
 * fixed ones, the other tools' ones, Thomas's own, and every name found in
 * the events, the week type and the import mappings; Thomas's changes over
 * the defaults; in his order, else fixed, tools, then by name. Pure.
 */
export function mergeCategories(input: {
  rows: readonly CategoryRowLike[];
  /** Name found in the data → number of events / week-type entries. */
  used: ReadonlyMap<string, number>;
  /** The setting « Catégories éteintes par défaut ». */
  offByDefault: readonly string[];
}): CategoryDto[] {
  const byKey = new Map<string, { name: string; origin: CategoryOrigin; rank: number }>();
  const add = (name: string, origin: CategoryOrigin, rank: number) => {
    const key = categoryKey(name);
    if (!key || byKey.has(key)) return;
    byKey.set(key, { name: name.trim(), origin, rank });
  };
  FIXED_CATEGORIES.forEach((c, i) => add(c, 'fixed', i));
  TOOL_CATEGORIES.forEach((c, i) => add(c, 'tool', 100 + i));
  for (const r of input.rows) add(r.name, r.mine ? 'mine' : 'used', 1000);
  for (const name of input.used.keys()) add(name, 'used', 1000);
  const rows = new Map(input.rows.map((r) => [categoryKey(r.name), r]));
  const counts = new Map<string, number>();
  for (const [name, n] of input.used)
    counts.set(categoryKey(name), (counts.get(categoryKey(name)) ?? 0) + n);
  const off = new Set(input.offByDefault.map(categoryKey));
  const list = [...byKey.entries()].map(([key, c]) => {
    const row = rows.get(key);
    const defaultCss = defaultColor(c.name);
    const color = row?.color ?? null;
    return {
      dto: {
        id: row?.id ?? null,
        key,
        name: row?.name ?? c.name,
        color,
        css: colorOf(color, defaultCss),
        defaultCss,
        shape:
          row && (row.shape === 'deadline' || row.shape === 'normal')
            ? row.shape
            : defaultShape(c.name),
        counted: row ? row.counted === 1 : true,
        shownByDefault: row ? row.shown === 1 : !off.has(key),
        origin: c.origin,
        events: counts.get(key) ?? 0,
      } satisfies CategoryDto,
      sort: row?.sort ?? null,
      rank: c.rank,
    };
  });
  return list
    .sort(
      (a, b) =>
        (a.sort ?? 10_000 + a.rank) - (b.sort ?? 10_000 + b.rank) ||
        a.dto.name.localeCompare(b.dto.name),
    )
    .map((x) => x.dto);
}
