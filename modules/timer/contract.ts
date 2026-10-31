// Public types of the Timer's service `timer` (types only: the only import
// allowed between modules, docs/MODULES.md §5.8).

export interface TimerService {
  /** Seconds of work done per To-do task (all recorded sessions, finished or stopped). */
  timeByTask(): Record<string, number>;
  /** The session in progress, if any (task id when it is linked to one). */
  current(): { taskId: string | null; phase: 'work' | 'break' | 'long-break' | null } | null;
}
