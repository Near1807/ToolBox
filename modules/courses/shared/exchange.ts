// The JSON file of Courses (import and export, same format, documented in the
// README and on the page): ingredients and recipes. Pure, tested in
// tests/exchange.test.ts. Reading never writes anything: it gives what an
// import would do (preview), with an error per element and its line.
import { fold } from './quantities';
import { product } from './recipe';
import {
  defaultNutritionPer,
  NUTRIENT_KEYS,
  PRICE_PER,
  type Nutrition,
  type PricePer,
} from './nutrition';

export const FORMAT = 'toolbox-courses';
/** A base64 image of 20 MB at most (4 characters for 3 bytes). */
const MAX_IMAGE_CHARS = Math.ceil((20 * 1024 * 1024 * 4) / 3) + 64;
export const FORMAT_VERSION = 1;

export interface ExchangeIngredient {
  name: string;
  unit: string;
  aisle: string;
  pieceWeightG: number | null;
  nutritionPer: '100g' | '100ml';
  nutrition: Nutrition;
  price: { amount: number; per: PricePer } | null;
}
/** A line of a recipe: an ingredient, or a preparation (v0.27) with its portions for the whole recipe. */
export type ExchangeLine =
  { name: string; qty: number; unit: string } | { prep: string; qty: number };
export const isPrepLine = (l: ExchangeLine): l is { prep: string; qty: number } => 'prep' in l;

/** A preparation (v0.27): composition for ONE portion, its own keeping. */
export interface ExchangePrep {
  name: string;
  ingredients: { name: string; qty: number; unit: string }[];
  fridgeDays?: number | null;
  freezable?: boolean;
  freezerDays?: number | null;
  note?: string;
}

export interface ExchangeRecipe {
  name: string;
  servings: number;
  tags: string[];
  note: string;
  ingredients: ExchangeLine[];
  /** Optional picture: `data:image/jpeg;base64,…` (also PNG, WebP). */
  image?: string | null;
  /**
   * Keeping once cooked (batch cooking), each optional: absent from the file =
   * not given (an import leaves the recipe's value as it is); null = unknown.
   */
  fridgeDays?: number | null;
  freezable?: boolean;
  freezerDays?: number | null;
}
export interface ExchangeFile {
  format: typeof FORMAT;
  version: number;
  ingredients: ExchangeIngredient[];
  /** Optional (v0.27), absent when there is none. */
  preparations?: ExchangePrep[];
  recipes: ExchangeRecipe[];
}

export interface ParseError {
  /** Line in the file (1 = first), when known. */
  line: number | null;
  where: string;
  message: string;
}
export interface Parsed {
  ingredients: (ExchangeIngredient & { line: number | null })[];
  preparations: (ExchangePrep & { line: number | null })[];
  recipes: (ExchangeRecipe & { line: number | null })[];
  errors: ParseError[];
  /** Imported anyway, with something left out (e.g. an unreadable image). */
  warnings: ParseError[];
}

export const EXAMPLE: ExchangeFile = {
  format: FORMAT,
  version: FORMAT_VERSION,
  ingredients: [
    {
      name: 'Riz arborio',
      unit: 'g',
      aisle: 'Épicerie',
      pieceWeightG: null,
      nutritionPer: '100g',
      nutrition: {
        kcal: 350,
        protein: 7,
        carbs: 78,
        sugars: 0.5,
        fat: 0.6,
        saturated: 0.2,
        fiber: 1.5,
        salt: 0,
      },
      price: { amount: 3.2, per: 'kg' },
    },
    {
      name: 'Oignon',
      unit: 'pièce',
      aisle: 'Fruits et légumes',
      pieceWeightG: 150,
      nutritionPer: '100g',
      nutrition: { kcal: 40, protein: 1.1, carbs: 9.3, fiber: 1.7 },
      price: { amount: 0.3, per: 'pièce' },
    },
    {
      name: 'Bouillon de légumes',
      unit: 'l',
      aisle: 'Épicerie',
      pieceWeightG: null,
      nutritionPer: '100ml',
      nutrition: { kcal: 5, salt: 0.8 },
      price: null,
    },
  ],
  recipes: [
    {
      name: 'Risotto',
      servings: 4,
      tags: ['végétarien'],
      note: 'Remuer souvent.',
      ingredients: [
        { name: 'Riz arborio', qty: 320, unit: 'g' },
        { name: 'Oignon', qty: 1, unit: 'pièce' },
        { name: 'Bouillon de légumes', qty: 1, unit: 'l' },
        { name: 'Parmesan', qty: 80, unit: 'g' },
      ],
    },
  ],
};

