// Public types of the To-do's service `todo` (types only: the only import
// allowed between modules, docs/MODULES.md §5.8).

export interface TodoTask {
  id: number;
  title: string;
  tags: string[];
  /** "YYYY-MM-DD" or null. */
  due: string | null;
  done: boolean;
}

export interface TodoService {
  /** Tasks still to do, in the order of the page (by due date). */
  listOpenTasks(): TodoTask[];
  /** One task, done or not; null when it does not exist (any more). */
  getTask(id: number): TodoTask | null;
  /**
   * Ticks a task (« Fait »). Only on an explicit click of the user in the
   * calling module (e.g. « Tâche terminée ? » → « Oui » of the Timer).
   */
  completeTask(id: number): TodoTask;
  /**
   * Adds a task (tags cleaned, due date « YYYY-MM-DD » or natural French).
   * Only on an explicit click of the user in the calling module (e.g.
   * « Transformer en tâche » of the Boîte à idées). `trackId`: a track of
   * the library, ignored when the library is absent.
   */
  createTask(fields: {
    title: string;
    tags?: string[];
    due?: string | null;
    trackId?: number | null;
  }): TodoTask;
}
