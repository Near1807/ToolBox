// v0.45.0: what the Coffre guesses for a dropped file (règle 1 du cahier des
// charges). Every value is « deviné » with its reason, always changeable; a
// value Thomas chose is never replaced (mergeGuesses). No clue: nothing
// proposed, never at random. Pure (tested).
import type { FileProvenance } from '@hub/sdk/core';
import { kindOf } from './kinds';
import type { CourseHint, LabelDto, ProposalDto } from './types';

/** A folder as the deductions need it: its id and the names from the root. */
export interface FolderRef {
  id: string;
  path: string[];
}

export interface DeduceInput {
  name: string;
  isDirectory: boolean;
  /** The original's date (ISO), for the year. */
  fileDate: string | null;
  provenance: FileProvenance | null;
  folders: readonly FolderRef[];
  /** The Agenda's courses (empty without the Agenda). */
  courses: readonly CourseHint[];
  /** Sites already seen: the host and the folder its element was put in. */
  sites: readonly { host: string; folderId: string }[];
  /** A folder's main language (its files' extensions), when it is a project. */
  folderLanguage?: string | null;
}

/** « École », « ecole » → « ecole »: no accents, lower case. */
export const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The words of a name (« TH2C_Thermo-chap3.pdf » → th2c, thermo, chap3), 2 letters at least. */
export function wordsOf(text: string): string[] {
  return fold(text)
    .replace(/\.[a-z0-9]{1,8}$/, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

/** The host of an address (« https://moodle.ecam.be/x » → « moodle.ecam.be »), or null. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url.trim());
  return m ? m[1]!.toLowerCase().replace(/^www\./, '') : null;
}

const guess = (family: LabelDto['family'], value: string, reason: string): LabelDto => ({
  family,
  value,
  origin: 'guessed',
  reason,
});

/** Does every word of `name` appear among `words` (a folder « Thermo », a course « Réseaux locaux »)? */
function covers(name: string, words: Set<string>): boolean {
  const own = wordsOf(name).filter((w) => w.length >= 3 || /\d/.test(w));
  return own.length > 0 && own.every((w) => words.has(w));
}

export function deduce(input: DeduceInput): Pick<ProposalDto, 'route' | 'labels'> {
  const labels: LabelDto[] = [];
  const kind = input.isDirectory ? null : kindOf(input.name);
  if (input.isDirectory) {
    if (input.folderLanguage) {
      labels.push(guess('nature', 'code', 'dossier de fichiers de code'));
      labels.push(
        guess('language', input.folderLanguage, 'langage le plus présent dans le dossier'),
      );
    }
  } else if (kind) {
    const ext = input.name.slice(input.name.lastIndexOf('.'));
    labels.push(guess('nature', kind.nature, `extension ${ext}`));
    if (kind.language) labels.push(guess('language', kind.language, `extension ${ext}`));
  }

  // Downloaded: Windows' « Mark of the Web » on the original.
  const p = input.provenance;
  const site = hostOf(p?.referrerUrl) ?? hostOf(p?.hostUrl);
  if (p && (p.zone === 3 || site)) {
    labels.push(guess('origin', 'téléchargé', 'marque Windows « téléchargé depuis Internet »'));
    if (site) labels.push(guess('site', site, `adresse de téléchargement (${site})`));
  }

  if (input.fileDate && /^\d{4}/.test(input.fileDate))
    labels.push(guess('year', input.fileDate.slice(0, 4), 'date du fichier'));

  // The folder: the same site as an element already put away, then the words of the name.
  let route: ProposalDto['route'] = null;
  const byId = new Map(input.folders.map((c) => [c.id, c]));
  if (site) {
    const seen = input.sites.filter((s) => s.host === site && byId.has(s.folderId));
    const counts = new Map<string, number>();
    for (const s of seen) counts.set(s.folderId, (counts.get(s.folderId) ?? 0) + 1);
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (best) {
      const c = byId.get(best[0])!;
      route = {
        kind: 'existing',
        id: c.id,
        path: c.path,
        reason: `un fichier de ${site} est déjà rangé dans « ${c.path.join(' › ')} »`,
      };
    }
  }
  const words = new Set(wordsOf(input.name));
  if (!route) {
    // The deepest folder whose own name is in the file's name.
    const matches = input.folders
      .filter((c) => covers(c.path[c.path.length - 1]!, words))
      .sort((a, b) => b.path.length - a.path.length || a.path.join().localeCompare(b.path.join()));
    if (matches[0])
      route = {
        kind: 'existing',
        id: matches[0].id,
        path: matches[0].path,
        reason: `« ${matches[0].path[matches[0].path.length - 1]} » dans le nom du fichier`,
      };
  }
  // A course of the Agenda: its name or its code in the file's name; a teacher's initials.
  const course =
    input.courses.find((c) => covers(c.name, words)) ??
    input.courses.find(
      (c) => c.code !== null && wordsOf(c.code).some((w) => w.length >= 3 && words.has(w)),
    );
  const teacherCourse = course
    ? null
    : input.courses.find((c) => c.teachers.some((t) => t.length >= 2 && words.has(fold(t))));
  const found = course ?? teacherCourse;
  if (found) {
    const why = course
      ? `cours « ${found.name} » de l'Agenda dans le nom du fichier`
      : `${found.teachers.find((t) => words.has(fold(t)))} enseigne « ${found.name} » (Agenda)`;
    if (!route) {
      const existing = input.folders.find(
        (c) => fold(c.path[c.path.length - 1]!) === fold(found.name),
      );
      route = existing
        ? { kind: 'existing', id: existing.id, path: existing.path, reason: why }
        : { kind: 'new', path: ['Cours', found.name], reason: `${why} (nouvelle route)` };
    }
    labels.push(guess('course', found.name, why));
    if (found.teachers.length === 1)
      labels.push(guess('prof', found.teachers[0]!, `enseigne « ${found.name} » (Agenda)`));
  }
  return { route, labels };
}

/**
 * Thomas's choices win: a family with a chosen (or default) label receives no
 * guess; a new guess replaces the older guesses of its family. Returns the
 * labels to keep.
 */
export function mergeGuesses(
  current: readonly LabelDto[],
  guesses: readonly LabelDto[],
): LabelDto[] {
  const kept = current.filter((l) => l.origin !== 'guessed');
  const held = new Set(kept.map((l) => l.family));
  const fresh = new Set(guesses.map((g) => g.family));
  const out = [...kept, ...current.filter((l) => l.origin === 'guessed' && !fresh.has(l.family))];
  for (const g of guesses) {
    if (held.has(g.family) || g.family === 'free') continue;
    if (out.some((l) => l.family === g.family && fold(l.value) === fold(g.value))) continue;
    out.push(g);
  }
  return out;
}