/** Line of each element of the top-level arrays `ingredients` and `recipes` (1-based). */
function elementLines(text: string): {
  ingredients: number[];
  preparations: number[];
  recipes: number[];
} {
  const out = {
    ingredients: [] as number[],
    preparations: [] as number[],
    recipes: [] as number[],
  };
  let line = 1;
  let depth = 0;
  let key: string | null = null;
  let current: 'ingredients' | 'preparations' | 'recipes' | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\n') line++;
    else if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') j++;
        s += text[j];
        j++;
      }
      if (depth === 1) key = s;
      i = j;
    } else if (c === '[' || c === '{') {
      if (
        depth === 1 &&
        c === '[' &&
        (key === 'ingredients' || key === 'preparations' || key === 'recipes')
      )
        current = key;
      else if (depth === 2 && c === '{' && current) out[current].push(line);
      depth++;
    } else if (c === ']' || c === '}') {
      depth--;
      if (depth === 1) current = null;
    }
  }
  return out;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.')))
      ? Number(v.replace(',', '.'))
      : null;
const str = (v: unknown, max: number) =>
  typeof v === 'string' || typeof v === 'number'
    ? String(v).trim().replace(/\s+/g, ' ').slice(0, max)
    : '';

type Keeping = Pick<ExchangeRecipe, 'fridgeDays' | 'freezable' | 'freezerDays'>;
/** The keeping fields the file gives (absent: not given), or an error. */
function keepingOf(v: Record<string, unknown>): Keeping | string {
  const keep: Keeping = {};
  for (const key of ['fridgeDays', 'freezerDays'] as const) {
    if (v[key] === undefined) continue;
    if (v[key] === null || v[key] === '') {
      keep[key] = null;
      continue;
    }
    const days = num(v[key]);
    if (days === null || !Number.isInteger(days) || days < 0 || days > 3650)
      return `« ${key} » : un nombre entier de jours (0 à 3650), ou null`;
    keep[key] = days;
  }
  if (v.freezable !== undefined) {
    if (typeof v.freezable !== 'boolean') return '« freezable » : true ou false';
    keep.freezable = v.freezable;
  }
  return keep;
}
/** The lines of a recipe (ingredients, and preparations when allowed) or of a preparation, or an error. */
function ingredientLines(raw: unknown[], preps: boolean): ExchangeLine[] | string {
  const items: ExchangeLine[] = [];
  for (const [i, rawItem] of raw.entries()) {
    const it = (rawItem ?? {}) as Record<string, unknown>;
    const qty = num(it.qty);
    if (it.prep !== undefined) {
      if (!preps) return `ligne ${i + 1} : une préparation ne contient que des ingrédients`;
      const prep = str(it.prep, 80);
      if (!prep) return `ligne ${i + 1} : nom de la préparation manquant`;
      if (qty === null || !(qty > 0)) return `« ${prep} » : portions > 0 attendues`;
      items.push({ prep, qty });
      continue;
    }
    const itemName = str(it.name, 80);
    if (!itemName) return `ingrédient ${i + 1} : nom manquant`;
    if (qty === null || !(qty > 0)) return `« ${itemName} » : quantité > 0 attendue`;
    items.push({ name: itemName, qty, unit: str(it.unit, 20) || 'g' });
  }
  return items;
}

