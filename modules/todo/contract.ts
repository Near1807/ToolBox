// Public types of the To-do's service `todo` (types only: the only import
// allowed between modules, docs/MODULES.md §5.8).
import type { ReactNode } from 'react';

export interface TodoTask {
  /** A UUID since v0.25 (« Prêt pour la synchro »; a task numbered n before is `legacyId('todo:task', n)`). */
  id: string;
  title: string;
  tags: string[];
  /** "YYYY-MM-DD" or null. */
  due: string | null;
  done: boolean;
  /** Estimated duration in minutes (v0.34.0), null when not given. */
  durationMin: number | null;
  /** Planned start « YYYY-MM-DDTHH:mm » (v0.35.0), null when not planned. */
  plannedAt: string | null;
}

export interface TodoService {
  /** Tasks still to do, in the order of the page (by due date). */
  listOpenTasks(): TodoTask[];
  /** One task, done or not; null when it does not exist (any more). */
  getTask(id: string): TodoTask | null;
  /**
   * Ticks a task (« Fait »). Only on an explicit click of the user in the
   * calling module (e.g. « Tâche terminée ? » → « Oui » of the Timer).
   */
  completeTask(id: string): TodoTask;
  /**
   * Unticks a task (back to « à faire »). Only to undo a tick the calling
   * module made itself, on an explicit click (« Annuler » of the Timer).
   */
  uncompleteTask(id: string): TodoTask;
  /**
   * Adds a task (tags cleaned, due date « YYYY-MM-DD » or natural French).
   * Only on an explicit click of the user in the calling module (e.g.
   * « Transformer en tâche » of the Boîte à idées). `trackId`: a track of
   * the library, ignored when the library is absent. `durationMin`: the
   * estimate (minutes), none when absent.
   */
  createTask(fields: {
    title: string;
    tags?: string[];
    due?: string | null;
    trackId?: number | null;
    durationMin?: number | null;
    plannedAt?: string | null;
  }): TodoTask;
  /**
   * Plans a task at a day and time, or takes it out of the agenda
   * (`plannedAt: null`), and/or changes its estimate (v0.35.0, the Agenda).
   * A planned task without an estimate gets 30 min. Only on an explicit
   * action of the user in the calling module (a drop, « Retirer de
   * l'agenda »), with « Annuler » after.
   */
  planTask(
    id: string,
    fields: { plannedAt?: string | null; durationMin?: number | null },
  ): TodoTask;
  /**
   * v0.36.0: deletes a task (a tombstone, like the To-do's own deletion).
   * Only to undo a creation the calling module made on a click (« Annuler »
   * after « Tâche » in the Agenda).
   */
  deleteTask(id: string): void;
}

/**
 * v0.36.0 (ADR 0046): props of the sheet the To-do lends, « todo.taskEditor »
 * (get it with useLent('todo.taskEditor'); null without the To-do). Every
 * field of the task, the To-do's own form and checks; it writes only
 * through the To-do's API.
 */
export interface TaskEditorProps {
  taskId: string;
  /** After each change made in the sheet: what happened, and its undo when there is one. */
  onChanged?: (change: { message: string; undo?: () => Promise<unknown> }) => void;
  /** The borrower's own buttons (the Agenda: « Lancer un timer »). */
  children?: ReactNode;
}
