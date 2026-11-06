// The phone's safety net (ADR 0044): Android does not promise to keep the
// WebView's storage (storage.persist() = non on the S21), so the app copies
// its database once a day, at opening, into its own storage (Capacitor
// Filesystem, Directory.Data, never emptied by Android). The rules here are
// pure functions (tested in tests/phone/backup.test.ts); the app does the
// reading and writing (mobile/app/src/backup.ts). Portable: no Node import.

/** How many copies are kept (the oldest ones are deleted, they are internal copies). */
export const KEEP_COPIES = 7;

export interface BackupCopy {
  /** File name of the copy (in the app's own storage). */
  file: string;
  /** When it was taken (ISO). */
  createdAt: string;
  /** Local day of the copy (AAAA-MM-JJ). */
  day: string;
  /** Tasks of the To-do in it (not deleted). */
  tasks: number;
  /** All rows of the modules' tables in it (0: an empty base). */
  rows: number;
  /** Version of the app that took it. */
  appVersion: string;
  /** Why it was taken. */
  reason: 'quotidienne' | 'avant-restauration' | 'avant-migration' | 'avant-synchro';
  /**
   * Elements per module in it (key: COUNTED[].key), e.g. { tasks: 12, ideas: 3 }.
   * Absent on the copies of 0.30.0 (they only have `tasks`).
   */
  counts?: Record<string, number>;
}

/** What a copy card counts, module by module (only tables that exist are read). */
export const COUNTED: readonly {
  key: string;
  module: string;
  table: string;
  one: string;
  many: string;
}[] = [
  { key: 'tasks', module: 'todo', table: 'todo__tasks', one: 'tâche', many: 'tâches' },
  { key: 'ideas', module: 'ideas', table: 'ideas__ideas', one: 'idée', many: 'idées' },
  { key: 'sessions', module: 'sport', table: 'sport__sessions', one: 'séance', many: 'séances' },
  {
    key: 'timers',
    module: 'timer',
    table: 'timer__sessions',
    one: 'session de timer',
    many: 'sessions de timer',
  },
  { key: 'recipes', module: 'courses', table: 'courses__meals', one: 'recette', many: 'recettes' },
  {
    key: 'ingredients',
    module: 'courses',
    table: 'courses__ingredients',
    one: 'ingrédient',
    many: 'ingrédients',
  },
];

/** The SQL connection the counts need (the Worker's adapter, or better-sqlite3 in tests). */
interface CountDb {
  prepare(sql: string): { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
}

/**
 * Counts of the base: every row of the modules' tables (0: an empty base) and
 * the elements per module (not deleted). Works on a base not migrated yet.
 */
export function countBase(db: CountDb): {
  rows: number;
  tasks: number;
  counts: Record<string, number>;
} {
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  )
    .map((t) => t.name)
    .filter((name) => !name.startsWith('core__'));
  let rows = 0;
  for (const name of tables)
    rows += (db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
  const counts: Record<string, number> = {};
  for (const c of COUNTED) {
    if (!tables.includes(c.table)) continue;
    const columns = db.prepare(`PRAGMA table_info("${c.table}")`).all() as { name: string }[];
    const where = columns.some((col) => col.name === 'deleted_at')
      ? ' WHERE deleted_at IS NULL'
      : '';
    counts[c.key] = (
      db.prepare(`SELECT COUNT(*) AS n FROM "${c.table}"${where}`).get() as { n: number }
    ).n;
  }
  return { rows, tasks: counts.tasks ?? 0, counts };
}

/** « 12 tâches · 1 idée · 3 séances » (only what the copy holds; old cards: the tasks). */
export function describeCounts(copy: Pick<BackupCopy, 'tasks' | 'counts'>): string {
  const counts = copy.counts ?? { tasks: copy.tasks };
  const parts = COUNTED.filter((c) => (counts[c.key] ?? 0) > 0).map(
    (c) => `${counts[c.key]} ${counts[c.key] === 1 ? c.one : c.many}`,
  );
  return parts.length ? parts.join(' · ') : 'aucun élément';
}

/**
 * Whether to copy the base BEFORE migrating it: a migration is pending and the
 * base holds something (an absent or empty base has nothing to protect).
 */
export function needsCopyBeforeMigration(base: BaseState, pendingMigrations: number): boolean {
  return pendingMigrations > 0 && !base.absent && base.rows > 0;
}

/** What the app knows of its base when it opens. */
export interface BaseState {
  /** The base file did not exist in OPFS before this opening. */
  absent: boolean;
  /** All rows of the modules' tables (0: nothing in it). */
  rows: number;
}

/** Newest first. */
export function sortCopies(copies: BackupCopy[]): BackupCopy[] {
  return [...copies].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Whether to take today's copy. Never of an empty base: a base Android
 * emptied must not push the good copies out, one per day.
 */
export function needsDailyCopy(copies: BackupCopy[], today: string, base: BaseState): boolean {
  if (base.absent || base.rows === 0) return false;
  return !copies.some((c) => c.day === today);
}

/** The copies to delete after a new one: everything beyond the 7 newest. */
export function copiesToDelete(copies: BackupCopy[]): BackupCopy[] {
  return sortCopies(copies).slice(KEEP_COPIES);
}

/**
 * At opening, when the base is absent or empty BUT a copy with data exists:
 * the newest such copy, offered to the user (never restored automatically).
 */
export function restoreOffer(copies: BackupCopy[], base: BaseState): BackupCopy | null {
  if (!base.absent && base.rows > 0) return null;
  return sortCopies(copies).find((c) => c.rows > 0) ?? null;
}

/** The local day of a date (AAAA-MM-JJ). */
export function localDay(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** File name of a copy taken at this time: toolbox-2026-11-05T10-00-00-000Z.sqlite3. */
export function copyFileName(createdAt: string): string {
  return `toolbox-${createdAt.replace(/[:.]/g, '-')}.sqlite3`;
}
