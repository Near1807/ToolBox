// v0.51.0 (Expérimental, ADR 0068): what a PROJECT does not save — the
// recreatable folders (node_modules, .venv, build… : v0.49's list), what its
// .gitignore files say (the root's and the sub-folders', full gitignore syntax,
// negations « ! » included, read with the `ignore` library), and Thomas's own
// choices (« Ne pas sauvegarder ce dossier » / « Le sauvegarder quand même »).
// .git is NEVER excluded. An excluded path is neither saved on the disk, nor
// indexed, nor searched; excluding never touches a file.
import { readFileSync } from 'node:fs';
import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { isDepsFolder, isIgnoredFile, measure } from './walk';

/** Thomas's choices for one project (relative paths, « / »). */
export interface ExclusionChoices {
  /** « Ne pas sauvegarder ce dossier ». */
  exclude: string[];
  /** « Le sauvegarder quand même » (wins over the list and the .gitignore). */
  include: string[];
}

export type ExclusionReason = 'défaut' | '.gitignore' | 'choisi';

export const EMPTY_CHOICES: ExclusionChoices = { exclude: [], include: [] };

/** The choices stored on the project's row (JSON), cleaned. */
export function parseChoices(json: string | null): ExclusionChoices {
  if (!json) return { exclude: [], include: [] };
  try {
    const v = JSON.parse(json) as Partial<ExclusionChoices>;
    const clean = (list: unknown) =>
      Array.isArray(list)
        ? [...new Set(list.filter((x): x is string => typeof x === 'string').map(cleanRel))].filter(
            Boolean,
          )
        : [];
    return { exclude: clean(v.exclude), include: clean(v.include) };
  } catch {
    return { exclude: [], include: [] };
  }
}

/** « src\\build/ » → « src/build » (never outside the project). */
export function cleanRel(rel: string): string {
  const parts = rel
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.');
  if (parts.includes('..')) return '';
  return parts.join('/');
}

/** .git (and anything in it), at any depth: never excluded. */
const isGit = (rel: string) => rel.split('/').includes('.git');

/**
 * The rules of one project folder. The .gitignore files are read as the
 * folders are visited (`load`), each one applying to its own folder and below,
 * the deepest deciding first (git's order).
 */
export class ProjectRules {
  private readonly matchers = new Map<string, Ignore | null>();
  private readonly include: Set<string>;
  private readonly exclude: Set<string>;

  constructor(
    private readonly root: string,
    choices: ExclusionChoices = EMPTY_CHOICES,
  ) {
    this.include = new Set(choices.include);
    this.exclude = new Set(choices.exclude);
  }

  /** The .gitignore of a folder (relative; « » = the root), read once. */
  private matcherOf(dirRel: string): Ignore | null {
    if (this.matchers.has(dirRel)) return this.matchers.get(dirRel)!;
    let m: Ignore | null;
    try {
      const text = readFileSync(path.join(this.root, ...dirRel.split('/'), '.gitignore'), 'utf8');
      m = ignore({ allowRelativePaths: true }).add(text);
    } catch {
      m = null;
    }
    this.matchers.set(dirRel, m);
    return m;
  }

  /** Why `rel` is not saved, or null (it is). */
  reason(rel: string, isDir: boolean): ExclusionReason | null {
    const clean = cleanRel(rel);
    if (!clean || isGit(clean)) return null;
    if (this.exclude.has(clean)) return 'choisi';
    const parts = clean.split('/');
    // « Le sauvegarder quand même »: that folder and everything in it.
    for (let n = parts.length; n > 0; n--)
      if (this.include.has(parts.slice(0, n).join('/'))) return null;
    // The .gitignore files, from the deepest folder up to the root.
    for (let depth = parts.length - 1; depth >= 0; depth--) {
      const dirRel = parts.slice(0, depth).join('/');
      const m = this.matcherOf(dirRel);
      if (!m) continue;
      const sub = parts.slice(depth).join('/') + (isDir ? '/' : '');
      const r = m.test(sub);
      if (r.ignored) return '.gitignore';
      if (r.unignored) return null;
    }
    const name = parts[parts.length - 1]!;
    if (isDir && isDepsFolder(name, true)) return 'défaut';
    return null;
  }
}

export interface ProjectFile {
  rel: string;
  size: number;
  mtime: number;
}

export interface ExcludedEntry {
  rel: string;
  dir: boolean;
  reason: ExclusionReason;
  files: number;
  bytes: number;
  /** Measured only partly (time ran out): « plus de ». */
  partial: boolean;
}

export interface ProjectWalk {
  files: ProjectFile[];
  excluded: ExcludedEntry[];
  bytes: number;
}

/** Time given to measure the excluded folders (all of them, per walk). */
const EXCLUDED_BUDGET_MS = 2000;

/**
 * The files a project SAVES (sorted), its excluded entries apart (a folder
 * excluded is not entered: nothing under it can come back, as with git).
 * Asynchronous: the server keeps answering. `measureExcluded`: tell their size.
 */
export async function walkProject(
  root: string,
  choices: ExclusionChoices = EMPTY_CHOICES,
  options: {
    signal?: AbortSignal;
    onFile?: (count: number, rel: string) => void;
    measureExcluded?: boolean;
  } = {},
): Promise<ProjectWalk> {
  const rules = new ProjectRules(root, choices);
  const out: ProjectWalk = { files: [], excluded: [], bytes: 0 };
  const budgetEnd = Date.now() + EXCLUDED_BUDGET_MS;
  const visit = async (abs: string, rel: string): Promise<void> => {
    const dir = await opendir(abs);
    const entries: { name: string; dir: boolean; file: boolean }[] = [];
    for await (const e of dir)
      entries.push({ name: e.name, dir: e.isDirectory(), file: e.isFile() });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (options.signal?.aborted) throw new Error('Annulée');
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(abs, e.name);
      if (!e.dir && !e.file) continue;
      if (e.file && isIgnoredFile(e.name)) continue;
      const reason = rules.reason(childRel, e.dir);
      if (reason) {
        const m = !options.measureExcluded
          ? { files: 0, bytes: 0, partial: true }
          : e.dir
            ? await measure(full, budgetEnd)
            : { files: 1, bytes: (await stat(full)).size, partial: false };
        out.excluded.push({ rel: childRel, dir: e.dir, reason, ...m });
        continue;
      }
      if (e.dir) {
        await visit(full, childRel);
        continue;
      }
      const s = await stat(full);
      out.files.push({ rel: childRel, size: s.size, mtime: Math.round(s.mtimeMs) });
      out.bytes += s.size;
      options.onFile?.(out.files.length, childRel);
    }
  };
  await visit(root, '');
  return out;
}
