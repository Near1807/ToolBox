// Public types of the Timer's service `timer` (types only: the only import
// allowed between modules, docs/MODULES.md §5.8).

export interface TimerService {
  /** Seconds of work done per To-do task (all recorded sessions, finished or stopped). */
  timeByTask(): Record<string, number>;
  /** The session in progress, if any (task id when it is linked to one). */
  current(): {
    taskId: string | null;
    phase: 'work' | 'break' | 'long-break' | null;
    /** v0.36.0: what it was started for in another module (« agenda:event:<id> »), or null. */
    subject: string | null;
  } | null;
}

/**
 * v0.36.0 (ADR 0046): the timer a task or an event prefers (« Associer un
 * timer »). Kept by the module that owns the task or the event, as an opaque
 * value; only the Timer reads it.
 */
export type TimerChoice =
  /** A simple timer of the block's length. */
  | { kind: 'block' }
  /** The Timer's default pomodoro (25/5, 4 cycles). */
  | { kind: 'pomodoro' }
  /** One of the presets, by id (its name shown as given then). */
  | { kind: 'preset'; presetId: string; name: string };

/**
 * Props of « timer.launch », lent by the Timer: a « Lancer un timer » button
 * with a short choice. It starts the session through the Timer's own API
 * (one timer at a time: a running one is named, and stopped only after a
 * confirmation).
 */
export interface TimerLaunchProps {
  /** Title of the session (the event's or the task's). */
  title: string;
  /** Length of the block, minutes (« Durée du bloc »). */
  blockMin: number;
  /** A task of the To-do: the session is linked to it (« Tâche terminée ? »). */
  taskId?: string | null;
  /** Otherwise what it is for (« agenda:event:<id> »), to show it runs. */
  subject?: string | null;
  /** The associated timer, if any: the button becomes « Lancer : … ». */
  preferred?: TimerChoice | null;
  /** « Associer » / « Ne plus associer »: the owner of the task or event keeps it. */
  onPreferredChange?: (choice: TimerChoice | null) => Promise<void> | void;
  /** After a start (the borrower refreshes what it shows). */
  onStarted?: () => void;
  /** Smaller button (in a block). */
  compact?: boolean;
}
