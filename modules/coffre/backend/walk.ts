// v0.49.0: reading a folder WITHOUT blocking the server (asynchronous, the
// server keeps answering), the recreatable folders (node_modules, .venv,
// __pycache__… and, in a project, build, dist…) set aside BEFORE counting,
// fingerprinting or copying. Their size is still told, measured within a
// short time budget (« plus de 12 000 fichiers » beyond it).
import { createHash } from 'node:crypto';
import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import { extOf, kindOf, languageOfExt } from '../shared/kinds';
import { hashFile } from './library';

/** System and temporary files: never kept (listed in the preview). */
const SYSTEM_FILE =
  /^(thumbs\.db|desktop\.ini|\.ds_store|ehthumbs(_vista)?\.db|\.directory|icon\r)$/i;
const TEMP_FILE = /^(~\$.+|\.~lock\..*#|.+\.(tmp|temp|crdownload|part|partial|swp|swo)|.+~)$/i;
export const isIgnoredFile = (name: string) => SYSTEM_FILE.test(name) || TEMP_FILE.test(name);

/** Dependencies and build folders: unambiguous anywhere. */
const DEPS_ANYWHERE = new Set([
  'node_modules',
  '.venv',
  'venv',
  '.cache',
  '__pycache__',
  '.pio',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
  '.gradle',
  '.next',
  '.nuxt',
  '.parcel-cache',
  '.dart_tool',
]);
/** …and these only inside a code project (« build » can be a folder of Thomas's elsewhere). */
const DEPS_IN_PROJECT = new Set([
  'env',
  'build',
  'dist',
  'target',
  'bin',
  'obj',
  'out',
  'coverage',
  'cmake-build-debug',
  'cmake-build-release',
  'DerivedData',
  'Pods',
]);
export const isDepsFolder = (name: string, inProject: boolean) =>
  DEPS_ANYWHERE.has(name) || (inProject && DEPS_IN_PROJECT.has(name));

/** Files that say « this folder is a code project ». */
const MARKER_FILES = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'setup.cfg',
  'Pipfile',
  'Cargo.toml',
  'platformio.ini',
  'CMakeLists.txt',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
  'meson.build',
  'pubspec.yaml',
  'Makefile',
];
const MARKER_EXTS = ['.sln', '.csproj', '.vcxproj', '.uvprojx', '.ino', '.xcodeproj'];

/** Why a folder is a code project (its marker), or null. */
export function projectMarker(entries: readonly { name: string; dir: boolean }[]): string | null {
  const git = entries.find((e) => e.name === '.git');
  if (git) return '.git';
  for (const m of MARKER_FILES) if (entries.some((e) => !e.dir && e.name === m)) return m;
  for (const ext of MARKER_EXTS) {
    const hit = entries.find((e) => e.name.toLowerCase().endsWith(ext));
    if (hit) return hit.name;
  }
  // Mostly code files (at least 2, at least half of its own files).
  const files = entries.filter((e) => !e.dir && !isIgnoredFile(e.name));
  const code = files.filter((e) => languageOfExt(extOf(e.name)));
  if (code.length >= 2 && code.length * 2 >= files.length) return 'fichiers de code';
  return null;
}

/**
 * v0.50.0: a hidden folder (ADR 0067): a dot name (.git, .vscode, .idea…) or a
 * recreatable one. Hidden everywhere by default; .git is hidden but never excluded.
 */
export const isHiddenName = (name: string, inProject: boolean) =>
  name.startsWith('.') || isDepsFolder(name, inProject);

/** v0.50.0: « contient du code » reads better than the marker's internal name. */
export const projectReason = (marker: string) =>
  marker === 'fichiers de code' ? 'contient du code' : marker;

export interface WalkedFile {
  /** Relative to the folder read, with « / ». */
  rel: string;
  size: number;
}

export interface SetAside {
  rel: string;
  name: string;
  files: number;
  bytes: number;
  /** Counted only partly (the time budget ran out): « plus de ». */
  partial: boolean;
}

