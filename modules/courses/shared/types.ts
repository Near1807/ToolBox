// Shapes of the Courses API (shared by the backend and the page).
import type { Cost, Facts, Nutrition, PricePer } from './nutrition';
import type { RecipeLine } from './recipe';

export interface IngredientDto {
  id: string;
  name: string;
  unit: string;
  aisle: string;
  /** Average weight of one piece (box, bag…) in grams, or null. */
  pieceG: number | null;
  /** Values for 100 g or 100 ml (`nutritionPer`), all optional. */
  nutrition: Nutrition;
  nutritionPer: '100g' | '100ml';
  /** Reference price (€) per kg, per litre or per piece, or null. */
  price: number | null;
  pricePer: PricePer | null;
}
export interface MealDto {
  id: string;
  name: string;
  /** Portions the recipe is written for. */
  servings: number;
  tags: string[];
  note: string;
  /** Keeping once cooked (batch cooking): empty (null) = unknown. Never filled in by the app. */
  fridgeDays: number | null;
  freezable: boolean;
  /** Only for a freezable recipe. */
  freezerDays: number | null;
  /**
   * The ingredients of the recipe, preparations expanded (shared/recipe.ts,
   * `expandRecipe`): what every calculation reads. `fromLine`: the
   * preparation line it comes from (null: a direct line).
   */
  items: {
    id: string;
    ingredientId: string;
    qty: number;
    unit: string;
    fromLine: string | null;
  }[];
  /** The lines as written (ingredients and preparations): the editor and the export only. */
  lines: RecipeLine[];
  /** At least one preparation line: its direct lines are « at meal time ». */
  split: boolean;
  /**
   * Keeping as the batch sees it: the recipe's own fields when not split,
   * else its preparations' (`preps`: how many are filled in).
   */
  keeping: { known: boolean; freezable: boolean; preps: { known: number; total: number } | null };
  /** For one portion. */
  perServing: { nutrition: Facts; cost: Cost };
  /** Optional picture of the recipe (signed URL for this session). */
  image: { url: string; width: number; height: number } | null;
}
/** A preparation (technical sheet): defined once, used by several recipes. */
export interface PrepDto {
  id: string;
  name: string;
  note: string;
  /** For ONE portion. */
  items: { id: string; ingredientId: string; qty: number; unit: string }[];
  fridgeDays: number | null;
  freezable: boolean;
  freezerDays: number | null;
  /** Recipes with a line of this preparation. */
  usedBy: { id: string; name: string }[];
  /** For one portion. */
  perPortion: { nutrition: Facts; cost: Cost };
}
export interface MomentDto {
  id: string;
  name: string;
  /** Default time « HH:MM ». */
  time: string;
  durationMin: number;
}
export interface PlanDto {
  id: string;
  date: string;
  momentId: string;
  mealId: string;
  servings: number;
}
export interface ListItemDto {
  key: string;
  /** Extras only. */
  id?: string;
  name: string;
  amount: string;
  aisle: string;
  checked: boolean;
  source: 'meals' | 'extra';
  /** Extras only: estimated price of the article (€), or null when unknown. */
  price?: number | null;
}
export interface ListDto {
  id: string;
  from: string;
  to: string;
  mealsPlanned: number;
  /** Estimated cost of the list: the meals' ingredients (quantities used, not packets) plus the extras with a price. */
  cost: Cost;
  /** The two parts of `cost`. */
  mealsCost: Cost;
  extrasCost: Cost;
  groups: { aisle: string; items: ListItemDto[] }[];
  /** Usual extras, ticked quickly into the list. */
  habitual: { id: string; name: string; aisle: string; price: number | null }[];
}
export interface StateDto {
  today: string;
  ingredients: IngredientDto[];
  meals: MealDto[];
  preps: PrepDto[];
  moments: MomentDto[];
  /** Planned meals of the list's period. */
  plan: PlanDto[];
  list: ListDto;
  /** Validated batch plans: frozen portions to take out the evening before (read only). */
  thaw: ThawDto[];
  /** v0.29: double doses of validated plans, on their cooking meal (read only). */
  doubles?: DoubleNoteDto[];
}

/** A list of an earlier period, as it was when its period changed. */
export interface PastListDto {
  id: string;
  from: string;
  to: string;
  closedAt: string;
  groups: ListDto['groups'];
  cost: Cost | null;
}

export interface DayFacts {
  date: string;
  meals: number;
  nutrition: Facts;
  cost: Cost;
}
export interface Goals {
  /** 0: no goal. */
  proteinPerDay: number;
  kcalPerDay: number;
  budgetPerWeek: number;
}
export interface SummaryDto {
  from: string;
  to: string;
  days: DayFacts[];
  total: { nutrition: Facts; cost: Cost };
  /** Averages over the days that have at least one planned meal. */
  average: { nutrition: Facts['values']; cost: number; days: number };
  /** Planned meals by protein per portion (most first). */
  meals: { id: string; name: string; proteinPerServing: number; missing: boolean }[];
  goals: Goals;
}

// --- Batch cooking ---------------------------------------------------------------

