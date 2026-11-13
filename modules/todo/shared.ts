// Types shared by the backend and the page of the To-do module.
import {
  DEFAULT_PLANNED_MIN,
  formatDue,
  formatDuration,
  formatPlanned,
  splitQuickAdd,
} from '@hub/sdk/dates';

export interface TaskDto {
  id: string;
  title: string;
  tags: string[];
  /** "YYYY-MM-DD" or null. */
  due: string | null;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
  /** Track of the library the task belongs to (null when none, or the library is absent). */
  track: { id: number; title: string } | null;
  /** Seconds of work recorded by the Timer on this task (0 without the Timer module). */
  timeSpent: number;
  /** Estimated duration in minutes (« ~2h »), null when not given. */
  durationMin: number | null;
  /** Planned start « YYYY-MM-DDTHH:mm » (« prévu le … à … »), null when not planned. */
  plannedAt: string | null;
  /** v0.36.0: the associated timer (the Timer's TimerChoice, opaque here), or null. */
  timerPref: Record<string, unknown> | null;
}

export interface TasksResponse {
  today: string;
  tasks: TaskDto[];
  tags: { name: string; count: number }[];
  /** True when the music library is there (tasks can be linked to a track). */
  library: boolean;
  tracks: { id: number; title: string }[];
  /** True when the Timer module is there (« Lancer un timer » on each task). */
  timer: boolean;
}

/** Tags are lower case, without « # », spaces turned into dashes. */
export function cleanTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').slice(0, 40);
}

export function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(cleanTag).filter(Boolean))];
}

/**
 * v0.36.0, the « Ajouter » bar (« Tâche »): what will be added, with the
 * To-do's quick-add rules (splitQuickAdd). Pure.
 */
export function taskPreview(
  input: string,
  today: string,
): { ok: true; text: string; fields: QuickTask } | { ok: false; text: string } {
  const split = splitQuickAdd(input, today);
  if (!split.title.trim()) return { ok: false, text: 'Écris d’abord un titre.' };
  const parts = [`Tâche « ${split.title} »`];
  if (split.tags.length) parts.push(split.tags.map((t) => `#${t}`).join(' '));
  if (split.start) parts.push(`prévue ${formatPlanned(split.start, today)}`);
  if (split.due) parts.push(`échéance ${formatDue(split.due, today)}`);
  if (split.durationMin || split.start)
    parts.push(formatDuration(split.durationMin ?? DEFAULT_PLANNED_MIN));
  return {
    ok: true,
    text: parts.join(' · '),
    fields: {
      title: split.title,
      tags: cleanTags(split.tags),
      due: split.due,
      durationMin: split.durationMin,
      plannedAt: split.start,
    },
  };
}

export interface QuickTask {
  title: string;
  tags: string[];
  due: string | null;
  durationMin: number | null;
  plannedAt: string | null;
}
