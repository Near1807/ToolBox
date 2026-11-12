// Shapes shared by the Agenda's backend and its pages (PC and phone).

/** An event of the Agenda itself, or an occurrence of the week type. */
export interface AgendaEventDto {
  /** The event's id; for an occurrence of the week type « <weekly id>:<date> ». */
  id: string;
  title: string;
  /** « YYYY-MM-DD » (all day) or « YYYY-MM-DDTHH:mm ». */
  start: string;
  /** All day: the last day « YYYY-MM-DD » (inclusive). At a time: the end « YYYY-MM-DDTHH:mm ». */
  end: string;
  allDay: boolean;
  location: string | null;
  note: string | null;
  category: string;
  /** Occurrence of the week type: its entry and its date (cancel / move one). */
  weekly: { id: string; date: string; moved: boolean } | null;
}

/** Something of another module, as the Agenda shows it (read only). */
export interface ForeignEventDto {
  id: string;
  moduleId: string;
  title: string;
  start: string;
  /** Same rule as AgendaEventDto.end. */
  end: string;
  allDay: boolean;
  category: string;
  open: string;
  status: string | null;
}

/** A task of the To-do to fit in (read only here). */
export interface ToPlaceDto {
  id: string;
  title: string;
  due: string | null;
  estimateMin: number | null;
  open: string;
  late: boolean;
}

export interface WeeklyDto {
  id: string;
  title: string;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** « HH:mm ». */
  time: string;
  durationMin: number;
  category: string;
  location: string | null;
  /** First and last day it applies (null: no limit). */
  from: string | null;
  until: string | null;
}

export interface RangeDto {
  today: string;
  from: string;
  to: string;
  events: AgendaEventDto[];
  foreign: ForeignEventDto[];
  /** Tasks to fit in (due by `to`, late ones too, then those without a date). */
  toPlace: ToPlaceDto[];
  /** The To-do is there: « À caser » is shown, and the bar can add tasks. */
  todo: boolean;
  weekly: WeeklyDto[];
  dayStartHour: number;
  dayEndHour: number;
  /** Every category seen in the period (own and other modules'), for the layers. */
  categories: string[];
}
