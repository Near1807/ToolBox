// Types shared by the backend and the page of the To-do module.

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
