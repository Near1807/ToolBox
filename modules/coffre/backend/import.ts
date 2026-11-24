// v0.48.0 (Expérimental): importing an existing arborescence (ADR 0065) —
// its sub-folders become contexts, its files go to the right place, a code
// project stays ONE element (its dependencies and build folders signalled,
// left out by default). Nothing is written before « Importer »: first a
// preview (the contexts to create under a route, files and size per folder,
// duplicates by fingerprint, ignored system / temporary files, merges with
// existing contexts). Then a COPY (the original never touched) — or, for a
// folder copied by hand into the Coffre, an ADOPTION (no copy, only the
// sheets) — in the background: progress, cancel, resumed after a restart
// (its state is kept in coffre__imports, on this PC only). Every element
// imported is « à compléter »; ONE « Annuler » undoes the import.
import { copyFile, cp, mkdir, rename, rm } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { HttpError, newId, requestBody, type ModuleContext, type SyncStore } from '@hub/sdk/core';
import { fold } from '../shared/deduce';
import { extOf, languageOfExt } from '../shared/kinds';
import {
  ARRIVAL_FOLDER,
  DISK_SYSTEM_FOLDER,
  folderName,
  invalidName,
  safeName,
  TRASH_FOLDER,
} from '../shared/names';
import type {
  AttributeDto,
  FoundFolderDto,
  ImportNodeDto,
  ImportPreviewDto,
  ImportStatusDto,
  ItemDto,
  ProposalDto,
} from '../shared/types';
import { hashFile, hashFolder, type Library } from './library';
import type { ContextRow, ItemRow } from './rows';

/** Migration 7: the imports of this PC (one line per import, its plan and progress). */
export const IMPORTS_MIGRATION_SQL = (t: string) => `
  CREATE TABLE ${t} (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL,
    mode TEXT NOT NULL,
    state TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    bytes_done INTEGER NOT NULL DEFAULT 0,
    bytes_total INTEGER NOT NULL DEFAULT 0,
    created_json TEXT NOT NULL DEFAULT '[]',
    error TEXT
  );
`;

// --- What a folder holds (pure but for reading the folder) -----------------------------

/** System and temporary files: never imported (listed in the preview). */
const SYSTEM_FILE =
  /^(thumbs\.db|desktop\.ini|\.ds_store|ehthumbs(_vista)?\.db|\.directory|icon\r)$/i;
