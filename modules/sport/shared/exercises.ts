// Exercises of a session: a library (name, note) and, for each session of the
// weekly template and each session of the calendar, an ordered list of lines
// (exercise, sets × reps, load, rest, note). Pure, tested in tests/exercises.test.ts.

export interface Exercise {
  id: string;
  name: string;
  note: string;
  /** Lines of the template or of sessions that use it. */
  uses: number;
}

/**
 * A line: one row of `sport__template_exercises` or `sport__session_exercises`
 * (since migration 3, so that a synchronisation merges line by line).
 */
export interface ExerciseLine {
  /** The line's own id (absent for a line not saved yet). */
  id?: string;
  exerciseId: string;
  sets: number | null;
  /** « 8 », « 8-10 », « 30 s »… */
  reps: string;
  /** « 20 kg », « poids du corps »… */
  load: string;
  restSec: number | null;
  note: string;
}

/** A line as shown: with the exercise's name. */
export interface ExerciseLineDto extends ExerciseLine {
  name: string;
}

/** A line sent by the page: an exercise of the library, or a new name. */
export interface ExerciseLineInput extends Partial<ExerciseLine> {
  name?: string;
}

export const MAX_LINES = 40;

/** Text without accents nor case, to find an exercise however it is typed. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Lines checked; `resolve` gives the exercise of a name (found, or created)
 * when the line has no known `exerciseId`. Throws a French message.
 */
export function cleanLines(
  raw: unknown,
  known: (id: string) => boolean,
  resolve: (name: string) => string,
): ExerciseLine[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('Liste d’exercices invalide');
  if (raw.length > MAX_LINES) throw new Error(`${MAX_LINES} exercices au plus par séance`);
  return raw.map((value, index) => {
    const v = (value ?? {}) as Record<string, unknown>;
    const at = `exercice ${index + 1}`;
    let exerciseId = typeof v.exerciseId === 'string' && known(v.exerciseId) ? v.exerciseId : '';
    if (!exerciseId) {
      const name = String(v.name ?? '')
        .trim()
        .slice(0, 80);
      if (!name) throw new Error(`Nom manquant (${at})`);
      exerciseId = resolve(name);
    }
    const int = (n: unknown, min: number, max: number, label: string): number | null => {
      if (n === undefined || n === null || n === '') return null;
      const x = Number(n);
      if (!(Number.isInteger(x) && x >= min && x <= max))
        throw new Error(`${label} de ${min} à ${max} (${at})`);
      return x;
    };
    return {
      ...(typeof v.id === 'string' && v.id ? { id: v.id } : {}),
      exerciseId,
      sets: int(v.sets, 1, 50, 'Séries'),
      reps: String(v.reps ?? '')
        .trim()
        .slice(0, 20),
      load: String(v.load ?? '')
        .trim()
        .slice(0, 40),
      restSec: int(v.restSec, 0, 3600, 'Repos'),
      note: String(v.note ?? '')
        .trim()
        .slice(0, 200),
    };
  });
}

/** The JSON of the old `exercises` column (read by migration 3 only; a damaged value gives an empty list). */
export function parseLines(json: string | null | undefined): ExerciseLine[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? (value as ExerciseLine[]) : [];
  } catch {
    return [];
  }
}

/** « 4 × 8 · 60 kg · repos 1 min 30 · note ». */
export function formatLine(line: ExerciseLine): string {
  const parts: string[] = [];
  if (line.sets && line.reps) parts.push(`${line.sets} × ${line.reps}`);
  else if (line.sets) parts.push(`${line.sets} série${line.sets > 1 ? 's' : ''}`);
  else if (line.reps) parts.push(line.reps);
  if (line.load) parts.push(line.load);
  if (line.restSec !== null && line.restSec !== undefined)
    parts.push(`repos ${rest(line.restSec)}`);
  if (line.note) parts.push(line.note);
  return parts.join(' · ');
}

function rest(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${String(s).padStart(2, '0')}` : `${m} min`;
}

/** « Squat 4 × 8 · 60 kg ; Gainage 3 × 30 s » (export, assistant). */
export function linesText(lines: ExerciseLineDto[], separator = ' ; '): string {
  return lines
    .map((l) => {
      const detail = formatLine(l);
      return detail ? `${l.name} ${detail}` : l.name;
    })
    .join(separator);
}