/** Reads a file (text): its ingredients and recipes, checked, and an error per bad element. */
export function parseExchange(text: string): Parsed {
  const result: Parsed = {
    ingredients: [],
    preparations: [],
    recipes: [],
    errors: [],
    warnings: [],
  };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const at = /position (\d+)/.exec((err as Error).message);
    const line = at ? text.slice(0, Number(at[1])).split('\n').length : null;
    result.errors.push({
      line,
      where: 'fichier',
      message: 'JSON illisible (virgule ou guillemet manquant ?)',
    });
    return result;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    result.errors.push({
      line: 1,
      where: 'fichier',
      message: 'Le fichier doit contenir un objet { "ingredients": [...], "recipes": [...] }',
    });
    return result;
  }
  const d = data as Record<string, unknown>;
  if (d.format !== undefined && d.format !== FORMAT)
    result.errors.push({
      line: 1,
      where: 'fichier',
      message: `Format « ${String(d.format)} » inconnu (attendu « ${FORMAT} »)`,
    });
  const lines = elementLines(text);
  const seen = new Set<string>();
  const ingredients = Array.isArray(d.ingredients) ? d.ingredients : [];
  if (d.ingredients !== undefined && !Array.isArray(d.ingredients))
    result.errors.push({
      line: null,
      where: 'ingredients',
      message: '« ingredients » doit être une liste',
    });
  ingredients.forEach((raw, index) => {
    const line = lines.ingredients[index] ?? null;
    const v = (raw ?? {}) as Record<string, unknown>;
    const name = str(v.name, 80);
    const where = `ingrédient ${index + 1}${name ? ` « ${name} »` : ''}`;
    const fail = (message: string) => result.errors.push({ line, where, message });
    if (!name) return fail('nom manquant');
    if (seen.has(fold(name))) return fail('en double dans le fichier');
    const unit = str(v.unit, 20) || 'g';
    const piece =
      v.pieceWeightG === undefined || v.pieceWeightG === null ? null : num(v.pieceWeightG);
    if (piece !== null && !(piece > 0))
      return fail('« pieceWeightG » doit être un poids en grammes > 0');
    if (v.pieceWeightG !== undefined && v.pieceWeightG !== null && piece === null)
      return fail('« pieceWeightG » doit être un nombre');
    const per = v.nutritionPer ?? defaultNutritionPer(unit);
    if (per !== '100g' && per !== '100ml') return fail('« nutritionPer » : "100g" ou "100ml"');
    const nutrition: Nutrition = {};
    if (v.nutrition !== undefined && v.nutrition !== null) {
      if (typeof v.nutrition !== 'object') return fail('« nutrition » doit être un objet');
      for (const [k, value] of Object.entries(v.nutrition as Record<string, unknown>)) {
        if (!NUTRIENT_KEYS.includes(k as (typeof NUTRIENT_KEYS)[number]))
          return fail(`valeur nutritionnelle « ${k} » inconnue (${NUTRIENT_KEYS.join(', ')})`);
        if (value === null || value === '') continue;
        const n = num(value);
        if (n === null || n < 0) return fail(`« ${k} » doit être un nombre ≥ 0`);
        nutrition[k as (typeof NUTRIENT_KEYS)[number]] = n;
      }
    }
    let price: ExchangeIngredient['price'] = null;
    if (v.price !== undefined && v.price !== null) {
      const p = v.price as Record<string, unknown>;
      const amount = num(p.amount);
      if (amount === null || amount < 0) return fail('« price.amount » doit être un prix ≥ 0');
      if (!PRICE_PER.includes(p.per as PricePer))
        return fail('« price.per » : "kg", "l" ou "pièce"');
      price = { amount, per: p.per as PricePer };
    }
    seen.add(fold(name));
    result.ingredients.push({
      name,
      unit,
      aisle: str(v.aisle, 40),
      pieceWeightG: piece,
      nutritionPer: per,
      nutrition,
      price,
      line,
    });
  });
  const preparations = Array.isArray(d.preparations) ? d.preparations : [];
  if (d.preparations !== undefined && !Array.isArray(d.preparations))
    result.errors.push({
      line: null,
      where: 'preparations',
      message: '« preparations » doit être une liste',
    });
  const seenPreps = new Set<string>();
  preparations.forEach((raw, index) => {
    const line = lines.preparations[index] ?? null;
    const v = (raw ?? {}) as Record<string, unknown>;
    const name = str(v.name, 80);
    const where = `préparation ${index + 1}${name ? ` « ${name} »` : ''}`;
    const fail = (message: string) => result.errors.push({ line, where, message });
    if (!name) return fail('nom manquant');
    if (seenPreps.has(fold(name))) return fail('en double dans le fichier');
    if (!Array.isArray(v.ingredients)) return fail('« ingredients » doit être une liste');
    const items = ingredientLines(v.ingredients as unknown[], false);
    if (typeof items === 'string') return fail(items);
    const keep = keepingOf(v);
    if (typeof keep === 'string') return fail(keep);
    seenPreps.add(fold(name));
    result.preparations.push({
      name,
      ingredients: items as ExchangePrep['ingredients'],
      ...keep,
      ...(v.note !== undefined ? { note: str(v.note, 2000) } : {}),
      line,
    });
  });
  const recipes = Array.isArray(d.recipes) ? d.recipes : [];
  if (d.recipes !== undefined && !Array.isArray(d.recipes))
    result.errors.push({
      line: null,
      where: 'recipes',
      message: '« recipes » doit être une liste',
    });
  const seenRecipes = new Set<string>();
  recipes.forEach((raw, index) => {
    const line = lines.recipes[index] ?? null;
    const v = (raw ?? {}) as Record<string, unknown>;
    const name = str(v.name, 80);
    const where = `recette ${index + 1}${name ? ` « ${name} »` : ''}`;
    const fail = (message: string) => result.errors.push({ line, where, message });
    if (!name) return fail('nom manquant');
    if (seenRecipes.has(fold(name))) return fail('en double dans le fichier');
    const servings = v.servings === undefined ? 1 : num(v.servings);
    if (servings === null || !Number.isInteger(servings) || servings < 1 || servings > 50)
      return fail('« servings » : un nombre entier de portions, de 1 à 50');
    if (!Array.isArray(v.ingredients)) return fail('« ingredients » doit être une liste');
    const items = ingredientLines(v.ingredients as unknown[], true);
    if (typeof items === 'string') return fail(items);
    const tags = Array.isArray(v.tags)
      ? [...new Set((v.tags as unknown[]).map((t) => str(t, 30).replace(/^#/, '')).filter(Boolean))]
      : [];
    // Keeping (optional, never invented): only what the file gives.
    const keep = keepingOf(v);
    if (typeof keep === 'string') return fail(keep);
    let image: string | null = null;
    if (v.image !== undefined && v.image !== null && v.image !== '') {
      if (
        typeof v.image === 'string' &&
        v.image.length <= MAX_IMAGE_CHARS &&
        /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(v.image)
      )
        image = v.image;
      else
        result.warnings.push({
          line,
          where,
          message:
            'image illisible ou trop lourde (data:image/…;base64, 20 Mo au plus) : recette importée sans image',
        });
    }
    seenRecipes.add(fold(name));
    result.recipes.push({
      name,
      servings,
      tags,
      note: str(v.note, 2000),
      ingredients: items,
      line,
      image,
      ...keep,
    });
  });
  if (!ingredients.length && !recipes.length && !preparations.length && !result.errors.length)
    result.errors.push({
      line: null,
      where: 'fichier',
      message: 'Aucun ingrédient ni recette dans le fichier',
    });
  return result;
}

/** What is already in ToolBox, to compare with the file. */
export interface Existing {
  ingredients: ExchangeIngredient[];
  /** Optional: none before v0.27. */
  preparations?: ExchangePrep[];
  recipes: ExchangeRecipe[];
}

export type IngredientStatus = 'new' | 'same' | 'differs';
export type RecipeStatus = 'new' | 'same' | 'differs';
export interface Preview {
  ingredients: { name: string; line: number | null; status: IngredientStatus; changes: string[] }[];
  /** v0.27: the preparations of the file, as the recipes. */
  preparations: {
    name: string;
    line: number | null;
    status: RecipeStatus;
    unknown: string[];
    changes: string[];
    /** Existing recipes whose facts and lists change if its composition is replaced. */
    usedBy: string[];
  }[];
  recipes: {
    name: string;
    line: number | null;
    status: RecipeStatus;
    unknown: string[];
    /** What the file would change in the recipe (shown before replacing it). */
    changes: string[];
  }[];
  /** Ingredients named in recipes, unknown in ToolBox and in the file: offered for creation (with the unit first seen). */
  toCreate: { name: string; unit: string }[];
  errors: ParseError[];
  warnings: ParseError[];
}

const sameNutrition = (a: Nutrition, b: Nutrition) =>
  NUTRIENT_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));

/** The fields of an existing ingredient the file would change. */
export function ingredientChanges(before: ExchangeIngredient, after: ExchangeIngredient): string[] {
  const changes: string[] = [];
  if (before.unit !== after.unit) changes.push(`unité ${before.unit} → ${after.unit}`);
  if (before.aisle !== after.aisle)
    changes.push(`rayon « ${before.aisle || '—'} » → « ${after.aisle || '—'} »`);
  if (before.pieceWeightG !== after.pieceWeightG) changes.push('poids d’une pièce');
  if (
    before.nutritionPer !== after.nutritionPer ||
    !sameNutrition(before.nutrition, after.nutrition)
  )
    changes.push('valeurs nutritionnelles');
  if (
    (before.price?.amount ?? null) !== (after.price?.amount ?? null) ||
    (before.price?.per ?? null) !== (after.price?.per ?? null)
  )
    changes.push('prix');
  return changes;
}

const days = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n} j`);

/** Composition of a preparation as text (comparison only). */
const composition = (p: ExchangePrep) =>
  JSON.stringify(p.ingredients.map((i) => [fold(i.name), i.qty, i.unit]));

/** The fields of an existing preparation the file would change (keeping and note only when given). */
export function prepChanges(before: ExchangePrep, after: ExchangePrep): string[] {
  const changes: string[] = [];
  if (composition(before) !== composition(after)) changes.push('composition');
  changes.push(...keepingChanges(before, after));
  if (after.note !== undefined && (before.note ?? '') !== after.note) changes.push('note');
  return changes;
}

function keepingChanges(before: Keeping, after: Keeping): string[] {
  const changes: string[] = [];
  if (after.fridgeDays !== undefined && (before.fridgeDays ?? null) !== after.fridgeDays)
    changes.push(`frigo ${days(before.fridgeDays)} → ${days(after.fridgeDays)}`);
  if (after.freezable !== undefined && (before.freezable ?? false) !== after.freezable)
    changes.push(after.freezable ? 'devient congelable' : 'n’est plus congelable');
  if (after.freezerDays !== undefined && (before.freezerDays ?? null) !== after.freezerDays)
    changes.push(`congélateur ${days(before.freezerDays)} → ${days(after.freezerDays)}`);
  return changes;
}

/** Names of the preparations a recipe uses (structure), folded and sorted. */
const structure = (r: ExchangeRecipe) =>
  JSON.stringify(
    r.ingredients
      .filter(isPrepLine)
      .map((l) => fold(l.prep))
      .sort(),
  );
/** A recipe in ingredients (preparations expanded), added up by ingredient and unit. */
function expanded(
  r: ExchangeRecipe,
  preps: ReadonlyMap<string, ExchangePrep>,
): Map<string, { name: string; unit: string; qty: number }> {
  const out = new Map<string, { name: string; unit: string; qty: number }>();
  const add = (name: string, unit: string, qty: number) => {
    const k = `${fold(name)}|${unit}`;
    const x = out.get(k) ?? { name, unit, qty: 0 };
    x.qty = Math.round((x.qty + qty) * 1e9) / 1e9;
    out.set(k, x);
  };
  for (const l of r.ingredients) {
    if (!isPrepLine(l)) add(l.name, l.unit, l.qty);
    else
      for (const i of preps.get(fold(l.prep))?.ingredients ?? [])
        add(i.name, i.unit, product(i.qty, l.qty));
  }
  return out;
}
const amount = (x: { qty: number; unit: string }) => `${String(x.qty).replace('.', ',')} ${x.unit}`;
/** What changes in ingredients between two expansions (« Riz 80 g → 100 g », « + Œuf 2 pièce »). */
function expansionChanges(
  before: Map<string, { name: string; unit: string; qty: number }>,
  after: Map<string, { name: string; unit: string; qty: number }>,
): string[] {
  const out: string[] = [];
  for (const [k, b] of before) {
    const a = after.get(k);
    if (!a) out.push(`− ${b.name} ${amount(b)}`);
    else if (a.qty !== b.qty) out.push(`${b.name} ${amount(b)} → ${amount(a)}`);
  }
  for (const [k, a] of after) if (!before.has(k)) out.push(`+ ${a.name} ${amount(a)}`);
  return out;
}

/**
 * The fields of an existing recipe the file would change (keeping only when
 * the file gives it). Structure (preparations ↔ direct lines) different:
 * said, with the expansion compared (`preps`: the preparations each side
 * reads; without them, the lines only, as before v0.27).
 */
export function recipeChanges(
  before: ExchangeRecipe,
  after: ExchangeRecipe,
  preps?: {
    before: ReadonlyMap<string, ExchangePrep>;
    after: ReadonlyMap<string, ExchangePrep>;
  },
): string[] {
  const changes: string[] = [];
  if (before.servings !== after.servings)
    changes.push(`portions ${before.servings} → ${after.servings}`);
  if (JSON.stringify([...before.tags].sort()) !== JSON.stringify([...after.tags].sort()))
    changes.push('tags');
  if (before.note !== after.note) changes.push('note');
  const lines = (r: ExchangeRecipe) =>
    JSON.stringify(
      r.ingredients.map((i) =>
        isPrepLine(i) ? ['prep', fold(i.prep), i.qty] : [fold(i.name), i.qty, i.unit],
      ),
    );
  if (preps && structure(before) !== structure(after)) {
    const diff = expansionChanges(expanded(before, preps.before), expanded(after, preps.after));
    changes.push(
      diff.length
        ? `structure et dépliage différents (${diff.join(' ; ')})`
        : 'structure différente, même dépliage',
    );
  } else if (lines(before) !== lines(after)) changes.push('ingrédients');
  changes.push(...keepingChanges(before, after));
  return changes;
}

/** What an import would do, compared with what ToolBox already has. Writes nothing. */
export function previewImport(parsed: Parsed, existing: Existing): Preview {
  const known = new Map(existing.ingredients.map((i) => [fold(i.name), i]));
  const knownRecipes = new Map(existing.recipes.map((r) => [fold(r.name), r]));
  const knownPreps = new Map((existing.preparations ?? []).map((p) => [fold(p.name), p]));
  const filePreps = new Map(parsed.preparations.map((p) => [fold(p.name), p]));
  const inFile = new Set(parsed.ingredients.map((i) => fold(i.name)));
  const toCreate = new Map<string, { name: string; unit: string }>();
  const unknownOf = (lines: ExchangeLine[]) =>
    lines
      .filter((i): i is { name: string; qty: number; unit: string } => !isPrepLine(i))
      .filter((i) => !known.has(fold(i.name)) && !inFile.has(fold(i.name)))
      .map((i) => {
        if (!toCreate.has(fold(i.name))) toCreate.set(fold(i.name), { name: i.name, unit: i.unit });
        return i.name;
      });
  const errors = [...parsed.errors];
  // A recipe naming a preparation neither in the file nor in ToolBox: an error, with its line.
  const recipes = parsed.recipes.filter((r) => {
    const missing = r.ingredients
      .filter(isPrepLine)
      .filter((l) => !filePreps.has(fold(l.prep)) && !knownPreps.has(fold(l.prep)));
    if (!missing.length) return true;
    errors.push({
      line: r.line,
      where: `recette « ${r.name} »`,
      message: `préparation inconnue : ${missing.map((l) => `« ${l.prep} »`).join(', ')} (ni dans le fichier ni dans ToolBox)`,
    });
    return false;
  });
  // Each side reads its own preparations: the file's when it gives them, else ToolBox's.
  const afterPreps = new Map([...knownPreps, ...filePreps]);
  return {
    ingredients: parsed.ingredients.map((i) => {
      const before = known.get(fold(i.name));
      if (!before) return { name: i.name, line: i.line, status: 'new' as const, changes: [] };
      const changes = ingredientChanges(before, i);
      return {
        name: before.name,
        line: i.line,
        status: changes.length ? ('differs' as const) : ('same' as const),
        changes,
      };
    }),
    preparations: parsed.preparations.map((p) => {
      const unknown = unknownOf(p.ingredients);
      const before = knownPreps.get(fold(p.name));
      const changes = before ? prepChanges(before, p) : [];
      const status: RecipeStatus = !before ? 'new' : changes.length ? 'differs' : 'same';
      const usedBy =
        before && composition(before) !== composition(p)
          ? existing.recipes
              .filter((r) =>
                r.ingredients.some((l) => isPrepLine(l) && fold(l.prep) === fold(p.name)),
              )
              .map((r) => r.name)
          : [];
      return { name: before?.name ?? p.name, line: p.line, status, unknown, changes, usedBy };
    }),
    recipes: recipes.map((r) => {
      const unknown = unknownOf(r.ingredients);
      const before = knownRecipes.get(fold(r.name));
      const changes = before
        ? recipeChanges(before, r, { before: knownPreps, after: afterPreps })
        : [];
      const status: RecipeStatus = !before ? 'new' : changes.length ? 'differs' : 'same';
      return { name: r.name, line: r.line, status, unknown, changes };
    }),
    toCreate: [...toCreate.values()],
    errors,
    warnings: parsed.warnings,
  };
}
