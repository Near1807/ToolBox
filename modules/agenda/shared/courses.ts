// v0.45.0: the courses of the imported timetables, for the Agenda's service
// `agenda.courses()` (read only): the Coffre recognises a course in a file's
// name and shows its code, teachers and next slot. Pure (tested).
import type { AgendaCourse } from '../contract';
import { describeEvent } from './import-item';
import { readOrigin } from './importing';

/** An imported event as stored (the columns the courses need). */
export interface ImportedRow {
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  origin: string | null;
}

const fold = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The teachers of a description (« Ens:PCH », « Ens: Dupont, Martin »). */
function teachersOf(description: string): string[] {
  return description
    .split('\n')
    .flatMap((l) => /^\s*ens\s*:\s*(.+)$/i.exec(l)?.[1]?.split(/[,;/]/) ?? [])
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * The courses of the imported events, one per name: its code, its teachers
 * (sorted), its next occurrence at `now` (« YYYY-MM-DDTHH:mm ») or after.
 */
export function coursesOf(rows: readonly ImportedRow[], now: string): AgendaCourse[] {
  const byName = new Map<string, AgendaCourse>();
  for (const row of rows) {
    const original = readOrigin(row.origin)?.original;
    if (!original) continue;
    const description = (original.DESCRIPTION ?? '').replace(/\\n/g, '\n');
    const { title, code } = describeEvent(original.SUMMARY ?? row.title, description);
    const name = title.replace(/\s·\s(Oral|Écrit)$/, '').trim() || row.title;
    const key = fold(name);
    const course = byName.get(key) ?? { name, code: null, teachers: [], next: null };
    if (!course.code && code) course.code = code;
    for (const t of teachersOf(description))
      if (!course.teachers.includes(t)) course.teachers.push(t);
    if (row.start_at >= now && (!course.next || row.start_at < course.next.start))
      course.next = { start: row.start_at, end: row.end_at, location: row.location };
    byName.set(key, course);
  }
  return [...byName.values()]
    .map((c) => ({ ...c, teachers: [...c.teachers].sort((a, b) => a.localeCompare(b, 'fr')) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
