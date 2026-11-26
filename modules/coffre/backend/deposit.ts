// v0.49.0: depositing as BACKGROUND TASKS (MODULES.md §5.6 bis) — the request
// answers at once with a task; the panel follows it (« 12 / 7 000 fichiers »,
// the file in progress, the time left, Annuler). Analysis: the folders are
// read asynchronously, the recreatable folders set aside BEFORE counting and
// fingerprinting; beyond a threshold the task stops and asks first.
// Rangement: one item after the other; one that fails stays where it was and
// is listed with its reason (« Réessayer ceux-là »), the others go on;
// nothing is half written (a temporary name, read back, then put in place).
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  HttpError,
  requestBody,
  type JobRunContext,
  type ModuleContext,
  type SyncStore,
} from '@hub/sdk/core';
import { extOf } from '../shared/kinds';
import { ARRIVAL_FOLDER, safeName } from '../shared/names';
import type { AttributeDto, ItemDto, ItemKind, ProposalDto } from '../shared/types';
import { hashFile, type Library } from './library';
import { projectMarker } from './import';
import type { ContextRow, ItemRow } from './rows';
import { hashFiles, walkFolder, type SetAside, type Walked } from './walk';

/** Beyond this (after setting aside), the analysis asks before going on. */
export const WARN_FILES = () => Number(process.env.TOOLBOX_COFFRE_WARN_FILES ?? 20_000);
export const WARN_BYTES = 20 * 1024 ** 3;
/** A project with more files is kept without a fingerprint (as before). */
const MAX_PROJECT_FILES = 20_000;
const TEMP_PREFIX = '.~depot-';

export interface DepositEntryInput {
  path: string;
  as?: 'link';
  name?: string;
  arrival?: boolean;
  contextId?: string | null;
  newContext?: string[] | null;
  attributes?: AttributeDto[];
  keepDuplicate?: boolean;
}

export interface AnalyzeResult {
  proposals: ProposalDto[];
  /** Beyond the threshold: nothing analysed yet; « Continuer » (confirmed) or choose. */
  needsConfirm: { files: number; bytes: number; setAside: SetAside[] } | null;
  setAside: SetAside[];
  ignored: number;
}

export interface ApplyResult {
  created: ItemDto[];
  skipped: {
    path: string;
    duplicate: { id: string; name: string; contextPath: string[] | null };
  }[];
  undoId: string | null;
  failed: number;
}

