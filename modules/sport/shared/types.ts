// Shapes of the Sport API (shared by the backend and the page).
import type { Session, Summary, TemplateItem } from './plan';

export interface WeekDto {
  /** Monday of the week. */
  week: string;
  today: string;
  days: { date: string; sessions: Session[] }[];
  summary: Summary;
  /** The current month (for the summary card). */
  month: Summary;
  /** Complete weeks in a row. */
  streak: number;
  template: TemplateItem[];
}

export interface MonthDto {
  month: string;
  today: string;
  weeks: WeekDto[];
  summary: Summary;
}
