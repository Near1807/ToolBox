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
  reason: 'quotidienne' | 'avant-restauration';
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