export interface DepositDeps {
  ctx: ModuleContext;
  store: SyncStore;
  library: Library;
  contextRows: () => ContextRow[];
  ensureContext: (names: string[]) => string;
  folderOf: (contextId: string) => string;
  /** The Coffre's proposal for a path (a folder: its walk given). */
  propose: (abs: string, walked?: Walked) => Promise<ProposalDto>;
  duplicateOf: (sha: string | null) => {
    id: string;
    name: string;
    contextPath: string[] | null;
  } | null;
  writeAttributes: (itemId: string, list: AttributeDto[]) => void;
  learnFrom: (row: ItemRow, contextId: string | null) => void;
  remember: (run: () => Promise<void>) => string;
  removeIfEmpty: (ids: readonly string[]) => Promise<void>;
  dtos: (rows: ItemRow[]) => ItemDto[];
  getRow: (id: string) => ItemRow;
  /** An element already has this path in the Coffre (a copy left without a sheet does not). */
  hasItemAt: (rel: string) => boolean;
  /** After a deposit: the search reads the new texts; downloads put away are no longer proposed. */
  after: (paths: string[], created: number) => void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Is this folder a code project at its root (« build », « dist » set aside too)? */
function isProjectRoot(dir: string): boolean {
  try {
    const entries = readdirSync(dir, { withFileTypes: true }).map((e) => ({
      name: e.name,
      dir: e.isDirectory(),
    }));
    return projectMarker(entries) !== null;
  } catch {
    return false;
  }
}

export function registerDeposit(d: DepositDeps) {
  const { ctx, store, library } = d;

  // --- Analysis --------------------------------------------------------------------------

  ctx.jobs.define<{ paths: string[]; expand: boolean; confirmed?: boolean }, AnalyzeResult>(
    'deposit-analyze',
    async (job) => {
      const { paths, expand } = job.input;
      const setAside: SetAside[] = [];
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
          // Kept as one project: « build », « dist »… set aside too; one by one: only if it is one.
          inProject: expand ? isProjectRoot(p) : true,
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
        if (expand)
          for (const f of walked.files) targets.push({ abs: path.join(p, ...f.rel.split('/')) });
        else targets.push({ abs: p, walked });
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
        job.step(n, targets.length, { unit: 'éléments analysés', current: path.basename(t.abs) });
        try {
          proposals.push(await d.propose(t.abs, t.walked));
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
    const job = ctx.jobs.enqueue(
      'deposit-analyze',
      { paths, expand: b.expand === true, confirmed: b.confirmed === true },
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
    contextsBefore: string[];
  }

  /** One entry: its copy (temporary name, read back, then in place) and its sheet. */
  async function applyOne(
    job: JobRunContext<{ entries: DepositEntryInput[] }>,
    index: number,
    e: DepositEntryInput,
    count: { done: number; total: number },
    state: ApplyState,
  ): Promise<void> {
    if (typeof e.path !== 'string' || !path.isAbsolute(e.path) || !existsSync(e.path))
      throw new Error('introuvable (déplacé ou supprimé ?)');
    const st = statSync(e.path);
    const kind: ItemKind = e.as === 'link' ? 'link' : st.isDirectory() ? 'project' : 'file';
    const contextId = e.arrival
      ? null
      : e.newContext?.length
        ? d.ensureContext(e.newContext)
        : (e.contextId ?? null);
    const name = safeName(e.name?.trim() || path.basename(e.path));
    const dir = contextId ? d.folderOf(contextId) : ARRIVAL_FOLDER;
    const provenance = kind === 'file' ? ctx.files.provenance(e.path) : null;
    let sha256: string | null = null;
    let size = st.size;
    let walked: Walked | null = null;
    if (kind === 'file') sha256 = await hashFile(e.path);
    else if (kind === 'project') {
      walked = await walkFolder(e.path, { inProject: true, signal: job.signal });
      size = walked.bytes;
      if (walked.files.length <= MAX_PROJECT_FILES)
        sha256 = (await hashFiles(e.path, walked.files, undefined, job.signal)).sha256;
    }
    if (job.signal.aborted) return;
    const dup = kind === 'link' ? null : d.duplicateOf(sha256);
    if (dup && !e.keepDuplicate) {
      state.skipped.push({ path: e.path, duplicate: dup });
      count.done += walked ? walked.files.length : 1;
      return;
    }
    let relPath: string | null = null;
    // Resumed after a stop between putting the copy in place and writing its sheet: the copy
    // already there (same content, no sheet) is taken as it is — never a « nom (2) ».
    const placed = `${dir}/${name}`;
    if (kind !== 'link' && sha256 && library.exists(placed) && !d.hasItemAt(placed)) {
      const same =
        kind === 'file'
          ? (await hashFile(library.abs(placed))) === sha256
          : (
              await hashFiles(
                library.abs(placed),
                (await walkFolder(library.abs(placed), { inProject: true })).files,
              )
            ).sha256 === sha256;
      if (same) {
        relPath = placed;
        count.done += walked ? walked.files.length : 1;
      }
    }
    if (kind !== 'link' && !relPath) {
      const dirAbs = library.abs(dir);
      await mkdir(dirAbs, { recursive: true });
      const tmp = path.join(dirAbs, `${TEMP_PREFIX}${job.id}-${index}`);
      await rm(tmp, { recursive: true, force: true });
      try {
        if (kind === 'file') {
          job.step(count.done, count.total, { current: name });
          await copyFile(e.path, tmp);
          if ((await hashFile(tmp)) !== sha256)
            throw new Error('copie incomplète (relue différente)');
          count.done++;
        } else {
          // A project: file by file (the progress moves), its recreatable folders left out.
          for (const f of walked!.files) {
            if (job.signal.aborted) throw new Error('annulée');
            const target = path.join(tmp, ...f.rel.split('/'));
            await mkdir(path.dirname(target), { recursive: true });
            await copyFile(e.path + path.sep + f.rel.split('/').join(path.sep), target);
            count.done++;
            if (count.done % 25 === 0) {
              job.step(count.done, count.total, { current: `${name}/${f.rel}` });
              // The tests slow it down to stop it in the middle of a project.
              const pause = Number(process.env.TOOLBOX_COFFRE_DEPOSIT_PAUSE_MS ?? 0);
              if (pause) await new Promise((r) => setTimeout(r, pause));
            }
          }
          const copied = await walkFolder(tmp, { inProject: true, keepSetAside: true });
          if (copied.files.length !== walked!.files.length)
            throw new Error('copie incomplète (nombre de fichiers différent)');
        }
        const free = library.freeIn(dirAbs, name);
        await rename(tmp, path.join(dirAbs, free));
        relPath = `${dir}/${free}`;
      } catch (error) {
        await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    } else if (kind === 'link') count.done++;
    const attrs = (Array.isArray(e.attributes) ? e.attributes : []).filter(
      (a) => a && typeof a === 'object',
    );
    try {
      const row = ctx.db.transaction(() => {
        const made = store.create<ItemRow & { updated_at: string }>('items', {
          kind,
          name: relPath ? path.posix.basename(relPath) : name,
          rel_path: relPath,
          external_path: kind === 'link' ? e.path : null,
          size,
          sha256,
          ext: kind === 'file' || kind === 'link' ? extOf(name) : '',
          context_id: contextId,
          arrival: contextId ? 0 : 1,
          pinned: 0,
          trashed_at: null,
          trash_from: null,
          source_path: e.path,
          source_url: provenance?.hostUrl ?? null,
          referrer_url: provenance?.referrerUrl ?? null,
          file_date: st.mtime.toISOString(),
          original_name: path.basename(e.path),
        });
        d.writeAttributes(made.id, attrs);
        return made;
      });
      state.created.push(row.id);
      d.learnFrom(row as ItemRow, contextId);
    } catch (error) {
      // No sheet: the copy goes too (nothing half done).
      if (relPath) await library.erase(relPath).catch(() => undefined);
      throw error;
    }
  }

  ctx.jobs.define<{ entries: DepositEntryInput[] }, ApplyResult>(
    'deposit-apply',
    async (job) => {
      const entries = job.input.entries;
      library.ensure();
      const saved = job.state as ApplyState | null;
      const state: ApplyState = saved ?? {
        next: 0,
        created: [],
        skipped: [],
        contextsBefore: d.contextRows().map((c) => c.id),
      };
      // The total, in files (a project: its files, read without blocking).
      job.step(0, null, { unit: 'fichiers comptés', current: null });
      let total = 0;
      for (const e of entries.slice(state.next)) {
        if (job.signal.aborted) break;
        try {
          total +=
            e.as !== 'link' && existsSync(e.path) && (await stat(e.path)).isDirectory()
              ? (await walkFolder(e.path, { inProject: true, signal: job.signal })).files.length
              : 1;
        } catch {
          total += 1;
        }
      }
      const count = { done: 0, total };
      for (let i = state.next; i < entries.length; i++) {
        if (job.signal.aborted) break;
        const e = entries[i]!;
        try {
          await applyOne(job, i, e, count, state);
        } catch (error) {
          if (job.signal.aborted) break;
          job.problem(e.path, message(error));
        }
        state.next = i + 1;
        job.checkpoint(state);
        // The tests slow it down to stop it in the middle (a restart, a cancel).
        const pause = Number(process.env.TOOLBOX_COFFRE_DEPOSIT_PAUSE_MS ?? 0);
        if (pause) await new Promise((r) => setTimeout(r, pause));
        job.step(count.done, count.total, { unit: 'fichiers', current: null });
      }
      const before = new Set(state.contextsBefore);
      const newContexts = d
        .contextRows()
        .filter((c) => !before.has(c.id))
        .map((c) => c.id);
      const created = [...state.created];
      const undoId = created.length
        ? d.remember(async () => {
            for (const id of created) {
              const row = store.get<ItemRow & { updated_at: string }>(
                'items',
                id,
              ) as ItemRow | null;
              if (row?.rel_path) await library.erase(row.rel_path).catch(() => undefined);
              store.remove('items', id);
            }
            await d.removeIfEmpty(newContexts);
          })
        : null;
      d.after(
        entries.slice(0, state.next).map((e) => e.path),
        created.length,
      );
      return {
        created: d.dtos(created.map((id) => d.getRow(id))),
        skipped: state.skipped,
        undoId,
        failed: entries.length - state.skipped.length - created.length,
      };
    },
    {
      resumable: true,
      // « Réessayer ceux-là »: the entries that failed, as they were.
      retry: (input, errors) => {
        const failed = new Set(errors.map((e) => e.item));
        const entries = (input as { entries: DepositEntryInput[] }).entries.filter((e) =>
          failed.has(e.path),
        );
        return entries.length ? { entries } : null;
      },
    },
  );

  ctx.routes.post('/deposit/apply', (request) => {
    const b = requestBody(request);
    const entries = (Array.isArray(b.entries) ? b.entries : []) as DepositEntryInput[];
    if (!entries.length) throw new HttpError(400, 'Rien à ranger');
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
          (j) =>
            (j.type === 'deposit-apply' || j.type === 'tree-import') &&
            (j.status === 'running' || j.status === 'queued'),
        );
      return running ? running.title : null;
    },
  };
}
