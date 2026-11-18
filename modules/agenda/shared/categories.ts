import { colorValue as colorOf } from './palette';
import { foldName } from './category-id';

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

/**
 * Where a category comes from (what can be done with it): the Agenda's own
 * (« intégrée »), another tool's, or Thomas's (created, or found in his data
 * and imports: renamed and deleted like his own).
 */
export type CategoryOrigin = 'fixed' | 'tool' | 'mine';

/** A category as the Agenda shows and offers it (v0.43.0: an object, ADR 0049). */
export interface CategoryDto {
  /** Its identifier (a row's; for a name not yet stored: the one it will get). */
  id: string;
  /** Its row exists (else: shown from a name found in the data, written on first change). */
  stored: boolean;
  key: string;
  name: string;
  /** « p:<palette id> », « #rrggbb », or null: its own default. */
  color: string | null;
  /** The CSS value used (the colour chosen, else the default token). */
  css: string;
  /** The CSS value of its own default (« Revenir à la couleur d'origine »). */
  defaultCss: string;
  /** Its default type (v0.42 « forme »): « normal » = rendez-vous, « deadline ». */
  shape: CategoryShape;
  /** In the load and the free time (when switched on). */
  counted: boolean;
  /** v0.43.0: its elements are flagged when they overlap (no: like « facultatif »). */
  conflicts: boolean;
  /** v0.43.0: prefilled when it is chosen (minutes; null: the slot's or 1 h). */
  defaultDuration: number | null;
  /** v0.43.0: prefilled when it is chosen. */
  defaultLocation: string | null;
  /** Switched on when this device has no choice of its own. */
  shownByDefault: boolean;
  origin: CategoryOrigin;
  /**
   * v0.43.0: created by Thomas (« Nouvelle catégorie »), not only found in his
   * data: it gets a switch even without an element in the period (as in v0.42).
   */
  created: boolean;
  /** Events and week-type entries in it. */
  events: number;
}

/** A row of agenda__categories (v0.42 columns + v0.43 ones). */
export interface CategoryRowLike {
  id: string;
  name: string;
  color: string | null;
  shape: string;
  counted: number;
  shown: number;
  sort: number | null;
  mine: number;
  conflicts?: number;
  default_duration?: number | null;
  default_location?: string | null;
  builtin?: number;
  found?: number;
}

const FOLD_FIXED = new Map(FIXED_CATEGORIES.map((c) => [foldName(c), c]));
const FOLD_TOOL = new Map(TOOL_CATEGORIES.map((c) => [foldName(c), c]));

/** Where a name comes from. */
export const originOf = (name: string): CategoryOrigin =>
  FOLD_FIXED.has(foldName(name)) ? 'fixed' : FOLD_TOOL.has(foldName(name)) ? 'tool' : 'mine';

/**
 * The list (Réglages › Agenda › Catégories, the choices of a category): the
 * stored categories, plus — never without a category on screen — the fixed
 * ones, the tools' and every name found in the data that has no row yet
 * (with their values of before, and the identifier they will get). In
 * Thomas's order, else fixed, tools, then by name. Pure.
 */
export function mergeCategories(input: {
  rows: readonly CategoryRowLike[];
  /** Folded name → number of events / week-type entries (by category, see the backend). */
  counts: ReadonlyMap<string, number>;
  /** Names found in the data and the imports (any case or accents). */
  names: Iterable<string>;
  /** The setting « Catégories éteintes par défaut ». */
  offByDefault: readonly string[];
  /** The identifier a name gets (UUID v5 of its folded name). */
  idOf: (name: string) => string;
}): CategoryDto[] {
  const off = new Set(input.offByDefault.map(foldName));
  const out = new Map<string, { dto: CategoryDto; sort: number | null; rank: number }>();
  const rankOf = (fold: string) =>
    FOLD_FIXED.has(fold)
      ? FIXED_CATEGORIES.indexOf(FOLD_FIXED.get(fold)!)
      : FOLD_TOOL.has(fold)
        ? 100 + TOOL_CATEGORIES.indexOf(FOLD_TOOL.get(fold)!)
        : 1000;
  for (const r of input.rows) {
    const fold = foldName(r.name);
    if (out.has(fold)) continue;
    const defaultCss = defaultColor(r.name);
    out.set(fold, {
      dto: {
        id: r.id,
        stored: true,
        key: categoryKey(r.name),
        name: r.name,
        color: r.color,
        css: colorOf(r.color, defaultCss),
        defaultCss,
        shape: r.shape === 'deadline' ? 'deadline' : 'normal',
        counted: r.counted === 1,
        conflicts: (r.conflicts ?? 1) === 1,
        defaultDuration: r.default_duration ?? null,
        defaultLocation: r.default_location ?? null,
        shownByDefault: r.shown === 1,
        origin: originOf(r.name),
        created: originOf(r.name) === 'mine' && (r.found ?? 0) === 0,
        events: input.counts.get(fold) ?? 0,
      },
      sort: r.sort,
      rank: rankOf(fold),
    });
  }
  const virtual = (name: string) => {
    const clean = name.replace(/\s+/g, ' ').trim();
    const fold = foldName(clean);
    if (!fold || out.has(fold)) return;
    const defaultCss = defaultColor(clean);
    out.set(fold, {
      dto: {
        id: input.idOf(clean),
        stored: false,
        key: categoryKey(clean),
        name: clean,
        color: null,
        css: defaultCss,
        defaultCss,
        shape: defaultShape(clean),
        counted: true,
        conflicts: true,
        defaultDuration: null,
        defaultLocation: null,
        shownByDefault: !off.has(fold),
        origin: originOf(clean),
        created: false,
        events: input.counts.get(fold) ?? 0,
      },
      sort: null,
      rank: rankOf(fold),
    });
  };
  FIXED_CATEGORIES.forEach(virtual);
  TOOL_CATEGORIES.forEach(virtual);
  for (const n of input.names) virtual(n);
  return [...out.values()]
    .sort(
      (a, b) =>
        (a.sort ?? 10_000 + a.rank) - (b.sort ?? 10_000 + b.rank) ||
        a.dto.name.localeCompare(b.dto.name),
    )
    .map((x) => x.dto);
}
