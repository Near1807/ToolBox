// v0.49.0, v0.50.0: depositing as BACKGROUND TASKS (MODULES.md §5.5 bis) — the
// request answers at once with a task; the panel follows it (« 12 / 7 000
// fichiers », the file in progress, the time left, Annuler).
// Analysis: the folders are read asynchronously, the recreatable folders set
// aside BEFORE counting; beyond a threshold the task stops and asks first.
// v0.50.0 (ADR 0067): a dropped FOLDER arrives as it is, with its whole tree,
// at the route chosen — never cut up; its sub-folders that look like code
// projects get the « Projet » badge PROPOSED (the window shows and changes it).
// Rangement: one file after the other; one that fails stays where it was and
// is listed with its reason (« Réessayer ceux-là »), the others go on; nothing
// is half written (a temporary name, read back, then put in place). The
// original is never touched: its path and fingerprint are kept (v0.52).
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  HttpError,
  requestBody,
  type JobRunContext,
  type ModuleContext,
  type SyncStore,
} from '@hub/sdk/core';
import { fold } from '../shared/deduce';
import { extOf } from '../shared/kinds';
import { folderName, safeName } from '../shared/names';
import type { ItemDto, LabelDto, ProjectHintDto, ProposalDto, SetAsideDto } from '../shared/types';
import { hashFile, type Library } from './library';
import type { FolderRow, ItemRow } from './rows';
import {
  hashFiles,
  isHiddenName,
  projectMarker,
  projectReason,
  walkFolder,
  type Walked,
  type WalkedFile,
} from './walk';

/** Beyond this (after setting aside), the analysis asks before going on. */
export const WARN_FILES = () => Number(process.env.TOOLBOX_COFFRE_WARN_FILES ?? 20_000);
export const WARN_BYTES = 20 * 1024 ** 3;
/** A folder's files are fingerprinted in the analysis (its duplicates) only up to this. */
const ANALYZE_HASH_BYTES = 2 * 1024 ** 3;
const TEMP_PREFIX = '.~depot-';

export interface DepositEntryInput {
  path: string;
  name?: string;
  /** « Ranger plus tard »: À ranger (a file only). */
  later?: boolean;
  folderId?: string | null;
  /** A route created now (« Cours/Thermo »). */
  newFolder?: string[] | null;
  /** A file: its labels (as the window shows them). A folder: added to each of its files. */
  labels?: LabelDto[];
  keepDuplicate?: boolean;
  /** A folder: the sub-folders (« » = itself) marked « Projet » (the highest only counts). */
  projects?: string[];
}

export interface AnalyzeResult {
  proposals: ProposalDto[];
  /** Beyond the threshold: nothing analysed yet; « Continuer » (confirmed) or choose. */
  needsConfirm: { files: number; bytes: number; setAside: SetAsideDto[] } | null;
  setAside: SetAsideDto[];
  ignored: number;
}

export interface ApplyResult {
  created: ItemDto[];
  skipped: {
    path: string;
    duplicate: { id: string; name: string; folderPath: string[] | null };
  }[];
  undoId: string | null;
  failed: number;
}

export interface DepositDeps {
  ctx: ModuleContext;
  store: SyncStore;
  library: Library;
  folderRows: () => FolderRow[];
  ensureFolder: (names: string[], parentId: string | null) => string;
  folderOf: (folderId: string | null) => string;
  /** The Coffre's route and labels for a path (a folder: what applies to all its files). */
  propose: (abs: string, folderId: string | null) => Pick<ProposalDto, 'route' | 'labels'>;
  /** The labels proposed for one file put in that folder (its defaults first). */
  proposeLabels: (
    name: string,
    fileDate: string | null,
    provenance: ReturnType<ModuleContext['files']['provenance']>,
    folderId: string | null,
  ) => LabelDto[];
  duplicateOf: (sha: string | null) => {
    id: string;
    name: string;
    folderPath: string[] | null;
  } | null;
  writeLabels: (itemId: string, list: LabelDto[]) => void;
  learnFrom: (row: ItemRow, folderId: string | null) => void;
  remember: (run: () => Promise<void>) => string;
  removeIfEmpty: (ids: readonly string[]) => Promise<void>;
  dtos: (rows: ItemRow[]) => ItemDto[];
  getRow: (id: string) => ItemRow;
  /** A file already has this path in the Coffre (a copy left without a row does not). */
  hasItemAt: (rel: string) => boolean;
  /** After a deposit: the search reads the new texts; downloads put away are no longer proposed. */
  after: (paths: string[], created: number) => void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The sub-folders of a walked folder that look like code projects (« » = itself). */
export function projectHints(files: readonly WalkedFile[]): ProjectHintDto[] {
  const dirs = new Map<string, { name: string; dir: boolean }[]>();
  const add = (dir: string, entry: { name: string; dir: boolean }) => {
    const list = dirs.get(dir) ?? [];
    if (!list.some((e) => e.name === entry.name)) list.push(entry);
    dirs.set(dir, list);
  };
  for (const f of files) {
    const parts = f.rel.split('/');
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      add(dir, { name: parts[i]!, dir: i < parts.length - 1 });
    }
  }
  const out: ProjectHintDto[] = [];
  for (const [dir, entries] of [...dirs].sort((a, b) => a[0].length - b[0].length)) {
    // Never inside a hidden folder (.git, node_modules…).
    if (dir.split('/').some((s) => s && isHiddenName(s, false))) continue;
    const marker = projectMarker(entries);
    if (!marker) continue;
    const nested = out.some((h) => h.rel === '' || dir.startsWith(`${h.rel}/`));
    out.push({ rel: dir, reason: projectReason(marker), nested });
  }
  return out;
}

