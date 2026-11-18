import type { CategoryDto } from './categories';

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
  /** Its category's CURRENT name (v0.43.0: found by its identifier). */
  category: string;
  /** v0.43.0: its category's identifier (agenda__categories). */
  categoryId?: string;
  /** Occurrence of the week type: its entry and its date (cancel / move one). */
  weekly: { id: string; date: string; moved: boolean } | null;
  /** v0.36.0: the associated timer (the Timer's TimerChoice; an occurrence: its entry's), or null. */
  timerPref: Record<string, unknown> | null;
  /** v0.37.0: imported events only: their source and their original text. */
  source?: EventSourceDto;
  /**
   * v0.40.0: « facultatif » (an event of the Agenda only, absent = no): still
   * shown in its place, but neither in the conflicts nor in the load.
   */
  optional?: true;
  /** v0.42.0: its category has the « deadline » shape: a moment (end = start), never counted. */
  deadline?: true;
  /** v0.42.0: a deadline ticked « faite » (shown dimmed, struck through). */
  done?: true;
}

/** v0.37.0: where an imported event comes from (shown in its detail). */
export interface EventSourceDto {
  id: string;
  name: string;
  /** The event as it was in the file, field by field (« SUMMARY », « DESCRIPTION »… or the columns). */
  original: Record<string, string>;
}

/** v0.37.0: an imported calendar (Réglages › Agenda › Sources). */
export interface AgendaSourceDto {
  id: string;
  name: string;
  /** « ics », « csv » or « xlsx ». */
  format: string;
  /** Name of the calendar in the file (X-WR-CALNAME), or null. */
  calendarName: string | null;
  /** Value of the file → Agenda category. */
  mapping: Record<string, string>;
  defaultCategory: string;
  titleStyle: 'short' | 'code';
  /** Table import: which column is what (kept for the next import), or null. */
  columns: Partial<Record<string, number>> | null;
  lastImportAt: string | null;
  /** Its events in the Agenda (not deleted). */
  events: number;
  /** The Agenda categories of its events. */
  categories: string[];
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

/**
 * v0.35.0: a task of the To-do planned at a time (its block in the week). It
 * stays the To-do's: the Agenda changes it through the service `todo`.
 */
export interface PlannedTaskDto {
  /** The task's id (the To-do's UUID). */
  id: string;
  title: string;
  /** « YYYY-MM-DDTHH:mm ». */
  start: string;
  end: string;
  allDay: false;
  /** « Tâches », or (v0.43.0) the category of the Agenda given to it. */
  category: string;
  /** v0.43.0: the category of the Agenda given to it, or absent (« Tâches »). */
  categoryId?: string;
  /** Ticked: shown crossed out. */
  done: boolean;
  due: string | null;
  /** Planned after its due date: flagged, never blocked. */
  afterDue: boolean;
  open: string;
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
  /** v0.43.0: its category's identifier. */
  categoryId?: string;
  location: string | null;
  /** First and last day it applies (null: no limit). */
  from: string | null;
  until: string | null;
  /** v0.36.0: the associated timer, or null. */
  timerPref: Record<string, unknown> | null;
}

export interface RangeDto {
  today: string;
  from: string;
  to: string;
  events: AgendaEventDto[];
  foreign: ForeignEventDto[];
  /** Tasks to fit in (due by `to`, late ones too, then those without a date). */
  toPlace: ToPlaceDto[];
  /** v0.35.0: tasks of the To-do planned in the period (blocks). */
  tasks: PlannedTaskDto[];
  /** v0.36.0: the timer running now (with the Timer): its task, or what it was started for. */
  timer: { taskId: string | null; subject: string | null } | null;
  /** The To-do is there: « À caser » is shown, and the bar can add tasks. */
  todo: boolean;
  weekly: WeeklyDto[];
  dayStartHour: number;
  dayEndHour: number;
  /** Every category seen in the period (own and other modules'), for the switches. */
  categories: string[];
  /** v0.35.0: the categories off by default (setting), until switched on on this device. */
  categoriesOff: string[];
  /** v0.42.0: every category with its colour, shape and defaults, in Thomas's order. */
  categoryInfo: CategoryDto[];
  /** v0.42.0: the « Deadlines » row: not done, late ones included, up to `to` + 7 days; sorted. */
  deadlines: AgendaEventDto[];
}
