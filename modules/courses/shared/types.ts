// Shapes of the Courses API (shared by the backend and the page).
import type { Cost, Facts, Nutrition, PricePer } from './nutrition';

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
  items: { id: string; ingredientId: string; qty: number; unit: string }[];
  /** For one portion. */
  perServing: { nutrition: Facts; cost: Cost };
  /** Optional picture of the recipe (signed URL for this session). */
  image: { url: string; width: number; height: number } | null;
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
  moments: MomentDto[];
  /** Planned meals of the list's period. */
  plan: PlanDto[];
  list: ListDto;
  /** Validated batch plans: frozen portions to take out the evening before (read only). */
  thaw: ThawDto[];
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
  /** Already covered by this validated plan (not tickable). */
  coveredBy: string | null;
}
export interface BatchSlotDto {
  date: string;
  momentId: string;
}
export interface BatchUseDto {
  entryId: string;
  date: string;
  momentId: string;
  servings: number;
}
export interface BatchCookDto {
  mealId: string;
  mealName: string;
  portions: number;
  fridge: BatchUseDto[];
  frozen: BatchUseDto[];
  /** Quantities to prepare (the recipe scaled to these portions). */
  ingredients: { name: string; amount: string }[];
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
  uncovered: { entryId: string; reason: string }[];
  /** Ticked meals left out: their recipe has no fridge days. */
  missing: string[];
  covered: number;
  total: number;
  tooComplex: boolean;
}
export interface BatchPlanDto {
  id: string;
  createdAt: string;
  freezer: boolean;
  daysBefore: number;
  /** The grid really used (dates and slots ticked). */
  grid: { dates: string[]; slots: BatchSlotDto[] };
  sessions: BatchSessionDto[];
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
}
/** « Sortir du congélateur » the evening before a frozen portion (validated plans only). */
export interface ThawDto {
  /** The day to take it out (the evening before the meal). */
  date: string;
  mealName: string;
  forDate: string;
  forMomentId: string;
}