/** The highest marked project above (or at) a relative path, or null. */
const projectOf = (rel: string, projects: readonly string[]): string | null =>
  [...projects]
    .sort((a, b) => a.length - b.length)
    .find((p) => p === '' || rel === p || rel.startsWith(`${p}/`)) ?? null;

export function registerDeposit(d: DepositDeps) {
  const { ctx, store, library } = d;

  // --- Analysis --------------------------------------------------------------------------

  ctx.jobs.define<{ paths: string[]; folderId: string | null; confirmed?: boolean }, AnalyzeResult>(
    'deposit-analyze',
    async (job) => {
      const { paths } = job.input;
      const setAside: SetAsideDto[] = [];
      let ignored = 0;
      // 1. What there is (folders read without blocking, recreatable ones set aside).
      const targets: { abs: string; walked?: Walked }[] = [];
      let files = 0;
      let bytes = 0;
      job.step(0, null, { unit: 'fichiers comptés', current: null });
      for (const p of paths) {
        if (job.signal.aborted) break;
        if (!path.isAbsolute(p) || !existsSync(p)) {
          job.problem(p, 'introuvable (déplacé ou supprimé ?)');
          continue;
        }
        const st = statSync(p);
        if (!st.isDirectory()) {
          targets.push({ abs: p });
          files++;
          bytes += st.size;
          continue;
        }
        const walked = await walkFolder(p, {
          inProject: true,
          signal: job.signal,
          onFile: (n, rel) => {
            if (n % 200 === 0)
              job.step(files + n, null, { unit: 'fichiers comptés', current: rel });
          },
        });
        setAside.push(
          ...walked.setAside.map((s) => ({ ...s, rel: `${path.basename(p)}/${s.rel}` })),
        );
        ignored += walked.ignored.length;
        files += walked.files.length;
        bytes += walked.bytes;
        targets.push({ abs: p, walked });
      }
      if (job.signal.aborted) return { proposals: [], needsConfirm: null, setAside, ignored };
      // 2. Beyond the threshold: asked first.
      if (!job.input.confirmed && (files > WARN_FILES() || bytes > WARN_BYTES))
        return { proposals: [], needsConfirm: { files, bytes, setAside }, setAside, ignored };
      // 3. The proposals (fingerprints read now), one by one.
      const proposals: ProposalDto[] = [];
      let n = 0;
      for (const t of targets) {
        if (job.signal.aborted) break;
        const name = path.basename(t.abs);
        job.step(n, targets.length, { unit: 'éléments analysés', current: name });
        try {
          const proposed = d.propose(t.abs, job.input.folderId);
          if (!t.walked) {
            const st = statSync(t.abs);
            const sha256 = await hashFile(t.abs);
            proposals.push({
              path: t.abs,
              name,
              isDirectory: false,
              fileCount: 1,
              folderCount: 0,
              size: st.size,
              sha256,
              duplicate: d.duplicateOf(sha256),
              ...proposed,
            });
          } else {
            const w = t.walked;
            const visible = w.files.filter(
              (f) =>
                !f.rel
                  .split('/')
                  .slice(0, -1)
                  .some((s) => isHiddenName(s, false)),
            );
            const dirs = new Set<string>();
            for (const f of visible) {
              const parts = f.rel.split('/');
              for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
            }
            // Its files already in the Coffre (they come anyway: a folder arrives as it is).
            let innerDuplicates: number | undefined;
            if (w.bytes <= ANALYZE_HASH_BYTES) {
              innerDuplicates = 0;
              for (const f of visible) {
                if (job.signal.aborted) break;
                const sha = await hashFile(path.join(t.abs, ...f.rel.split('/')));
                if (d.duplicateOf(sha)) innerDuplicates++;
              }
            }
            proposals.push({
              path: t.abs,
              name,
              isDirectory: true,
              fileCount: w.files.length,
              folderCount: dirs.size,
              size: w.bytes,
              sha256: null,
              duplicate: null,
              innerDuplicates,
              setAside: w.setAside,
              projects: projectHints(w.files),
              ...proposed,
            });
          }
        } catch (error) {
          job.problem(t.abs, message(error));
        }
        n++;
      }
      job.step(n, targets.length, { unit: 'éléments analysés', current: null });
      return { proposals, needsConfirm: null, setAside, ignored };
    },
    { concurrency: 2 },
  );

  ctx.routes.post('/deposit/analyze', (request) => {
    const b = requestBody(request);
    const paths = Array.isArray(b.paths)
      ? b.paths.filter((p): p is string => typeof p === 'string')
      : [];
    if (!paths.length) throw new HttpError(400, 'Aucun fichier');
    const folderId = typeof b.folderId === 'string' && b.folderId ? b.folderId : null;
    const job = ctx.jobs.enqueue(
      'deposit-analyze',
      { paths, folderId, confirmed: b.confirmed === true },
      {
        title:
          paths.length > 1
            ? `Coffre : analyse de ${paths.length} éléments`
            : `Coffre : analyse de « ${path.basename(paths[0]!)} »`,
      },
    );
    return { jobId: job.id };
  });

  // --- Rangement ------------------------------------------------------------------------

  interface ApplyState {
    next: number;
    created: string[];
    skipped: ApplyResult['skipped'];
    foldersBefore: string[];
    /** Files or folders that failed (listed with their reason). */
    failed: number;
  }
  const problem = (
    job: JobRunContext<{ entries: DepositEntryInput[] }>,
    state: ApplyState,
    item: string,
    reason: string,
  ) => {
    state.failed++;
    job.problem(item, reason);
  };

  /** One file copied under a temporary name, read back, then put in place (never over another). */
  const placeFile = async (
    source: string,
    dirRel: string,
    name: string,
    sha256: string,
    temp: string,
  ): Promise<string> => {
    const dirAbs = library.abs(dirRel);
    await mkdir(dirAbs, { recursive: true });
    // Resumed after a stop between putting the copy in place and writing its row: the copy
    // already there (same content, no row) is taken as it is — never a « nom (2) ».
    const placed = dirRel ? `${dirRel}/${name}` : name;
    if (library.exists(placed) && !d.hasItemAt(placed)) {
      if ((await hashFile(library.abs(placed))) === sha256) return placed;
    }
    const tmp = path.join(dirAbs, temp);
    await rm(tmp, { recursive: true, force: true });
    try {
      await copyFile(source, tmp);
      if ((await hashFile(tmp)) !== sha256) throw new Error('copie incomplète (relue différente)');
      const free = library.freeIn(dirAbs, name);
      await rename(tmp, path.join(dirAbs, free));
      return dirRel ? `${dirRel}/${free}` : free;
    } catch (error) {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  };

  /** A row for a file placed, its labels written (one transaction: no row without its labels). */
  const fileRow = (
    rel: string,
    source: string,
    sha256: string,
    folderId: string | null,
    labels: LabelDto[],
    st: { size: number; mtime: Date },
    provenance: ReturnType<ModuleContext['files']['provenance']>,
  ): string => {
    let id = '';
    ctx.db.transaction(() => {
      const made = store.create<ItemRow & { updated_at: string }>('items', {
        kind: 'file',
        name: path.posix.basename(rel),
        rel_path: rel,
        size: st.size,
        sha256,
        ext: extOf(rel),
        folder_id: folderId,
        pinned: 0,
        trashed_at: null,
        trash_from: null,
        source_path: source,
        source_sha256: sha256,
        source_url: provenance?.hostUrl ?? null,
        referrer_url: provenance?.referrerUrl ?? null,
        file_date: st.mtime.toISOString(),
        archived_at: null,
        stat_json: null,
        opened_at: null,
        original_name: path.basename(source),
      });
      d.writeLabels(made.id, labels);
      id = made.id;
    });
    return id;
  };

  /** Where an entry goes: its folder (a route created now), or À ranger (`later`). */
  const targetOf = (e: DepositEntryInput): string | null =>
    e.later ? null : e.newFolder?.length ? d.ensureFolder(e.newFolder, null) : (e.folderId ?? null);

  /** One dropped FILE: copied, read back, its row with its labels. */
  async function applyFile(
    job: JobRunContext<{ entries: DepositEntryInput[] }>,
    index: number,
    e: DepositEntryInput,
    count: { done: number; total: number },
    state: ApplyState,
  ) {
    const folderId = targetOf(e);
    const name = safeName(e.name?.trim() || path.basename(e.path));
    job.step(count.done, count.total, { current: name });
    const provenance = ctx.files.provenance(e.path);
    const sha256 = await hashFile(e.path);
    const dup = d.duplicateOf(sha256);
    if (dup && !e.keepDuplicate) {
      state.skipped.push({ path: e.path, duplicate: dup });
      count.done++;
      return;
    }
    const st = statSync(e.path);
    const rel = await placeFile(
      e.path,
      d.folderOf(folderId),
      name,
      sha256,
      `${TEMP_PREFIX}${job.id}-${index}`,
    );
    const labels = Array.isArray(e.labels) ? e.labels : [];
    try {
      const id = fileRow(rel, e.path, sha256, folderId, labels, st, provenance);
      state.created.push(id);
      d.learnFrom(d.getRow(id), folderId);
    } catch (error) {
      // No row: the copy goes too (nothing half done).
      await library.erase(rel).catch(() => undefined);
      throw error;
    }
    count.done++;
  }

  /**
   * One dropped FOLDER: it arrives as it is, at the route chosen. Its
   * sub-folders become folders; a sub-folder marked « Projet » (the highest
   * only) arrives whole as ONE entry; its hidden folders (outside a project)
   * are not taken; its recreatable folders are set aside. A file that fails
   * is listed and the others go on.
   */
  async function applyFolder(
    job: JobRunContext<{ entries: DepositEntryInput[] }>,
    index: number,
    e: DepositEntryInput,
    walked: Walked,
    count: { done: number; total: number },
    state: ApplyState,
  ) {
    const parentId = e.later ? null : targetOf({ ...e, later: false });
    const rootName = (e.name?.trim() || path.basename(e.path)).replace(/\s+/g, ' ').trim();
    const projects = (e.projects ?? []).filter((p, _, all) => projectOf(p, all) === p);
    const extra = Array.isArray(e.labels) ? e.labels.filter((l) => l.origin === 'chosen') : [];
    // The folders, made as they are needed (« » = the dropped folder itself).
    const made = new Map<string, string>();
    const folderFor = (rel: string): string => {
      const known = made.get(rel);
      if (known) return known;
      if (!rel) {
        const id = d.ensureFolder([rootName], parentId);
        made.set(rel, id);
        return id;
      }
      const parent = folderFor(rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
      const id = d.ensureFolder([rel.slice(rel.lastIndexOf('/') + 1)], parent);
      made.set(rel, id);
      return id;
    };
    // The projects: each whole (its files, .git included, its recreatable folders apart).
    for (const [k, p] of projects.entries()) {
      if (job.signal.aborted) return;
      const inside = walked.files.filter((f) => p === '' || f.rel.startsWith(`${p}/`));
      const src = p ? path.join(e.path, ...p.split('/')) : e.path;
      const files = inside.map((f) => ({
        rel: p ? f.rel.slice(p.length + 1) : f.rel,
        size: f.size,
      }));
      job.step(count.done, count.total, { current: `${rootName}/${p}` });
      try {
        const parentRel = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
        const holder = p ? folderFor(parentRel) : parentId;
        const projectName = p ? p.slice(p.lastIndexOf('/') + 1) : rootName;
        const holderDir = p ? d.folderOf(holder) : parentId ? d.folderOf(parentId) : '';
        const dirAbs = library.abs(holderDir);
        await mkdir(dirAbs, { recursive: true });
        const sha = (await hashFiles(src, files, undefined, job.signal)).sha256;
        const target = path.join(dirAbs, folderName(projectName));
        const rel = holderDir ? `${holderDir}/${folderName(projectName)}` : folderName(projectName);
        // Resumed: the project already in place, without its entry, same content: taken.
        let placed = false;
        if (existsSync(target) && !d.hasItemAt(rel)) {
          const again = await walkFolder(target, { inProject: true });
          placed = (await hashFiles(target, again.files)).sha256 === sha;
        }
        if (existsSync(target) && !placed)
          throw new Error(`un dossier « ${projectName} » existe déjà à cet endroit`);
        if (!placed) {
          const tmp = path.join(dirAbs, `${TEMP_PREFIX}${job.id}-${index}-${k}`);
          await rm(tmp, { recursive: true, force: true });
          try {
            for (const f of files) {
              if (job.signal.aborted) throw new Error('annulée');
              const to = path.join(tmp, ...f.rel.split('/'));
              await mkdir(path.dirname(to), { recursive: true });
              await copyFile(path.join(src, ...f.rel.split('/')), to);
              count.done++;
              if (count.done % 25 === 0) {
                job.step(count.done, count.total, { current: `${projectName}/${f.rel}` });
                // The tests slow it down to stop it in the middle of a project.
                const pause = Number(process.env.TOOLBOX_COFFRE_DEPOSIT_PAUSE_MS ?? 0);
                if (pause) await new Promise((r) => setTimeout(r, pause));
              }
            }
            const copied = await walkFolder(tmp, { inProject: true, keepSetAside: true });
            if ((await hashFiles(tmp, copied.files)).sha256 !== sha)
              throw new Error('copie incomplète (relue différente)');
            await rename(tmp, target);
          } catch (error) {
            await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
            throw error;
          }
        } else count.done += files.length;
        const folderId = p ? folderFor(p) : folderFor('');
        ctx.db.transaction(() => {
          store.update('folders', folderId, { project: 1, end_of_route: 1 });
          const entry = store.create<ItemRow & { updated_at: string }>('items', {
            kind: 'project',
            name: projectName,
            rel_path: rel,
            size: files.reduce((s, f) => s + f.size, 0),
            sha256: sha,
            ext: '',
            folder_id: folderId,
            pinned: 0,
            trashed_at: null,
            trash_from: null,
            source_path: src,
            source_sha256: sha,
            source_url: null,
            referrer_url: null,
            file_date: statSync(src).mtime.toISOString(),
            archived_at: null,
            stat_json: null,
            opened_at: null,
            original_name: projectName,
          });
          state.created.push(entry.id);
        });
      } catch (error) {
        if (job.signal.aborted) return;
        problem(job, state, src, message(error));
      }
    }
    // The files outside the projects, one by one (their folders made as needed).
    for (const f of walked.files) {
      if (job.signal.aborted) return;
      if (projectOf(f.rel, projects) !== null) continue;
      const dirParts = f.rel.split('/').slice(0, -1);
      // A hidden folder outside a project (.vscode, .idea…): not taken.
      if (dirParts.some((s) => isHiddenName(s, false))) continue;
      const source = path.join(e.path, ...f.rel.split('/'));
      try {
        const folderId = folderFor(dirParts.join('/'));
        const name = safeName(path.posix.basename(f.rel));
        job.step(count.done, count.total, { current: `${rootName}/${f.rel}` });
        const sha256 = await hashFile(source);
        const dirRel = d.folderOf(folderId);
        // Resumed: already there with its row.
        if (
          d.hasItemAt(`${dirRel}/${name}`) &&
          (await hashFile(library.abs(`${dirRel}/${name}`))) === sha256
        ) {
          count.done++;
          continue;
        }
        const st = statSync(source);
        const provenance = ctx.files.provenance(source);
        const rel = await placeFile(
          source,
          dirRel,
          name,
          sha256,
          `${TEMP_PREFIX}${job.id}-${index}-f`,
        );
        const labels = [...d.proposeLabels(name, st.mtime.toISOString(), provenance, folderId)];
        for (const x of extra)
          if (!labels.some((l) => l.family === x.family && fold(l.value) === fold(x.value)))
            labels.push(x);
        try {
          state.created.push(fileRow(rel, source, sha256, folderId, labels, st, provenance));
        } catch (error) {
          await library.erase(rel).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (job.signal.aborted) return;
        problem(job, state, source, message(error));
      }
      count.done++;
      if (count.done % 25 === 0) {
        const pause = Number(process.env.TOOLBOX_COFFRE_DEPOSIT_PAUSE_MS ?? 0);
        if (pause) await new Promise((r) => setTimeout(r, pause));
      }
    }
    // An empty folder dropped still arrives (as it is).
    if (!walked.files.length) folderFor('');
  }

  ctx.jobs.define<{ entries: DepositEntryInput[] }, ApplyResult>(
    'deposit-apply',
    async (job) => {
      const { entries } = job.input;
      const saved = job.state as ApplyState | null;
      const state: ApplyState = saved ?? {
        next: 0,
        created: [],
        skipped: [],
        foldersBefore: d.folderRows().map((c) => c.id),
        failed: 0,
      };
      // The folders read once (without blocking), their total in files.
      job.step(0, null, { unit: 'fichiers comptés', current: null });
      const walks = new Map<number, Walked>();
      let total = 0;
      for (let i = state.next; i < entries.length; i++) {
        if (job.signal.aborted) break;
        const e = entries[i]!;
        try {
          if (existsSync(e.path) && (await stat(e.path)).isDirectory()) {
            const w = await walkFolder(e.path, { inProject: true, signal: job.signal });
            walks.set(i, w);
            total += w.files.length;
          } else total += 1;
        } catch {
          total += 1;
        }
      }
      const count = { done: 0, total };
      for (let i = state.next; i < entries.length; i++) {
        if (job.signal.aborted) break;
        const e = entries[i]!;
        try {
          if (!existsSync(e.path)) throw new Error('introuvable (déplacé ou supprimé ?)');
          const w = walks.get(i);
          if (w) await applyFolder(job, i, e, w, count, state);
          else await applyFile(job, i, e, count, state);
        } catch (error) {
          if (job.signal.aborted) break;
          problem(job, state, e.path, message(error));
        }
        state.next = i + 1;
        job.checkpoint(state);
        // The tests slow it down to stop it in the middle (a restart, a cancel).
        const pause = Number(process.env.TOOLBOX_COFFRE_DEPOSIT_PAUSE_MS ?? 0);
        if (pause) await new Promise((r) => setTimeout(r, pause));
        job.step(count.done, count.total, { unit: 'fichiers', current: null });
      }
      const before = new Set(state.foldersBefore);
      const newFolders = d
        .folderRows()
        .filter((c) => !before.has(c.id))
        .map((c) => c.id);
      const created = [...state.created];
      const undoId =
        created.length || newFolders.length
          ? d.remember(async () => {
              for (const id of created) {
                const row = store.get<ItemRow & { updated_at: string }>(
                  'items',
                  id,
                ) as ItemRow | null;
                if (row?.rel_path) await library.erase(row.rel_path).catch(() => undefined);
                store.remove('items', id);
              }
              for (const id of newFolders) store.update('folders', id, { project: 0 });
              await d.removeIfEmpty(newFolders);
            })
          : null;
      d.after(
        entries.slice(0, state.next).map((e) => e.path),
        created.length,
      );
      return {
        created: d.dtos(created.slice(0, 500).map((id) => d.getRow(id))),
        skipped: state.skipped,
        undoId,
        failed: state.failed,
      };
    },
    {
      resumable: true,
      // « Réessayer ceux-là »: the entries that failed (a folder: again, its files already in
      // the Coffre are kept as they are).
      retry: (input, errors) => {
        const failed = errors.map((x) => x.item);
        const entries = (input as { entries: DepositEntryInput[] }).entries.filter((e) =>
          failed.some((f) => f === e.path || f.startsWith(e.path + path.sep)),
        );
        return entries.length ? { entries } : null;
      },
    },
  );

  ctx.routes.post('/deposit/apply', (request) => {
    const b = requestBody(request);
    const entries = (Array.isArray(b.entries) ? b.entries : []) as DepositEntryInput[];
    if (!entries.length) throw new HttpError(400, 'Rien à ranger');
    for (const e of entries)
      if (e.later && existsSync(e.path) && statSync(e.path).isDirectory())
        throw new HttpError(
          400,
          `« ${path.basename(e.path)} » : un dossier se range à une route (pas dans À ranger)`,
        );
    const job = ctx.jobs.enqueue(
      'deposit-apply',
      { entries },
      {
        title:
          entries.length > 1
            ? `Coffre : ranger ${entries.length} éléments`
            : `Coffre : ranger « ${path.basename(entries[0]!.path)} »`,
      },
    );
    return { jobId: job.id };
  });

  /** The deposit tasks running or waiting now (the disk waits for them). */
  return {
    busy: (): string | null => {
      const running = ctx.jobs
        .list()
        .find(
          (j) => j.type === 'deposit-apply' && (j.status === 'running' || j.status === 'queued'),
        );
      return running ? running.title : null;
    },
  };
}
