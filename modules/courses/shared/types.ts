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
  items: { id: string; ingredientId: string; qty: number; unit: string }[];
  /** For one portion. */
  perServing: { nutrition: Facts; cost: Cost };
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
}
export interface ListDto {
  id: string;
  from: string;
  to: string;
  mealsPlanned: number;
  /** Estimated cost of the meals' ingredients (quantities used, not packets; extras not counted). */
  cost: Cost;
  groups: { aisle: string; items: ListItemDto[] }[];
  /** Usual extras, ticked quickly into the list. */
  habitual: { id: string; name: string; aisle: string }[];
}
export interface StateDto {
  today: string;
  ingredients: IngredientDto[];
  meals: MealDto[];
  moments: MomentDto[];
  /** Planned meals of the list's period. */
  plan: PlanDto[];
  list: ListDto;
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