export interface Walked {
  files: WalkedFile[];
  bytes: number;
  /** Recreatable folders set aside (dependencies, builds). */
  setAside: SetAside[];
  /** System and temporary files never kept (Thumbs.db, ~$…). */
  ignored: string[];
}

/** Time given to measure the folders set aside (all of them, per walk). */
const SET_ASIDE_BUDGET_MS = 3000;

/**
 * The files of a folder, recreatable folders and system files set aside.
 * `inProject`: the folder is a code project (« build », « dist »… set aside
 * too). `onFile` is told every file (progress); `signal` stops it.
 */
export async function walkFolder(
  root: string,
  options: {
    inProject: boolean;
    keepSetAside?: boolean;
    onFile?: (count: number, rel: string) => void;
    signal?: AbortSignal;
    limit?: number;
  },
): Promise<Walked> {
  const out: Walked = { files: [], bytes: 0, setAside: [], ignored: [] };
  const budgetEnd = Date.now() + SET_ASIDE_BUDGET_MS;
  const visit = async (abs: string, rel: string): Promise<void> => {
    const dir = await opendir(abs);
    const entries: { name: string; dir: boolean; file: boolean }[] = [];
    for await (const e of dir)
      entries.push({ name: e.name, dir: e.isDirectory(), file: e.isFile() });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    for (const e of entries) {
      if (options.signal?.aborted) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(abs, e.name);
      if (e.dir) {
        if (!options.keepSetAside && isDepsFolder(e.name, options.inProject)) {
          out.setAside.push({ rel: childRel, name: e.name, ...(await measure(full, budgetEnd)) });
          continue;
        }
        await visit(full, childRel);
      } else if (e.file) {
        if (isIgnoredFile(e.name)) {
          out.ignored.push(childRel);
          continue;
        }
        const size = (await stat(full)).size;
        out.files.push({ rel: childRel, size });
        out.bytes += size;
        options.onFile?.(out.files.length, childRel);
        if (options.limit && out.files.length > options.limit) return;
      }
    }
  };
  await visit(root, '');
  return out;
}

/** Files and bytes of a folder set aside, within the time budget. */
export async function measure(
  folder: string,
  budgetEnd: number,
): Promise<{ files: number; bytes: number; partial: boolean }> {
  let files = 0;
  let bytes = 0;
  let partial = false;
  const go = async (abs: string): Promise<void> => {
    if (partial) return;
    const dir = await opendir(abs);
    for await (const e of dir) {
      if (Date.now() > budgetEnd) {
        partial = true;
        await dir.close().catch(() => undefined);
        return;
      }
      const full = path.join(abs, e.name);
      if (e.isDirectory()) await go(full);
      else if (e.isFile()) {
        files++;
        bytes += (await stat(full)).size;
      }
      if (partial) return;
    }
  };
  try {
    await go(folder);
  } catch {
    partial = true;
  }
  return { files, bytes, partial };
}

/**
 * A project's fingerprint over the files given (relative paths and
 * contents), its size and most frequent language — the same formula as
 * hashFolder (library.ts), over the files kept only.
 */
export async function hashFiles(
  root: string,
  files: readonly WalkedFile[],
  onFile?: (n: number, rel: string) => void,
  signal?: AbortSignal,
): Promise<{ sha256: string; size: number; files: number; language: string | null }> {
  const hash = createHash('sha256');
  const languages = new Map<string, number>();
  const DATA = new Set(['JSON', 'YAML', 'TOML', 'XML']);
  let size = 0;
  const sorted = [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  let n = 0;
  for (const f of sorted) {
    if (signal?.aborted) throw new Error('Annulée');
    size += f.size;
    hash.update(`${f.rel}\0${await hashFile(path.join(root, ...f.rel.split('/')))}\n`);
    const language = kindOf(f.rel)?.language;
    if (language)
      languages.set(language, (languages.get(language) ?? 0) + (DATA.has(language) ? 0.01 : 1));
    onFile?.(++n, f.rel);
  }
  const language = [...languages].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { sha256: hash.digest('hex'), size, files: sorted.length, language };
}