const TEMP_FILE = /^(~\$.+|\.~lock\..*#|.+\.(tmp|temp|crdownload|part|partial|swp|swo)|.+~)$/i;
export const isIgnoredFile = (name: string) => SYSTEM_FILE.test(name) || TEMP_FILE.test(name);

/** Dependencies and build folders: unambiguous anywhere. */
const DEPS_ANYWHERE = new Set([
  'node_modules',
  '.venv',
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
/** …and these only inside a code project (« build » can be a context elsewhere). */
const DEPS_IN_PROJECT = new Set([
  'venv',
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

interface ScanFile {
  rel: string;
  name: string;
  size: number;
}
interface ScanNode {
  rel: string;
  name: string;
  marker: string | null;
  files: ScanFile[];
  children: ScanNode[];
  deps: { rel: string; name: string; files: number; bytes: number }[];
  ignored: string[];
  /** A project: all its files (its deps apart). */
  projectFiles: number;
  projectBytes: number;
}

/** At most this many files read in one import (a larger tree: in parts). */
export const MAX_IMPORT_FILES = 60_000;

function countFiles(dir: string, limit: { left: number }): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        files++;
        bytes += statSync(full).size;
        if (--limit.left < 0)
          throw new HttpError(413, 'Arborescence trop grande pour un seul import');
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

/** Reads a folder: its sub-folders, projects, dependencies, ignored files. Writes nothing. */
export function scanTree(root: string): ScanNode {
  const limit = { left: MAX_IMPORT_FILES };
  const read = (abs: string, rel: string, name: string, inProject: boolean): ScanNode => {
    const entries = readdirSync(abs, { withFileTypes: true }).filter((e) => !e.isSymbolicLink());
    const marker = projectMarker(entries.map((e) => ({ name: e.name, dir: e.isDirectory() })));
    const project = inProject || marker !== null;
    const node: ScanNode = {
      rel,
      name,
      marker,
      files: [],
      children: [],
      deps: [],
      ignored: [],
      projectFiles: 0,
      projectBytes: 0,
    };
    const sorted = [...entries].sort((x, y) => x.name.localeCompare(y.name, 'fr'));
    for (const e of sorted) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (isDepsFolder(e.name, project))
          node.deps.push({ rel: childRel, name: e.name, ...countFiles(full, limit) });
        else node.children.push(read(full, childRel, e.name, project));
      } else if (e.isFile()) {
        if (isIgnoredFile(e.name)) {
          node.ignored.push(childRel);
          continue;
        }
        if (--limit.left < 0)
          throw new HttpError(413, 'Arborescence trop grande pour un seul import');
        node.files.push({ rel: childRel, name: e.name, size: statSync(full).size });
      }
    }
    // Its whole content (its dependencies apart): what ONE project element holds.
    node.projectFiles =
      node.files.length + node.children.reduce((sum, c) => sum + c.projectFiles, 0);
    node.projectBytes =
      node.files.reduce((sum, f) => sum + f.size, 0) +
      node.children.reduce((sum, c) => sum + c.projectBytes, 0);
    return node;
  };
  return read(root, '', path.basename(root), false);
}

/** A node's dependencies, its sub-folders' included. */
export const allDeps = (n: ScanNode): ScanNode['deps'] => [
  ...n.deps,
  ...n.children.flatMap(allDeps),
];

// --- The plan: what « Importer » will do -------------------------------------------------

/** A folder's name as a context: itself, or made valid (too long, a character Windows refuses). */
export const contextNameOf = (name: string) => (invalidName(name) ? folderName(name) : name.trim());

/** Thomas's choices in the preview. */
export interface ImportChoices {
  /** Detected projects to import as folders of contexts instead. */
  asFolder: string[];
  /** Folders to import as ONE project element instead. */
  asProject: string[];
  /** Dependencies / build folders to include anyway (left out by default). */
  deps: string[];
  /** Import the duplicates anyway (default: left aside). */
  keepDuplicates: boolean;
}

export type PlanOp =
  | { t: 'ctx'; path: string[] }
  | { t: 'file'; src: string; dest: string[]; name: string; size: number }
  | { t: 'project'; src: string; dest: string[]; name: string; size: number; exclude: string[] };

/** The operations, in order: each folder's context, then its files and projects. */
export function buildPlan(
  root: string,
  scan: ScanNode,
  route: readonly string[],
  choices: ImportChoices,
  skip: ReadonlySet<string> = new Set(),
): PlanOp[] {
  const ops: PlanOp[] = [];
  const asProject = (n: ScanNode) =>
    (n.marker !== null && !choices.asFolder.includes(n.rel)) || choices.asProject.includes(n.rel);
  const visit = (n: ScanNode, parent: string[]) => {
    const abs = n.rel ? path.join(root, ...n.rel.split('/')) : root;
    if (asProject(n)) {
      const deps = allDeps(n);
      // Absolute paths (the plan is kept: a restart copies the same).
      const exclude = deps
        .filter((d) => !choices.deps.includes(d.rel))
        .map((d) => path.join(root, ...d.rel.split('/')));
      const kept = deps.filter((d) => choices.deps.includes(d.rel));
      ops.push({
        t: 'project',
        src: abs,
        dest: parent,
        name: n.name,
        size: n.projectBytes + kept.reduce((s, d) => s + d.bytes, 0),
        exclude,
      });
      return;
    }
    const here = [...parent, contextNameOf(n.name)];
    ops.push({ t: 'ctx', path: here });
    for (const f of n.files) {
      if (skip.has(f.rel)) continue;
      ops.push({
        t: 'file',
        src: path.join(root, ...f.rel.split('/')),
        dest: here,
        name: f.name,
        size: f.size,
      });
    }
    for (const c of n.children) visit(c, here);
  };
  visit(scan, [...route]);
  return ops;
}

// --- The import itself ---------------------------------------------------------------------

export interface ImportDeps {
  ctx: ModuleContext;
  store: SyncStore;
  library: Library;
  t: { items: string; imports: string };
  contextRows: () => ContextRow[];
  pathOf: (byId: Map<string, ContextRow>, id: string | null) => string[];
  folderOf: (contextId: string) => string;
  /** The context of a route (created when missing). */
  ensureContext: (names: string[]) => string;
  /** The Coffre's proposal for a file (its fingerprint and attributes « deviné »). */
  propose: (abs: string) => Promise<ProposalDto>;
  duplicateOf: (
    sha: string | null,
  ) => { id: string; name: string; contextPath: string[] | null } | null;
  writeAttributes: (itemId: string, list: AttributeDto[]) => void;
  remember: (run: () => Promise<void>) => string;
  removeIfEmpty: (ids: readonly string[]) => Promise<void>;
  dtos: (rows: ItemRow[]) => ItemDto[];
  /** New elements: the search reads their text. */
  kick: () => void;
  busy: () => string | null;
}

interface ImportRow {
  id: string;
  created_at: string;
  updated_at: string;
  source: string;
  mode: 'copy' | 'adopt';
  state: 'running' | 'done' | 'cancelled' | 'failed' | 'undone';
  plan_json: string;
  done: number;
  total: number;
  bytes_done: number;
  bytes_total: number;
  created_json: string;
  error: string | null;
}

interface Created {
  items: string[];
  contexts: string[];
  /** Files written by the import (removed by « Annuler »; never in an adoption). */
  files: string[];
}

const TEMP_PREFIX = '.~import-';

export function createImporter(d: ImportDeps) {
  const { ctx, store, library, t } = d;
  const jobs = new Map<string, string>();
  const undos = new Map<string, string>();

  const row = (id: string) => {
    const r = ctx.db.prepare(`SELECT * FROM ${t.imports} WHERE id = ?`).get(id) as
      ImportRow | undefined;
    if (!r) throw new HttpError(404, 'Import introuvable');
    return r;
  };
  const save = (id: string, fields: Partial<ImportRow>) => {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    ctx.db
      .prepare(
        `UPDATE ${t.imports} SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      )
      .run(
        ...keys.map((k) => (fields as Record<string, unknown>)[k]),
        new Date().toISOString(),
        id,
      );
  };

  /** The route of a context folder (« Cours/Thermo » → ["Cours", "Thermo"]), or null. */
  const routeOfFolder = (rel: string): string[] | null => {
    if (!rel) return [];
    const rows = d.contextRows();
    const byId = new Map(rows.map((c) => [c.id, c]));
    const c = rows.find((x) => d.folderOf(x.id).toLowerCase() === rel.toLowerCase());
    return c ? d.pathOf(byId, c.id) : null;
  };

  /** The preview: nothing is written. `adopt`: a folder already in the Coffre. */
  async function preview(
    source: string,
    route: string[],
    adopt: boolean,
  ): Promise<ImportPreviewDto> {
    if (!path.isAbsolute(source) || !existsSync(source) || !statSync(source).isDirectory())
      throw new HttpError(404, `Dossier introuvable : ${source}`);
    const inside = library.relOf(source);
    if (!adopt && inside !== null)
      throw new HttpError(409, 'Ce dossier est déjà dans le Coffre : adopte-le plutôt');
    if (adopt) {
      if (inside === null) throw new HttpError(409, 'Seul un dossier du Coffre peut être adopté');
      const parent = routeOfFolder(
        path.posix.dirname(inside) === '.' ? '' : path.posix.dirname(inside),
      );
      if (parent === null) throw new HttpError(409, 'Son dossier parent n’est pas un contexte');
      route = parent;
    }
    const scan = scanTree(source);
    // The duplicates: only the files whose size is already known are read (fast).
    const sizes = new Set(
      (
        ctx.db
          .prepare(`SELECT size FROM ${t.items} WHERE deleted_at IS NULL AND kind = 'file'`)
          .all() as { size: number }[]
      ).map((r) => r.size),
    );
    const all: ScanFile[] = [];
    const walk = (n: ScanNode) => {
      if (n.marker !== null) return; // a project: one element, no duplicates per file
      all.push(...n.files);
      n.children.forEach(walk);
    };
    walk(scan);
    const inImport = new Map<number, number>();
    for (const f of all) inImport.set(f.size, (inImport.get(f.size) ?? 0) + 1);
    const seen = new Map<string, string>();
    const duplicates: ImportPreviewDto['duplicates'] = [];
    for (const f of all) {
      if (!sizes.has(f.size) && (inImport.get(f.size) ?? 0) < 2) continue;
      const sha = await hashFile(path.join(source, ...f.rel.split('/')));
      const existing = adopt ? null : d.duplicateOf(sha);
      const twin = seen.get(sha) ?? null;
      if (!twin) seen.set(sha, f.rel);
      if (existing || twin) duplicates.push({ rel: f.rel, existing, twinOf: twin });
    }
    // The contexts that already exist (merged).
    const known = new Set(
      (() => {
        const rows = d.contextRows();
        const byId = new Map(rows.map((c) => [c.id, c]));
        return rows.map((c) => d.pathOf(byId, c.id).map(fold).join('\u0000'));
      })(),
    );
    const merges: string[][] = [];
    const totals = {
      folders: 0,
      files: 0,
      bytes: 0,
      projects: 0,
      ignored: 0,
      duplicates: duplicates.length,
      depsFiles: 0,
      depsBytes: 0,
    };
    /** `counted`: false inside a project (its files are counted once, with it). */
    const dto = (n: ScanNode, parent: string[], counted = true): ImportNodeDto => {
      const here = [...parent, contextNameOf(n.name)];
      const exists = known.has(here.map(fold).join('\u0000'));
      const project = n.marker !== null;
      if (counted && exists && !project) merges.push(here);
      const deps = project ? allDeps(n) : n.deps;
      if (counted) {
        totals.ignored += n.ignored.length;
        for (const dp of deps) {
          totals.depsFiles += dp.files;
          totals.depsBytes += dp.bytes;
        }
        if (project) totals.projects++;
        else totals.folders++;
      }
      const children = n.children.map((c) => dto(c, here, counted && !project));
      const files = project ? n.projectFiles : n.files.length;
      const bytes = project ? n.projectBytes : n.files.reduce((sum, f) => sum + f.size, 0);
      if (counted) {
        totals.files += files;
        totals.bytes += bytes;
      }
      return {
        rel: n.rel,
        name: n.name,
        marker: n.marker,
        files,
        bytes,
        totalFiles: project ? files : files + children.reduce((sum, c) => sum + c.totalFiles, 0),
        totalBytes: project ? bytes : bytes + children.reduce((sum, c) => sum + c.totalBytes, 0),
        deps,
        exists,
        children,
        invalidName:
          contextNameOf(n.name) !== n.name.trim()
            ? `« ${n.name} » deviendra « ${contextNameOf(n.name)} »`
            : null,
      };
    };
    const tree = dto(scan, route);
    return {
      source,
      mode: adopt ? 'adopt' : 'copy',
      route,
      tree,
      totals,
      duplicates: duplicates.slice(0, 500),
      ignored: [scan.ignored, ...collectIgnored(scan)].flat().slice(0, 300),
      merges,
    };
  }

  /** « Importer »: the plan saved, then run in the background. */
  async function start(
    source: string,
    route: string[],
    choices: ImportChoices,
    adopt: boolean,
  ): Promise<string> {
    const b = d.busy();
    if (b) throw new HttpError(409, `Le disque est occupé (${b}) : réessaie après`);
    const p = await preview(source, route, adopt);
    const skip = new Set(choices.keepDuplicates || adopt ? [] : p.duplicates.map((x) => x.rel));
    const plan = buildPlan(source, scanTree(source), p.route, choices, skip);
    const id = newId();
    const now = new Date().toISOString();
    ctx.db
      .prepare(
        `INSERT INTO ${t.imports} (id, created_at, updated_at, source, mode, state, plan_json, done, total, bytes_done, bytes_total, created_json, error)
         VALUES (?, ?, ?, ?, ?, 'running', ?, 0, ?, 0, ?, '{"items":[],"contexts":[],"files":[]}', NULL)`,
      )
      .run(
        id,
        now,
        now,
        source,
        adopt ? 'adopt' : 'copy',
        JSON.stringify(plan),
        plan.length,
        plan.reduce((s, o) => s + (o.t === 'ctx' ? 0 : o.size), 0),
      );
    launch(id);
    return id;
  }

  function launch(id: string) {
    const r = row(id);
    const job = ctx.jobs.enqueue(
      'tree-import',
      { importId: id },
      {
        title: `Coffre : import de « ${path.basename(r.source)} »`,
      },
    );
    jobs.set(id, job.id);
  }

  /** The job: from the first operation not done (a restart resumes there). */
  async function run(
    id: string,
    signal: AbortSignal,
    progress: (f: number | null, m?: string) => void,
  ) {
    const r = row(id);
    const plan = JSON.parse(r.plan_json) as PlanOp[];
    const created = JSON.parse(r.created_json) as Created;
    let { done, bytes_done: bytesDone } = r;
    const adopt = r.mode === 'adopt';
    for (; done < plan.length; done++) {
      if (signal.aborted) return;
      const op = plan[done]!;
      if (op.t === 'ctx') {
        const before = new Set(d.contextRows().map((c) => c.id));
        const cid = d.ensureContext(op.path);
        if (!before.has(cid)) created.contexts.push(cid);
      } else {
        const cid = op.dest.length ? d.ensureContext(op.dest) : null;
        const dir = cid ? d.folderOf(cid) : ARRIVAL_FOLDER;
        const itemId = adopt
          ? await adoptOne(op, dir, cid)
          : await copyOne(id, done, op, dir, cid, created);
        if (itemId) created.items.push(itemId);
        bytesDone += op.size;
      }
      // The progress and what was made, together (a restart resumes after it).
      save(id, { done: done + 1, bytes_done: bytesDone, created_json: JSON.stringify(created) });
      progress(
        r.bytes_total ? bytesDone / r.bytes_total : (done + 1) / plan.length,
        `${done + 1} / ${plan.length}`,
      );
      if (done % 20 === 0) await new Promise((res) => setImmediate(res));
      // The tests slow it down to stop it in the middle (a restart).
      const pause = Number(process.env.TOOLBOX_COFFRE_IMPORT_PAUSE_MS ?? 0);
      if (pause) await new Promise((res) => setTimeout(res, pause));
    }
    save(id, { state: 'done' });
    d.kick();
    const undoId = d.remember(async () => undo(id));
    undos.set(id, undoId);
  }

  /** One file copied (under a temporary name, read back, then put in place) and its sheet. */
  async function copyOne(
    id: string,
    n: number,
    op: Exclude<PlanOp, { t: 'ctx' }>,
    dir: string,
    cid: string | null,
    created: Created,
  ): Promise<string | null> {
    const dirAbs = library.abs(dir);
    await mkdir(dirAbs, { recursive: true });
    const tmp = path.join(dirAbs, `${TEMP_PREFIX}${id}-${n}`);
    await rm(tmp, { recursive: true, force: true }); // a copy left by a restart
    const name = safeName(op.name);
    // Resumed after a restart: the file already put in place, its sheet not written.
    if (op.t === 'file') {
      const sha = await hashFile(op.src);
      const placed = path.join(dirAbs, name);
      if (
        existsSync(placed) &&
        !itemAt(toRel(path.relative(library.root, placed))) &&
        (await hashFile(placed)) === sha
      )
        return writeItem(op, toRel(path.relative(library.root, placed)), sha, cid, false);
      await copyFile(op.src, tmp);
      if ((await hashFile(tmp)) !== sha) {
        await rm(tmp, { force: true });
        throw new Error(`Copie incomplète de « ${op.name} »`);
      }
      const free = library.freeIn(dirAbs, name);
      await rename(tmp, path.join(dirAbs, free));
      const rel = toRel(path.relative(library.root, path.join(dirAbs, free)));
      created.files.push(rel);
      return writeItem(op, rel, sha, cid, false);
    }
    const exclude = new Set(op.exclude.map((e) => path.resolve(e).toLowerCase()));
    await cp(op.src, tmp, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (src) => {
        const s = path.resolve(src).toLowerCase();
        for (const e of exclude) if (s === e || s.startsWith(e + path.sep)) return false;
        return !isIgnoredFile(path.basename(src)) || src === op.src;
      },
    });
    const free = library.freeIn(dirAbs, name);
    await rename(tmp, path.join(dirAbs, free));
    const rel = toRel(path.relative(library.root, path.join(dirAbs, free)));
    created.files.push(rel);
    const h = await hashFolder(library.abs(rel));
    return writeItem(op, rel, h.sha256, cid, true, h.size);
  }

  /** A file or folder already in the Coffre: only its sheet (never moved, never copied). */
  async function adoptOne(
    op: Exclude<PlanOp, { t: 'ctx' }>,
    dir: string,
    cid: string | null,
  ): Promise<string | null> {
    const rel = `${dir}/${op.name}`;
    if (itemAt(rel)) return null;
    if (!library.exists(rel)) return null;
    if (op.t === 'file') return writeItem(op, rel, await hashFile(library.abs(rel)), cid, false);
    const h = await hashFolder(library.abs(rel));
    return writeItem(op, rel, h.sha256, cid, true, h.size);
  }

  const itemAt = (rel: string) =>
    ctx.db
      .prepare(`SELECT id FROM ${t.items} WHERE deleted_at IS NULL AND rel_path = ? COLLATE NOCASE`)
      .get(rel) as { id: string } | undefined;

  async function writeItem(
    op: Exclude<PlanOp, { t: 'ctx' }>,
    rel: string,
    sha: string,
    cid: string | null,
    project: boolean,
    size = op.size,
  ): Promise<string> {
    let attributes: AttributeDto[] = [];
    try {
      attributes = (await d.propose(library.abs(rel))).attributes;
    } catch (error) {
      ctx.logger.warn(`Import : déductions de « ${op.name} » : ${String(error)}`);
    }
    const st = statSync(op.src);
    return ctx.db.transaction(() => {
      const made = store.create<ItemRow & { updated_at: string }>('items', {
        kind: project ? 'project' : 'file',
        name: path.posix.basename(rel),
        rel_path: rel,
        external_path: null,
        size,
        sha256: sha,
        ext: project ? '' : extOf(op.name),
        context_id: cid,
        arrival: cid ? 0 : 1,
        pinned: 0,
        trashed_at: null,
        trash_from: null,
        source_path: op.src,
        source_url: null,
        referrer_url: null,
        file_date: st.mtime.toISOString(),
        original_name: op.name,
        to_complete: 1,
      });
      d.writeAttributes(made.id, attributes);
      return made.id;
    });
  }

  /** « Annuler » (or a cancel): the elements and contexts made, the files COPIED by it. */
  async function undo(id: string) {
    const r = row(id);
    const created = JSON.parse(r.created_json) as Created;
    for (const itemId of [...created.items].reverse()) {
      const it = store.get<ItemRow & { updated_at: string }>('items', itemId) as ItemRow | null;
      if (it && !it.deleted_at) store.remove('items', itemId);
    }
    if (r.mode === 'copy')
      for (const rel of [...created.files].reverse())
        await library.erase(rel).catch(() => undefined);
    await d.removeIfEmpty(created.contexts);
    save(id, { state: 'undone' });
  }

  function status(id: string): ImportStatusDto {
    const r = row(id);
    const jobId = jobs.get(id) ?? null;
    const job = jobId ? ctx.jobs.get(jobId) : null;
    const created = JSON.parse(r.created_json) as Created;
    return {
      id: r.id,
      source: r.source,
      mode: r.mode,
      state: r.state,
      done: r.done,
      total: r.total,
      bytesDone: r.bytes_done,
      bytesTotal: r.bytes_total,
      items: created.items.length,
      contexts: created.contexts.length,
      error: r.error ?? job?.error ?? null,
      undoId: undos.get(id) ?? null,
      jobId,
      createdAt: r.created_at,
    };
  }

  /** Folders put in the Coffre by hand (not contexts, not elements): proposed, never adopted alone. */
  function found(): FoundFolderDto[] {
    const out: FoundFolderDto[] = [];
    if (!existsSync(library.root)) return out;
    const rows = d.contextRows();
    const byId = new Map(rows.map((c) => [c.id, c]));
    const contextFolders = new Map(rows.map((c) => [d.folderOf(c.id).toLowerCase(), c.id]));
    const itemPaths = new Set(
      (
        ctx.db
          .prepare(
            `SELECT rel_path FROM ${t.items} WHERE deleted_at IS NULL AND rel_path IS NOT NULL`,
          )
          .all() as { rel_path: string }[]
      ).map((r) => r.rel_path.toLowerCase()),
    );
    const reserved = new Set(
      [ARRIVAL_FOLDER, TRASH_FOLDER, DISK_SYSTEM_FOLDER].map((x) => x.toLowerCase()),
    );
    const look = (rel: string, depth: number) => {
      const abs = rel ? library.abs(rel) : library.root;
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith(TEMP_PREFIX) || e.name.startsWith('.')) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        const key = childRel.toLowerCase();
        if (!rel && reserved.has(key)) continue;
        if (itemPaths.has(key)) continue;
        if (contextFolders.has(key)) {
          if (depth < 12) look(childRel, depth + 1);
          continue;
        }
        let c: { files: number; bytes: number };
        try {
          c = countFiles(library.abs(childRel), { left: MAX_IMPORT_FILES });
        } catch {
          c = { files: MAX_IMPORT_FILES, bytes: 0 };
        }
        const parentId = rel ? contextFolders.get(rel.toLowerCase()) : undefined;
        out.push({
          rel: childRel,
          name: e.name,
          files: c.files,
          bytes: c.bytes,
          route: parentId ? d.pathOf(byId, parentId) : [],
          path: library.abs(childRel),
        });
      }
    };
    look('', 0);
    return out;
  }

  return { preview, start, run, undo, status, found, launch, row, save, jobs };
}

function collectIgnored(n: ScanNode): string[][] {
  return n.children.flatMap((c) => [c.ignored, ...collectIgnored(c)]);
}

const toRel = (p: string) => p.split(path.sep).join('/');

/** The routes (/import/*) and the job. */
export function registerImport(d: ImportDeps) {
  const imp = createImporter(d);
  const { ctx } = d;
  ctx.jobs.define<{ importId: string }, { items: number }>('tree-import', async (job) => {
    const id = job.input.importId;
    try {
      await imp.run(id, job.signal, (f, m) => job.progress(f, m));
    } catch (error) {
      imp.save(id, {
        state: 'failed',
        error: String(error instanceof Error ? error.message : error),
      });
      throw error;
    }
    if (job.signal.aborted) {
      // Cancelled by Thomas (not by a shutdown: then it is resumed at the next start).
      if (imp.row(id).state === 'running' && cancelling.has(id)) {
        cancelling.delete(id);
        await imp.undo(id);
        imp.save(id, { state: 'cancelled' });
      }
      return { items: 0 };
    }
    return { items: imp.status(id).items };
  });
  const cancelling = new Set<string>();

  const routeOf = (b: Record<string, unknown>): string[] => {
    if (Array.isArray(b.newContext)) return b.newContext.map(String).filter(Boolean);
    if (typeof b.contextId === 'string' && b.contextId) {
      const rows = d.contextRows();
      const byId = new Map(rows.map((c) => [c.id, c]));
      if (!byId.has(b.contextId)) throw new HttpError(404, 'Contexte introuvable');
      return d.pathOf(byId, b.contextId);
    }
    return [];
  };
  const choicesOf = (b: Record<string, unknown>): ImportChoices => ({
    asFolder: Array.isArray(b.asFolder) ? b.asFolder.map(String) : [],
    asProject: Array.isArray(b.asProject) ? b.asProject.map(String) : [],
    deps: Array.isArray(b.deps) ? b.deps.map(String) : [],
    keepDuplicates: b.keepDuplicates === true,
  });

  ctx.routes.post('/import/preview', async (request) => {
    const b = requestBody(request);
    return imp.preview(String(b.source ?? ''), routeOf(b), b.adopt === true);
  });
  ctx.routes.post('/import/start', async (request) => {
    const b = requestBody(request);
    const id = await imp.start(String(b.source ?? ''), routeOf(b), choicesOf(b), b.adopt === true);
    return imp.status(id);
  });
  ctx.routes.get('/import/list', () =>
    (
      ctx.db.prepare(`SELECT id FROM ${d.t.imports} ORDER BY created_at DESC LIMIT 10`).all() as {
        id: string;
      }[]
    ).map((r) => imp.status(r.id)),
  );
  ctx.routes.get('/import/found', () => imp.found());
  ctx.routes.get('/import/:id', (request) =>
    imp.status(String((request.params as { id: string }).id)),
  );
  ctx.routes.post('/import/:id/cancel', (request) => {
    const id = String((request.params as { id: string }).id);
    const st = imp.status(id);
    if (st.state !== 'running' || !st.jobId) throw new HttpError(409, 'Cet import ne tourne pas');
    cancelling.add(id);
    ctx.jobs.cancel(st.jobId);
    return { ok: true };
  });

  /** At the start: the imports that were running are resumed where they stopped. */
  const resume = () => {
    const rows = ctx.db.prepare(`SELECT id FROM ${d.t.imports} WHERE state = 'running'`).all() as {
      id: string;
    }[];
    for (const r of rows) {
      ctx.logger.info(`Import ${r.id} repris là où il s’était arrêté`);
      imp.launch(r.id);
    }
  };
  return { imp, resume };
}
