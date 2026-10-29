// Shapes of the Courses API (shared by the backend and the page).

export interface IngredientDto {
  id: string;
  name: string;
  unit: string;
  aisle: string;
}
export interface MealDto {
  id: string;
  name: string;
  /** Portions the recipe is written for. */
  servings: number;
  tags: string[];
  note: string;
  items: { id: string; ingredientId: string; qty: number; unit: string }[];
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