/** A planned meal of the period, as the batch form lists it. */
export interface BatchEntryDto {
  entryId: string;
  date: string;
  momentId: string;
  mealId: string;
  mealName: string;
  servings: number;
  /** The recipe has the tag « batch » (pre-ticked; accents and case ignored). */
  batchTag: boolean;
  fridgeDays: number | null;
  freezable: boolean;
  freezerDays: number | null;
  /**
   * What the batch can cook for this meal (v0.27): each preparation of a
   * split recipe, else the whole recipe (one part, the fields above).
   */
  parts: BatchPartDto[];
  /** Covered by this validated plan for all its parts (not tickable). */
  coveredBy: string | null;
  /** v0.28: planned in the days before the period (listed only when sessions may be before it). */
  beforePeriod?: boolean;
}
/** One thing cooked for a planned meal: a preparation, or the whole recipe. */
export interface BatchPartDto {
  /** null: the whole recipe (it has no preparation). */
  prepId: string | null;
  mealId: string;
  name: string;
  /** Portions of the preparation for this meal: its line × portions planned / servings. */
  portions: number;
  fridgeDays: number | null;
  freezable: boolean;
  freezerDays: number | null;
  /** v0.28: covered by this validated plan (this part only), else null. */
  coveredBy?: string | null;
}
export interface BatchSlotDto {
  date: string;
  momentId: string;
}
export interface BatchUseDto {
  entryId: string;
  date: string;
  momentId: string;
  /** Portions of what is cooked for this meal. */
  servings: number;
  /** Recipe of the meal (« pour : mar. soir (Chili) »). */
  mealName?: string;
}
/** What a cooking is made of, to recompute its quantities for other portions (same functions as the server). */
export type CookBasis =
  | { kind: 'prep'; items: { ingredientId: string; qty: number; unit: string }[] }
  | {
      kind: 'meal';
      servings: number;
      items: { ingredientId: string; qty: number; unit: string }[];
    };
export interface BatchCookDto {
  /** The recipe cooked whole (no preparation), else null. */
  mealId: string | null;
  /** The preparation cooked (v0.27), else null. */
  prepId: string | null;
  /** Name of what is cooked: the preparation, or the recipe. */
  mealName: string;
  /** Portions of what is cooked (decimal for a preparation, shown rounded). */
  portions: number;
  fridge: BatchUseDto[];
  frozen: BatchUseDto[];
  /** Quantities to prepare (the recipe scaled to these portions, or the preparation × its portions). */
  ingredients: { name: string; amount: string }[];
  /** Recipes of the meals it is for (« Utilisée dans »). */
  usedIn: string[];
  /** What the cooking is made of (totals of a session, v0.29). */
  basis?: CookBasis;
}
export interface BatchSessionDto extends BatchSlotDto {
  /** Validated plans only. */
  id?: string;
  /** Before the period: its ingredients are bought before that day (indication only). */
  beforePeriod: boolean;
  /** Validated plans only: free, empty by default. */
  startTime?: string | null;
  durationMin?: number | null;
  cooks: BatchCookDto[];
  /** Another validated plan already has a session on this slot (never merged). */
  warnings: string[];
}
export interface BatchProposalDto {
  sessions: BatchSessionDto[];
  /** Couples no slot can cover (to cook on the day), with what and why. */
  uncovered: { entryId: string; prepId: string | null; name: string; reason: string }[];
  /** Ticked couples left out: no fridge days (the recipe, or the preparation). */
  missing: { entryId: string; prepId: string | null; name: string }[];
  covered: number;
  total: number;
  tooComplex: boolean;
  /** v0.29, temps 2: the double doses (cookings for one meal only are not listed). */
  doubles?: BatchDoubleDto[];
}
/** v0.29, temps 2: a double dose, cooked during a meal for the next meals of the same element. */
export interface BatchDoubleDto {
  /** `prep:<id>|<entry>`: kept or left out by Thomas, checked at validation. */
  key: string;
  prepId: string | null;
  mealId: string | null;
  /** The element: a preparation, or the recipe cooked whole. */
  name: string;
  /** The meal during which it is cooked, and its recipe. */
  opener: BatchUseDto;
  /** The next meals it also covers. */
  also: (BatchUseDto & { frozen: boolean })[];
  portions: number;
  ingredients: { name: string; amount: string }[];
  /** Other preparations of the cooking meal already prepared in a session (« riz : déjà préparé »). */
  prepared: { name: string; date: string; momentId: string }[];
}
export interface BatchPlanDto {
  id: string;
  createdAt: string;
  freezer: boolean;
  daysBefore: number;
  /** The grid really used (dates and slots ticked). */
  grid: { dates: string[]; slots: BatchSlotDto[] };
  sessions: BatchSessionDto[];
  /** v0.29: the double doses validated with the plan. */
  doubles?: BatchDoubleDto[];
  /** The planning changed since the validation (meal removed, moved, portions changed). */
  changes: string[];
}
export interface BatchStateDto {
  from: string;
  to: string;
  moments: MomentDto[];
  /** Setting « Sessions jusqu'à N jours avant la période » (0 by default). */
  daysBefore: number;
  /** Saved cooking slots of this period (dates shown then), else the usual model laid on it. */
  grid: { dates: string[]; slots: BatchSlotDto[]; saved: boolean };
  entries: BatchEntryDto[];
  plans: BatchPlanDto[];
  /** v0.29: elements ticked in the last validated plan (pre-ticked), `prep:<id>` / `meal:<id>`. */
  lastElements: string[];
  /** v0.29: setting « Je cuisine mes repas aux moments : … » (moment ids). */
  cookMoments: string[];
  /** v0.29: what each element is made of, and the ingredients' names and piece weights (totals). */
  bases: Record<string, CookBasis>;
  facts: {
    names: Record<string, string>;
    pieces: Record<string, { unit: string; pieceG: number | null }>;
  };
}
/** v0.29: a double dose of a validated plan, on its cooking meal in the planning (read only). */
export interface DoubleNoteDto {
  date: string;
  momentId: string;
  entryId: string;
  name: string;
  also: { date: string; momentId: string }[];
}
/** « Sortir du congélateur » the evening before a frozen portion (validated plans only). */
export interface ThawDto {
  /** The day to take it out (the evening before the meal). */
  date: string;
  /** What to take out that evening (preparations, or recipes cooked whole), once each. */
  names: string[];
}
