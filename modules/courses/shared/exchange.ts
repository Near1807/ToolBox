// The JSON file of Courses (import and export, same format, documented in the
// README and on the page): ingredients and recipes. Pure, tested in
// tests/exchange.test.ts. Reading never writes anything: it gives what an
// import would do (preview), with an error per element and its line.
import { fold } from './quantities';
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
export interface ExchangeRecipe {
  name: string;
  servings: number;
  tags: string[];
  note: string;
  ingredients: { name: string; qty: number; unit: string }[];
  /** Optional picture: `data:image/jpeg;base64,…` (also PNG, WebP). */
  image?: string | null;
}
export interface ExchangeFile {
  format: typeof FORMAT;
  version: number;
  ingredients: ExchangeIngredient[];
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
function elementLines(text: string): { ingredients: number[]; recipes: number[] } {
  const out = { ingredients: [] as number[], recipes: [] as number[] };
  let line = 1;
  let depth = 0;
  let key: string | null = null;
  let current: 'ingredients' | 'recipes' | null = null;
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
      if (depth === 1 && c === '[' && (key === 'ingredients' || key === 'recipes')) current = key;
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

/** Reads a file (text): its ingredients and recipes, checked, and an error per bad element. */
export function parseExchange(text: string): Parsed {
  const result: Parsed = { ingredients: [], recipes: [], errors: [], warnings: [] };
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
    const items: ExchangeRecipe['ingredients'] = [];
    for (const [i, rawItem] of (v.ingredients as unknown[]).entries()) {
      const it = (rawItem ?? {}) as Record<string, unknown>;
      const itemName = str(it.name, 80);
      const qty = num(it.qty);
      if (!itemName) return fail(`ingrédient ${i + 1} : nom manquant`);
      if (qty === null || !(qty > 0)) return fail(`« ${itemName} » : quantité > 0 attendue`);
      items.push({ name: itemName, qty, unit: str(it.unit, 20) || 'g' });
    }
    const tags = Array.isArray(v.tags)
      ? [...new Set((v.tags as unknown[]).map((t) => str(t, 30).replace(/^#/, '')).filter(Boolean))]
      : [];
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
    });
  });
  if (!ingredients.length && !recipes.length && !result.errors.length)
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
  recipes: ExchangeRecipe[];
}

export type IngredientStatus = 'new' | 'same' | 'differs';
export type RecipeStatus = 'new' | 'same' | 'differs';
export interface Preview {
  ingredients: { name: string; line: number | null; status: IngredientStatus; changes: string[] }[];
  recipes: { name: string; line: number | null; status: RecipeStatus; unknown: string[] }[];
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

const recipeKey = (r: ExchangeRecipe) =>
  JSON.stringify([
    r.servings,
    [...r.tags].sort(),
    r.note,
    r.ingredients.map((i) => [fold(i.name), i.qty, i.unit]),
  ]);

/** What an import would do, compared with what ToolBox already has. Writes nothing. */
export function previewImport(parsed: Parsed, existing: Existing): Preview {
  const known = new Map(existing.ingredients.map((i) => [fold(i.name), i]));
  const knownRecipes = new Map(existing.recipes.map((r) => [fold(r.name), r]));
  const inFile = new Set(parsed.ingredients.map((i) => fold(i.name)));
  const toCreate = new Map<string, { name: string; unit: string }>();
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
    recipes: parsed.recipes.map((r) => {
      const unknown = r.ingredients
        .filter((i) => !known.has(fold(i.name)) && !inFile.has(fold(i.name)))
        .map((i) => {
          if (!toCreate.has(fold(i.name)))
            toCreate.set(fold(i.name), { name: i.name, unit: i.unit });
          return i.name;
        });
      const before = knownRecipes.get(fold(r.name));
      const status: RecipeStatus = !before
        ? 'new'
        : recipeKey(before) === recipeKey(r)
          ? 'same'
          : 'differs';
      return { name: r.name, line: r.line, status, unknown };
    }),
    toCreate: [...toCreate.values()],
    errors: parsed.errors,
    warnings: parsed.warnings,
  };
}
