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
  /** v0.36.0: the associated timer (the Timer's TimerChoice; an occurrence: its entry's), or null. */
  timerPref: Record<string, unknown> | null;
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
  category: string;
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
}
