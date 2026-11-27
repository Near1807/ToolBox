// v0.45.0 (Expérimental): the Coffre — keep, put away, find and open the
// files that matter (cahier des charges : docs/coffre/CAHIER-DES-CHARGES.md).
// v0.50.0 (ADR 0067): « tout est dossier » — folders (real folders, their
// route is their path), files in them, labels by family, two badges of a
// folder (« Fin de route », « Projet »), « À ranger ». PC only: it copies the
// user's files into ctx.files.libraryDir (userData/coffre) and opens their
// applications. Ready for sync (UUIDs, tombstones, journal), no real sync yet.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defineBackendModule,
  HttpError,
  isRunnable,
  mountsDisk,
  newId,
  requestBody,
  SyncStore,
  uuidParam,
} from '@hub/sdk/core';
import { isColorValue } from '@hub/sdk/palette';
import type { AgendaService } from '../../agenda/contract';
import { folderCss } from '../shared/colors';
import { deduce, fold, hostOf, mergeGuesses, type FolderRef } from '../shared/deduce';
import { extOf, kindOf } from '../shared/kinds';
import {
  folderName,
  invalidName,
  OLD_ARRIVAL_FOLDER,
  PENDING_FOLDER,
  safeName,
  splitExtension,
  TRASH_FOLDER,
} from '../shared/names';
import {
  LABEL_FAMILIES,
  type CourseHint,
  type FolderDto,
  type HomeDto,
  type InsideDto,
  type InsideEntryDto,
  type ItemDto,
  type LabelDto,
  type LabelFamily,
  type LabelSetDto,
  type LabelValue,
  type NowDto,
  type ProposalDto,
} from '../shared/types';
import { hashFile, Library } from './library';
import type { CopyRow, FolderRow, ItemRow, LabelRow, LabelSetRow } from './rows';
import { stateOf } from './plan';
import { DiskManager, type CoffreDeps } from './disk';
import { registerDiskRoutes } from './disk-routes';
import { registerRestoreRoutes } from './restore';
import { registerVerifyRoutes } from './verify';
import { cleanReadCopies, readCopy, registerArchiveRoutes, SUGGEST_DAYS } from './archive';
import { TextIndex } from './text-index';
import { registerSearch } from './search';
import { registerTreeRoutes } from './tree';
import { registerDeposit } from './deposit';
import { ProjectIndex } from './inner';
import { ProjectRules } from './exclusions';
import { registerProjectRoutes } from './projects';
import { registerTrackedRoutes } from './tracked';
import { gitChanges, readGit, type GitChanges } from './git';
import { registerDiskExcludedRoutes } from './project-update';
import { registerReset } from './reset';
import { DownloadWatcher } from './downloads';
import { Learner } from './learning';
import { MIGRATIONS } from './migrations';
import { applyRules } from '../shared/learn';
import { folderOfCourse } from '../shared/now';
import { isHiddenName, isIgnoredFile, projectMarker, projectReason } from './walk';

/** How long « Annuler » stays possible. */
const UNDO_MS = 15 * 60_000;
/** How often the PC's files are looked at (changes read again for the search). */
const RESCAN_MS = 10 * 60_000;
/** « Nouveau » on a folder: what was added in the last days. */
const FRESH_DAYS = 7;
/** The inside of a folder shown at most (a huge folder: cut, said). */
const MAX_INSIDE = 5000;
/** A label's value: at most this long. */
const MAX_LABEL = 200;

/** v0.50.0: a list of labels without origin, cleaned (known family, a value, no twin). */
export function cleanLabels(list: unknown): LabelValue[] {
  const out: LabelValue[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;
    const { family, value } = raw as { family?: unknown; value?: unknown };
    if (!LABEL_FAMILIES.includes(family as LabelFamily) || typeof value !== 'string') continue;
    const v = value.trim().slice(0, MAX_LABEL);
    if (!v || out.some((l) => l.family === family && fold(l.value) === fold(v))) continue;
    out.push({ family: family as LabelFamily, value: v });
  }
  return out;
}

/** An entry's row as created (every column, nothing else known yet). */
const emptyItem = (fields: Partial<ItemRow> & Pick<ItemRow, 'kind' | 'name'>) => ({
  rel_path: null,
  size: 0,
  sha256: null,
  ext: '',
  folder_id: null,
  pinned: 0,
  trashed_at: null,
  trash_from: null,
  source_path: null,
  source_sha256: null,
  source_url: null,
  referrer_url: null,
  file_date: null,
  archived_at: null,
  stat_json: null,
  opened_at: null,
  original_name: null,
  tracked_path: null,
  missing_at: null,
  exclusions_json: null,
  ...fields,
});

/** A folder's row as created. */
const emptyFolder = (parentId: string | null, name: string) => ({
  parent_id: parentId,
  name,
  color: null,
  sort: null,
  course_name: null,
  end_of_route: 0,
  project: 0,
  default_labels_json: '[]',
});

export default defineBackendModule({
  migrations: MIGRATIONS,

  register(ctx) {
    const store = new SyncStore(ctx.db);
    const items = ctx.db.table('items');
    const folders = ctx.db.table('folders');
    const labels = ctx.db.table('labels');
    const labelSets = ctx.db.table('label_sets');
    // An archived file keeps its name in its folder (it is on the disk at that path).
    const library = new Library(ctx.files.libraryDir, (dirRel) => {
      const rows = ctx.db
        .prepare(
          `SELECT rel_path FROM ${items} WHERE deleted_at IS NULL AND archived_at IS NOT NULL AND rel_path LIKE ?`,
        )
        .all(`${dirRel ? `${dirRel}/` : ''}%`) as { rel_path: string }[];
      return new Set(
        rows
          .filter((r) => path.posix.dirname(r.rel_path) === (dirRel || '.'))
          .map((r) => path.posix.basename(r.rel_path).toLowerCase()),
      );
    });
    // The disk (ADR 0055).
    // v0.51.0: the files inside the projects (ADR 0068).
    const projects = new ProjectIndex(ctx, library);
    const deps: CoffreDeps = {
      ctx,
      store,
      library,
      projects,
      // « Annuler » (defined just below; called only later, at a request).
      remember: (run) => remember(run),
      t: {
        items,
        folders,
        labels,
        labelSets,
        disks: ctx.db.table('disks'),
        copies: ctx.db.table('copies'),
        versions: ctx.db.table('versions'),
      },
    };
    const disk = new DiskManager(deps);
    const agenda = () => ctx.services.optional<AgendaService>('agenda');
    const undo = new Map<string, { at: number; run: () => Promise<void> }>();
    const remember = (run: () => Promise<void>) => {
      const id = newId();
      const now = Date.now();
      for (const [k, u] of undo) if (now - u.at > UNDO_MS) undo.delete(k);
      undo.set(id, { at: now, run });
      return id;
    };

    // --- Folders ------------------------------------------------------------------------

    const folderRows = () =>
      ctx.db
        .prepare(`SELECT * FROM ${folders} WHERE deleted_at IS NULL ORDER BY sort, name`)
        .all() as FolderRow[];
    const pathOf = (byId: Map<string, FolderRow>, id: string | null): string[] => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (
        let c = id ? byId.get(id) : undefined;
        c && !seen.has(c.id);
        c = c.parent_id ? byId.get(c.parent_id) : undefined
      ) {
        seen.add(c.id);
        out.unshift(c.name);
      }
      return out;
    };
    /** A folder's place in the Coffre (« Cours/Thermo »), or À ranger. */
    const folderOf = (folderId: string | null): string => {
      if (!folderId) return PENDING_FOLDER;
      const byId = new Map(folderRows().map((c) => [c.id, c]));
      if (!byId.has(folderId)) throw new HttpError(404, 'Dossier introuvable');
      return pathOf(byId, folderId).map(folderName).join('/');
    };
    const getFolder = (id: string) => {
      const row = folderRows().find((c) => c.id === id);
      if (!row) throw new HttpError(404, 'Dossier introuvable');
      return row;
    };
    /** The folder's own default labels. */
    const defaultsOf = (row: FolderRow): LabelValue[] => {
      try {
        return cleanLabels(JSON.parse(row.default_labels_json || '[]'));
      } catch {
        return [];
      }
    };
    /**
     * The default labels a file put in this folder receives: the nearest
     * folder (itself, then its parents) that has some — the closest wins.
     */
    const inheritedDefaults = (folderId: string | null): LabelDto[] => {
      const byId = new Map(folderRows().map((c) => [c.id, c]));
      for (let c = folderId ? byId.get(folderId) : undefined, n = 0; c && n < 200; n++) {
        const own = defaultsOf(c);
        const name = c.name;
        if (own.length)
          return own.map((l) => ({
            ...l,
            origin: 'default' as const,
            reason: `par défaut du dossier « ${name} »`,
          }));
        c = c.parent_id ? byId.get(c.parent_id) : undefined;
      }
      return [];
    };
    /** The folder of this name under that parent (case and accents ignored), or a new one. */
    const ensureFolder = (names: string[], parentId: string | null = null): string => {
      let parent = parentId;
      for (const raw of names) {
        const name = raw.replace(/\s+/g, ' ').trim();
        if (!name) throw new HttpError(400, 'Nom de dossier vide');
        const found = folderRows().find(
          (c) => c.parent_id === parent && fold(c.name) === fold(name),
        );
        const bad = found ? null : invalidName(name);
        if (bad) throw new HttpError(400, bad);
        if (found?.project)
          throw new HttpError(
            409,
            `« ${found.name} » est un projet : rien n'y entre depuis le Coffre (indivisible)`,
          );
        parent = found
          ? found.id
          : store.create<FolderRow & { updated_at: string }>('folders', emptyFolder(parent, name))
              .id;
      }
      if (!parent) throw new HttpError(400, 'Route vide');
      return parent;
    };

    // --- Labels -----------------------------------------------------------------------

    const labelsOf = (ids: string[]) => {
      const out = new Map<string, LabelDto[]>();
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        const rows = ctx.db
          .prepare(
            `SELECT * FROM ${labels} WHERE deleted_at IS NULL AND item_id IN (${part.map(() => '?').join(',')}) ORDER BY family, value`,
          )
          .all(...part) as LabelRow[];
        for (const r of rows)
          out.set(r.item_id, [
            ...(out.get(r.item_id) ?? []),
            { family: r.family, value: r.value, origin: r.origin, reason: r.reason },
          ]);
      }
      return out;
    };
    const writeLabels = (itemId: string, list: readonly LabelDto[]) => {
      const seen: LabelValue[] = [];
      for (const l of list) {
        if (!LABEL_FAMILIES.includes(l.family) || typeof l.value !== 'string') continue;
        const value = l.value.trim().slice(0, MAX_LABEL);
        if (!value || seen.some((s) => s.family === l.family && fold(s.value) === fold(value)))
          continue;
        seen.push({ family: l.family, value });
        const origin = l.origin === 'chosen' || l.origin === 'default' ? l.origin : 'guessed';
        store.create('labels', {
          item_id: itemId,
          family: l.family,
          value,
          origin,
          reason: origin === 'chosen' ? null : (l.reason ?? null),
        });
      }
    };
    /** All the labels of a file replaced (one transaction); returns the ones before. */
    const replaceLabels = (id: string, list: readonly LabelDto[]): LabelDto[] => {
      const before = labelsOf([id]).get(id) ?? [];
      ctx.db.transaction(() => {
        const rows = ctx.db
          .prepare(`SELECT id FROM ${labels} WHERE deleted_at IS NULL AND item_id = ?`)
          .all(id) as { id: string }[];
        for (const r of rows) store.remove('labels', r.id);
        writeLabels(id, list);
      });
      return before;
    };

    // --- Reading ------------------------------------------------------------------------

    /** The current copy of each entry on the registered disk. */
    const copiesOf = (ids: string[]): Map<string, CopyRow> => {
      const row = disk.disk();
      const out = new Map<string, CopyRow>();
      if (!row) return out;
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        const list = ctx.db
          .prepare(
            `SELECT * FROM ${deps.t.copies} WHERE deleted_at IS NULL AND disk_id = ? AND item_id IN (${part.map(() => '?').join(',')})`,
          )
          .all(row.id, ...part) as CopyRow[];
        for (const c of list) out.set(c.item_id, c);
      }
      return out;
    };
    /** Its file: on the PC, or on the disk for an archived one (null: the disk is absent). */
    const absOf = (row: ItemRow, copy?: CopyRow | null): string | null => {
      if (row.archived_at) {
        const c = copy === undefined ? copiesOf([row.id]).get(row.id) : copy;
        return c && disk.state.root ? disk.abs(disk.state.root, c.rel_path) : null;
      }
      // v0.51.0 F: a project followed in place: its real folder.
      if (row.tracked_path) return row.tracked_path;
      return row.rel_path ? library.abs(row.rel_path) : null;
    };

    // The text of the files (search in the content, ADR 0056).
    const textIndex = new TextIndex({
      ctx,
      items,
      fileOf: (row) => absOf(row),
      projectRootOf: (row) => projects.rootOf(row),
    });
    disk.onChange = () => textIndex.kick(500);

    const dtos = (rows: ItemRow[]): ItemDto[] => {
      const byId = new Map(folderRows().map((c) => [c.id, c]));
      const ids = rows.map((r) => r.id);
      const tags = labelsOf(ids);
      const copies = copiesOf(ids);
      return rows.map((r) => {
        const copy = copies.get(r.id) ?? null;
        const file = absOf(r, copy);
        const servable = r.kind === 'file' && file !== null && existsSync(file);
        let url: string | null = null;
        if (servable)
          try {
            url = ctx.files.mediaUrl(file);
          } catch {
            url = null;
          }
        return {
          id: r.id,
          kind: r.kind,
          name: r.name,
          ext: r.ext,
          size: r.size,
          sha256: r.sha256,
          folderId: r.folder_id,
          folderPath: r.folder_id ? pathOf(byId, r.folder_id) : null,
          inProject: r.kind === 'project',
          pinned: r.pinned === 1,
          trashedAt: r.trashed_at,
          sourcePath: r.source_path,
          sourceSha256: r.source_sha256,
          fileDate: r.file_date,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          labels: tags.get(r.id) ?? [],
          url,
          path: file,
          diskState: stateOf(r, copy),
          unavailable: Boolean(r.archived_at && !file),
          originalName: r.original_name && r.original_name !== r.name ? r.original_name : null,
          tracked: Boolean(r.tracked_path),
        };
      });
    };
    const getRow = (id: string) => {
      const row = store.get<ItemRow & { updated_at: string }>('items', id);
      if (!row) throw new HttpError(404, 'Fichier introuvable');
      return row as ItemRow;
    };
    const one = (id: string) => dtos([getRow(id)])[0]!;
    /** The entry of a Projet folder (its content), or null. */
    const projectItemOf = (folderId: string): ItemRow | null =>
      (ctx.db
        .prepare(
          `SELECT * FROM ${items} WHERE deleted_at IS NULL AND kind = 'project' AND folder_id = ?`,
        )
        .get(folderId) as ItemRow | undefined) ?? null;

    /**
     * v0.51.0: a project's files looked at now (its index, ADR 0068): its
     * fingerprint and size follow. A followed project not found: « introuvable ».
     */
    const refreshProject = async (id: string, signal?: AbortSignal) => {
      const row = getRow(id);
      const r = await projects.refresh(row, { signal });
      if (r.missing) return r;
      if (r.sha256 !== row.sha256 || r.size !== row.size)
        store.update('items', id, { sha256: r.sha256, size: r.size, stat_json: null });
      return r;
    };

    /** Files of a project (its exclusions apart): its index (v0.51.0). */
    const projectCount = (row: ItemRow): number => projects.count(row.id);

    const folderDtos = (): FolderDto[] => {
      const rows = folderRows();
      const byId = new Map(rows.map((c) => [c.id, c]));
      const since = new Date(Date.now() - FRESH_DAYS * 86_400_000).toISOString();
      const list = ctx.db
        .prepare(
          `SELECT * FROM ${items} WHERE deleted_at IS NULL AND trashed_at IS NULL AND folder_id IS NOT NULL`,
        )
        .all() as ItemRow[];
      const own = new Map<string, { n: number; fresh: number }>();
      // v0.51.0 F: the projects followed in place (their real folder, « introuvable »).
      const followed = new Map<string, { path: string; missing: boolean }>();
      for (const r of list) {
        if (r.kind === 'project' && r.tracked_path)
          followed.set(r.folder_id!, { path: r.tracked_path, missing: Boolean(r.missing_at) });
        const c = own.get(r.folder_id!) ?? { n: 0, fresh: 0 };
        c.n += r.kind === 'project' ? projectCount(r) : 1;
        if (r.created_at >= since) c.fresh++;
        own.set(r.folder_id!, c);
      }
      const total = new Map<string, number>();
      for (const [id, c] of own)
        for (let f = byId.get(id), n = 0; f && n < 200; n++) {
          total.set(f.id, (total.get(f.id) ?? 0) + c.n);
          f = f.parent_id ? byId.get(f.parent_id) : undefined;
        }
      /** Under a Fin de route or a Projet (not its own badge). */
      const inside = (c: FolderRow): boolean => {
        for (let p = c.parent_id ? byId.get(c.parent_id) : undefined, n = 0; p && n < 200; n++) {
          if (p.end_of_route || p.project) return true;
          p = p.parent_id ? byId.get(p.parent_id) : undefined;
        }
        return false;
      };
      return rows.map((c) => {
        const p = pathOf(byId, c.id);
        return {
          id: c.id,
          parentId: c.parent_id,
          name: c.name,
          color: c.color,
          css: folderCss(c.color, p[0] ?? c.name),
          sort: c.sort,
          path: p,
          count: own.get(c.id)?.n ?? 0,
          total: total.get(c.id) ?? 0,
          fresh: own.get(c.id)?.fresh ?? 0,
          endOfRoute: c.end_of_route === 1 || c.project === 1,
          project: c.project === 1,
          inside: inside(c),
          defaults: defaultsOf(c),
          courseName: c.course_name ?? null,
          tracked: followed.get(c.id) ?? null,
        };
      });
    };
    const folderDto = (id: string) => {
      const dto = folderDtos().find((c) => c.id === id);
      if (!dto) throw new HttpError(404, 'Dossier introuvable');
      return dto;
    };

    // What the Coffre learns from Thomas's choices (ADR 0061).
    const folderPathOf = (folderId: string): string[] | null => {
      const byId = new Map(folderRows().map((c) => [c.id, c]));
      return byId.has(folderId) ? pathOf(byId, folderId) : null;
    };
    const learner = new Learner(ctx, store, folderPathOf);
    learner.register();
    /** What a placement of this file teaches (its site, its name, its nature). */
    const learnFrom = (row: ItemRow, folderId: string | null, nature?: string | null) => {
      if (row.kind !== 'file') return;
      const own = labelsOf([row.id]).get(row.id) ?? [];
      const site =
        own.find((l) => l.family === 'site')?.value ??
        hostOf(row.referrer_url) ??
        hostOf(row.source_url);
      const kept =
        nature !== undefined ? nature : (own.find((l) => l.family === 'nature')?.value ?? null);
      try {
        learner.learn({ name: row.name, site: site ?? null, ext: row.ext, folderId, nature: kept });
      } catch (error) {
        ctx.logger.warn(`Apprentissage : ${String(error)}`);
      }
    };

    // The folders' tree (move, merge, delete when empty, reorder; ADR 0064, 0067).
    const tree = registerTreeRoutes({
      ctx,
      store,
      library,
      t: { items, folders, rules: ctx.db.table('rules') },
      folderRows,
      folderOf,
      remember: (run) => remember(run),
      busy: () => disk.busy,
    });
    /** Folders created for a route, removed (deepest first) while they are empty. */
    const removeIfEmpty = async (ids: readonly string[]) => {
      const byId = new Map(folderRows().map((c) => [c.id, c]));
      const sorted = ids
        .filter((id) => byId.has(id))
        .sort((a, b) => pathOf(byId, b).length - pathOf(byId, a).length);
      for (const id of sorted) {
        const c = tree.contentOf(id);
        if (!c.items && !c.children) await tree.remove(id).catch(() => undefined);
      }
    };

    ctx.routes.get('/folders', () => folderDtos());
    ctx.routes.get('/folders/:id', (request) => folderDto(uuidParam(request.params)));
    /** « Nouveau dossier »: a name or a route, under a folder or at the top; « Annuler » while empty. */
    ctx.routes.post('/folders', (request) => {
      const b = requestBody(request);
      const parentId = typeof b.parentId === 'string' && b.parentId ? b.parentId : null;
      if (parentId) getFolder(parentId);
      const before = new Set(folderRows().map((c) => c.id));
      const route = Array.isArray(b.route) ? b.route.map(String) : [String(b.name ?? '')];
      const id = ensureFolder(route, parentId);
      if (b.color !== undefined && b.color !== null) {
        if (!isColorValue(b.color)) throw new HttpError(400, 'Couleur invalide');
        store.update('folders', id, { color: String(b.color) });
      }
      // Created on the PC at once (readable in the Explorer).
      try {
        library.ensureDir(folderOf(id));
      } catch (error) {
        ctx.logger.warn(`Dossier non créé sur le PC : ${String(error)}`);
      }
      const made = folderRows()
        .filter((c) => !before.has(c.id))
        .map((c) => c.id);
      // « Annuler » only while they are empty (the deepest first; filled meanwhile: refused).
      const undoId = made.length
        ? remember(async () => {
            for (const m of [...made].reverse()) await tree.remove(m);
          })
        : undefined;
      return { ...folderDto(id), undoId, created: made.length > 0 };
    });
    /** Rename (on the PC too; « Annuler »), colour, « Lié au cours … », default labels. */
    ctx.routes.patch('/folders/:id', async (request) => {
      const id = uuidParam(request.params);
      const row = getFolder(id);
      const b = requestBody(request);
      const was = {
        color: row.color,
        course_name: row.course_name,
        default_labels_json: row.default_labels_json,
      };
      if ('color' in b) {
        if (b.color !== null && !isColorValue(b.color))
          throw new HttpError(400, 'Couleur invalide');
        store.update('folders', id, { color: (b.color as string | null) ?? null });
      }
      if ('courseName' in b) {
        const v = typeof b.courseName === 'string' ? b.courseName.trim().slice(0, 200) : '';
        store.update('folders', id, { course_name: v || null });
      }
      // Its default labels (never applied to the files already there without a click).
      if ('defaults' in b)
        store.update('folders', id, {
          default_labels_json: JSON.stringify(cleanLabels(b.defaults)),
        });
      let renameUndo: string | undefined;
      if (typeof b.name === 'string' && b.name.trim() && b.name.trim() !== row.name)
        renameUndo = await tree.rename(id, b.name);
      const undoId = remember(async () => {
        if (renameUndo) await undo.get(renameUndo)?.run();
        store.update('folders', id, was);
      });
      return { ...folderDto(id), undoId };
    });

    /** The sub-folders of a folder (all depths), deepest first. */
    const descendants = (id: string) => {
      const rows = folderRows();
      const out: FolderRow[] = [];
      const visit = (pid: string) => {
        for (const c of rows.filter((r) => r.parent_id === pid)) {
          visit(c.id);
          out.push(c);
        }
      };
      visit(id);
      return out;
    };
    const filesIn = (ids: readonly string[]) =>
      ids.length
        ? (ctx.db
            .prepare(
              `SELECT * FROM ${items} WHERE deleted_at IS NULL AND folder_id IN (${ids.map(() => '?').join(',')})`,
            )
            .all(...ids) as ItemRow[])
        : [];

    /**
     * « Appliquer aux fichiers déjà présents » — the folder's default labels
     * added to the files already in it and its sub-folders (not those under a
     * nearer folder with its own defaults). `preview`: what would change,
     * nothing written. A chosen label of the same family is never replaced.
     * « Annuler ».
     */
    ctx.routes.post('/folders/:id/defaults/apply', (request) => {
      const id = uuidParam(request.params);
      getFolder(id);
      const b = requestBody(request);
      const rows = folderRows();
      const byId = new Map(rows.map((c) => [c.id, c]));
      const targets = rows
        .filter((c) => {
          for (let f: FolderRow | undefined = c, n = 0; f && n < 200; n++) {
            if (f.id === id) return true;
            if (defaultsOf(f).length) return false;
            f = f.parent_id ? byId.get(f.parent_id) : undefined;
          }
          return false;
        })
        .map((c) => c.id);
      const list = filesIn(targets).filter((r) => r.kind === 'file' && !r.trashed_at);
      const wanted = inheritedDefaults(id);
      const current = labelsOf(list.map((r) => r.id));
      const changes = list
        .map((r) => {
          const own = current.get(r.id) ?? [];
          const chosen = new Set(own.filter((l) => l.origin === 'chosen').map((l) => l.family));
          const add = wanted.filter(
            (w) =>
              !chosen.has(w.family) &&
              !own.some((l) => l.family === w.family && fold(l.value) === fold(w.value)),
          );
          return { id: r.id, name: r.name, own, add };
        })
        .filter((c) => c.add.length);
      if (b.preview === true)
        return { files: changes.length, sample: changes.slice(0, 20).map((c) => c.name) };
      const before = new Map<string, LabelDto[]>();
      for (const c of changes) {
        const families = new Set(c.add.map((a) => a.family));
        before.set(
          c.id,
          replaceLabels(c.id, [
            ...c.own.filter((l) => !(families.has(l.family) && l.origin === 'guessed')),
            ...c.add,
          ]),
        );
      }
      const undoId = remember(async () => {
        for (const [fid, old] of before) replaceLabels(fid, old);
      });
      return { files: changes.length, undoId };
    });

    // --- Badges: « Fin de route » and « Projet » (ADR 0067) ---------------------------

    ctx.routes.post('/folders/:id/end', (request) => {
      const id = uuidParam(request.params);
      const row = getFolder(id);
      const on = requestBody(request).on === true;
      if (row.project && !on)
        throw new HttpError(
          409,
          'Un projet est toujours une fin de route : enlève d’abord « Projet »',
        );
      store.update('folders', id, { end_of_route: on ? 1 : 0 });
      const undoId = remember(
        async () => void store.update('folders', id, { end_of_route: row.end_of_route }),
      );
      return { ...folderDto(id), undoId };
    });

    /**
     * Poser « Projet »: the folder's content becomes ONE entry (the disk copies,
     * archives and checks it whole); its rows (sub-folders, files) are folded
     * into it. Nothing moves on the PC. A project inside a project: refused (only
     * the highest counts). « Annuler » unfolds.
     */
    const foldProject = async (id: string): Promise<() => Promise<void>> => {
      const row = getFolder(id);
      const byId = new Map(folderRows().map((c) => [c.id, c]));
      for (let p = row.parent_id ? byId.get(row.parent_id) : undefined, n = 0; p && n < 200; n++) {
        if (p.project)
          throw new HttpError(
            409,
            `« ${row.name} » est dans le projet « ${p.name} » : seul le plus haut compte`,
          );
        p = p.parent_id ? byId.get(p.parent_id) : undefined;
      }
      const subs = descendants(id);
      const inner = filesIn([id, ...subs.map((s) => s.id)]);
      if (inner.some((r) => r.archived_at))
        throw new HttpError(409, 'Des fichiers de ce dossier sont archivés : réactive-les d’abord');
      if (inner.some((r) => r.kind === 'project'))
        throw new HttpError(
          409,
          'Ce dossier contient déjà un projet : enlève d’abord son badge (seul le plus haut compte)',
        );
      const rel = folderOf(id);
      library.ensureDir(rel);
      const journal: (() => void)[] = [];
      let madeId = '';
      ctx.db.transaction(() => {
        for (const r of inner) {
          store.remove('items', r.id);
          journal.push(() => void store.restore('items', r.id));
        }
        for (const s of subs) {
          store.remove('folders', s.id);
          journal.push(() => void store.restore('folders', s.id));
        }
        const made = store.create<ItemRow & { updated_at: string }>(
          'items',
          emptyItem({
            kind: 'project',
            name: row.name,
            rel_path: rel,
            folder_id: id,
            file_date: new Date().toISOString(),
          }),
        );
        madeId = made.id;
        journal.push(() => void store.remove('items', made.id));
        store.update('folders', id, { project: 1, end_of_route: 1 });
        journal.push(
          () =>
            void store.update('folders', id, {
              project: row.project,
              end_of_route: row.end_of_route,
            }),
        );
      });
      // v0.51.0: its files indexed (its exclusions apart): its fingerprint and size.
      await refreshProject(madeId);
      textIndex.kick();
      return async () => {
        ctx.db.transaction(() => {
          for (const step of [...journal].reverse()) step();
        });
        textIndex.kick();
      };
    };

    /**
     * Enlever « Projet »: the entry is unfolded — the sub-folders (hidden ones
     * apart) and the files become rows again, their labels deduced again.
     * Nothing moves on the PC. « Annuler » folds it back.
     */
    const unfoldProject = async (id: string): Promise<() => Promise<void>> => {
      const row = getFolder(id);
      const entry = projectItemOf(id);
      if (entry?.archived_at)
        throw new HttpError(409, 'Ce projet est archivé : réactive-le d’abord');
      if (entry?.tracked_path)
        throw new HttpError(
          409,
          'Suivi en place : « Le copier dans le Coffre » d’abord (son dossier n’est pas dans le Coffre)',
        );
      if (entry?.trashed_at) throw new HttpError(409, 'Ce projet est dans la corbeille');
      const rel = folderOf(id);
      const abs = library.abs(rel);
      const madeFolders: string[] = [];
      const madeItems: string[] = [];
      const visit = async (dirAbs: string, dirRel: string, folderId: string) => {
        const list = readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) =>
          a.name.localeCompare(b.name, 'fr'),
        );
        for (const e of list) {
          const full = path.join(dirAbs, e.name);
          if (e.isDirectory()) {
            if (isHiddenName(e.name, false)) continue;
            const child = store.create<FolderRow & { updated_at: string }>(
              'folders',
              emptyFolder(folderId, e.name),
            ).id;
            madeFolders.push(child);
            await visit(full, `${dirRel}/${e.name}`, child);
          } else if (e.isFile() && !isIgnoredFile(e.name)) {
            const st = statSync(full);
            const made = store.create<ItemRow & { updated_at: string }>(
              'items',
              emptyItem({
                kind: 'file',
                name: e.name,
                rel_path: `${dirRel}/${e.name}`,
                size: st.size,
                sha256: await hashFile(full),
                ext: extOf(e.name),
                folder_id: folderId,
                file_date: st.mtime.toISOString(),
              }),
            );
            madeItems.push(made.id);
            writeLabels(made.id, proposeLabels(e.name, st.mtime.toISOString(), null, folderId));
          }
        }
      };
      if (existsSync(abs)) await visit(abs, rel, id);
      if (entry) store.remove('items', entry.id);
      store.update('folders', id, { project: 0, end_of_route: 0 });
      textIndex.kick();
      return async () => {
        ctx.db.transaction(() => {
          for (const i of madeItems) store.remove('items', i);
          for (const f of madeFolders) store.remove('folders', f);
          if (entry) store.restore('items', entry.id);
          store.update('folders', id, { project: row.project, end_of_route: row.end_of_route });
        });
        textIndex.kick();
      };
    };

    ctx.routes.post('/folders/:id/project', async (request) => {
      const id = uuidParam(request.params);
      const row = getFolder(id);
      if (disk.busy)
        throw new HttpError(409, `Le disque est occupé (${disk.busy}) : réessaie après`);
      const on = requestBody(request).on === true;
      if (on === (row.project === 1)) return folderDto(id);
      const back = on ? await foldProject(id) : await unfoldProject(id);
      const undoId = remember(back);
      return { ...folderDto(id), undoId };
    });

    /** Why this folder looks like a code project (« .git », « contient du code »…), or null. */
    ctx.routes.get('/folders/:id/hint', (request) => {
      const id = uuidParam(request.params);
      const row = getFolder(id);
      if (row.project) return { project: null };
      const abs = library.abs(folderOf(id));
      if (!existsSync(abs)) return { project: null };
      const entries = readdirSync(abs, { withFileTypes: true }).map((e) => ({
        name: e.name,
        dir: e.isDirectory(),
      }));
      const marker = projectMarker(entries);
      return { project: marker ? projectReason(marker) : null };
    });

    /**
     * The inside of a Fin de route or a Projet — its tree, read from its folder
     * on the PC, to browse it in ToolBox; the README shown by default. Hidden
     * folders only with `hidden=1`; an excluded folder is listed, never read
     * inside. Read only.
     */
    ctx.routes.get('/folders/:id/inside', async (request) => {
      const id = uuidParam(request.params);
      const row = getFolder(id);
      const showHidden = ((request.query ?? {}) as { hidden?: string }).hidden === '1';
      const rel = folderOf(id);
      const project = row.project === 1;
      // v0.51.0: a project's real folder (followed in place, or in the Coffre) and its rules.
      const entry = project ? projectItemOf(id) : null;
      const abs = (entry && projects.rootOf(entry)) || library.abs(rel);
      const rules = entry ? new ProjectRules(abs, projects.choicesOf(entry)) : null;
      const entries: InsideEntryDto[] = [];
      let truncated = false;
      // A Fin de route: its files are rows (their ids open their sheet).
      const known = new Map<string, string>();
      if (!project)
        for (const r of filesIn([id, ...descendants(id).map((s) => s.id)]))
          if (r.rel_path && !r.trashed_at) known.set(r.rel_path.toLowerCase(), r.id);
      const media = (file: string) => {
        try {
          return ctx.files.mediaUrl(file);
        } catch {
          return null;
        }
      };
      const walk = (dirAbs: string, dirRel: string, hiddenAbove: boolean) => {
        let list: import('node:fs').Dirent[];
        try {
          list = readdirSync(dirAbs, { withFileTypes: true });
        } catch {
          return;
        }
        list.sort(
          (a, b) =>
            Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'fr'),
        );
        for (const e of list) {
          if (entries.length >= MAX_INSIDE) {
            truncated = true;
            return;
          }
          if (isIgnoredFile(e.name)) continue;
          const full = path.join(dirAbs, e.name);
          const r = dirRel ? `${dirRel}/${e.name}` : e.name;
          const dir = e.isDirectory();
          // v0.51.0: a project says why it does not save a path (list, .gitignore, Thomas).
          const excludedReason = rules ? rules.reason(r, dir) : null;
          const excluded =
            excludedReason !== null ||
            (!rules && dir && isHiddenName(e.name, project) && !e.name.startsWith('.'));
          const hidden = hiddenAbove || excluded || (dir && isHiddenName(e.name, project));
          if (hidden && !showHidden) continue;
          let size = 0;
          if (!dir)
            try {
              size = statSync(full).size;
            } catch {
              size = 0;
            }
          entries.push({
            rel: r,
            name: e.name,
            dir,
            size,
            hidden,
            excluded,
            excludedReason,
            itemId: known.get(`${rel}/${r}`.toLowerCase()) ?? null,
            url: dir ? null : media(full),
            path: full,
          });
          if (dir && !excluded) walk(full, r, hidden);
        }
      };
      if (existsSync(abs)) walk(abs, '', false);
      const readme =
        entries.find(
          (e) => !e.dir && !e.rel.includes('/') && /^readme(\.(md|markdown|txt))?$/i.test(e.name),
        )?.rel ?? null;
      // v0.51.0 E: branch, last commit and changes not committed — read only, no git command.
      const gitOf = (root: string) => {
        const info = readGit(root);
        return info ? { ...info, changes: null as GitChanges | null } : null;
      };
      const dto: InsideDto = {
        folder: folderDto(id),
        entries,
        readme,
        git: project ? gitOf(abs) : null,
        truncated,
      };
      if (dto.git && entry)
        dto.git.changes = await gitChanges(
          abs,
          projects.files(entry.id).map((x) => x.rel),
        ).catch(() => null);
      return dto;
    });

    // v0.51.0: a project's inside — exclusions, files one by one (ADR 0068).
    registerProjectRoutes({
      ctx,
      store,
      projects,
      getFolder,
      projectItemOf,
      refreshProject,
      remember,
      kick: () => textIndex.kick(),
      getRow,
      dtos,
      labelsOf,
    });
    // v0.51.0 F: the projects followed in place (ADR 0068).
    registerTrackedRoutes({
      ctx,
      store,
      projects,
      getFolder,
      projectItemOf,
      refreshProject,
      remember,
      kick: () => textIndex.kick(),
      getRow,
      dtos,
      labelsOf,
      library,
      diskBusy: () => disk.busy,
    });

    // --- Lists ------------------------------------------------------------------------

    const live = `deleted_at IS NULL`;
    /**
     * GET /files?folder=&deep=1&pending=1&trash=1&family=&value=&state=:
     * a folder's files (deep: with its sub-folders), À ranger, the Recycle
     * Bin, a view by label (« tout ce qui est Python »), a disk state.
     */
    ctx.routes.get('/files', (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const where = [live];
      const args: string[] = [];
      if (q.trash === '1') where.push('trashed_at IS NOT NULL');
      else where.push('trashed_at IS NULL');
      if (q.pending === '1') where.push('folder_id IS NULL');
      if (q.folder) {
        const ids =
          q.deep === '1' ? [q.folder, ...descendants(q.folder).map((d) => d.id)] : [q.folder];
        where.push(`folder_id IN (${ids.map(() => '?').join(',')})`);
        args.push(...ids);
      }
      if (q.family && q.value) {
        where.push(
          `id IN (SELECT item_id FROM ${labels} WHERE deleted_at IS NULL AND family = ? AND value = ? COLLATE NOCASE)`,
        );
        args.push(q.family, q.value);
      }
      const rows = ctx.db
        .prepare(`SELECT * FROM ${items} WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`)
        .all(...args) as ItemRow[];
      const list = dtos(rows);
      if (q.state === 'suggest') {
        const since = new Date(Date.now() - SUGGEST_DAYS * 86_400_000).toISOString();
        const old = new Set(
          rows.filter((r) => !r.pinned && (r.opened_at ?? r.created_at) < since).map((r) => r.id),
        );
        return list.filter((i) => i.diskState === 'active' && old.has(i.id));
      }
      return q.state ? list.filter((i) => i.diskState === q.state) : list;
    });
    ctx.routes.get('/files/:id', (request) => one(uuidParam(request.params)));
    /** The values already used, per family (the label field's suggestions). */
    ctx.routes.get('/labels/values', () => {
      const rows = ctx.db
        .prepare(
          `SELECT DISTINCT l.family, l.value FROM ${labels} l JOIN ${items} i ON i.id = l.item_id WHERE l.deleted_at IS NULL AND i.deleted_at IS NULL ORDER BY l.value COLLATE NOCASE`,
        )
        .all() as { family: string; value: string }[];
      const out: Record<string, string[]> = {};
      for (const r of rows) (out[r.family] ??= []).push(r.value);
      return out;
    });

    ctx.routes.get('/home', async (): Promise<HomeDto> => {
      const rows = ctx.db
        .prepare(
          `SELECT * FROM ${items} WHERE ${live} AND trashed_at IS NULL ORDER BY updated_at DESC`,
        )
        .all() as ItemRow[];
      const pinned = rows.filter((r) => r.pinned === 1);
      const recent = rows.filter((r) => r.pinned !== 1 && r.folder_id !== null).slice(0, 12);
      const pcDisk = await library.disk();
      const copies = copiesOf(rows.map((r) => r.id));
      const states = rows.map((r) => stateOf(r, copies.get(r.id) ?? null));
      const trashCount = (
        ctx.db
          .prepare(`SELECT COUNT(*) AS n FROM ${items} WHERE ${live} AND trashed_at IS NOT NULL`)
          .get() as { n: number }
      ).n;
      const byId = new Map(folderRows().map((c) => [c.id, c]));
      const pendingByFolder: Record<string, number> = {};
      rows.forEach((r, i) => {
        if (states[i] !== 'pending' || !r.folder_id) return;
        for (let f = byId.get(r.folder_id), n = 0; f && n < 200; n++) {
          pendingByFolder[f.id] = (pendingByFolder[f.id] ?? 0) + 1;
          f = f.parent_id ? byId.get(f.parent_id) : undefined;
        }
      });
      return {
        pinned: dtos(pinned),
        recent: dtos(recent),
        pendingCount: rows.filter((r) => r.folder_id === null).length,
        folders: folderDtos(),
        pendingByFolder,
        health: {
          items: rows.length,
          // On the PC (an archived one is on the disk only).
          bytes: rows.filter((r) => !r.archived_at).reduce((s, r) => s + r.size, 0),
          diskFree: pcDisk.free,
          diskTotal: pcDisk.total,
          trashCount,
          pending: states.filter((st) => st === 'pending').length,
          archived: states.filter((st) => st === 'archived').length,
          index: textIndex.status(),
          // v0.51.0 F: a project followed in place is looked for in its own folder.
          missingOnPc: rows.filter((r) => {
            if (r.archived_at || !r.rel_path) return false;
            const file = absOf(r);
            return !file || !existsSync(file);
          }).length,
        },
      };
    });

    // --- Depositing -------------------------------------------------------------------

    const folderRefs = (): FolderRef[] => {
      const rows = folderRows();
      const byId = new Map(rows.map((c) => [c.id, c]));
      return rows.filter((c) => !c.project).map((c) => ({ id: c.id, path: pathOf(byId, c.id) }));
    };
    const sitesSeen = () =>
      ctx.db
        .prepare(
          `SELECT l.value AS host, i.folder_id AS folderId FROM ${labels} l JOIN ${items} i ON i.id = l.item_id WHERE l.deleted_at IS NULL AND i.deleted_at IS NULL AND i.trashed_at IS NULL AND l.family = 'site' AND i.folder_id IS NOT NULL`,
        )
        .all() as { host: string; folderId: string }[];
    const duplicateOf = (sha: string | null) => {
      if (!sha) return null;
      const row = ctx.db
        .prepare(`SELECT * FROM ${items} WHERE ${live} AND sha256 = ? ORDER BY created_at LIMIT 1`)
        .get(sha) as ItemRow | undefined;
      if (!row) return null;
      const dto = dtos([row])[0]!;
      return { id: dto.id, name: dto.name, folderPath: dto.folderPath };
    };
    const coursesSafe = () => {
      try {
        return agenda()?.courses() ?? [];
      } catch (error) {
        ctx.logger.warn(`Cours de l'Agenda illisibles : ${String(error)}`);
        return [];
      }
    };
    /**
     * « Maintenant » — the course of the Agenda in progress or starting within
     * 15 minutes, its folder and that folder's files (most recent first). Null
     * without the Agenda, or with no course now. Read only.
     */
    ctx.routes.get('/now', (): NowDto | null => {
      let list: ReturnType<NonNullable<AgendaService['coursesNow']>> = [];
      try {
        list = agenda()?.coursesNow?.(15) ?? [];
      } catch (error) {
        ctx.logger.warn(`Cours de l'Agenda illisibles : ${String(error)}`);
      }
      const course = list[0];
      if (!course) return null;
      const folder = folderOfCourse(folderDtos(), course);
      let rows: ItemRow[] = [];
      if (folder)
        rows = ctx.db
          .prepare(
            `SELECT * FROM ${items} WHERE deleted_at IS NULL AND trashed_at IS NULL AND folder_id = ?
             ORDER BY MAX(COALESCE(opened_at, ''), created_at, updated_at) DESC LIMIT 12`,
          )
          .all(folder.id) as ItemRow[];
      return {
        course: {
          name: course.name,
          code: course.code,
          start: course.start,
          end: course.end,
          location: course.location,
          inProgress: course.inProgress,
        },
        folder,
        items: dtos(rows),
      };
    });
    /** The Agenda's courses (a course folder's header), empty without the Agenda. */
    ctx.routes.get('/courses', (): CourseHint[] => coursesSafe());

    /**
     * The labels proposed for a file (nothing written): its folder's default
     * labels first (the nearest), then the deductions and what was learned for
     * the families the defaults leave free.
     */
    const proposeLabels = (
      name: string,
      fileDate: string | null,
      provenance: ReturnType<typeof ctx.files.provenance>,
      folderId: string | null,
    ): LabelDto[] => {
      const deduced = deduce({
        name,
        isDirectory: false,
        fileDate,
        provenance,
        folders: folderRefs(),
        courses: coursesSafe(),
        sites: sitesSeen(),
      });
      const learned = applyRules(
        deduced,
        learner.rules(),
        {
          name,
          site: hostOf(provenance?.referrerUrl) ?? hostOf(provenance?.hostUrl),
          ext: extOf(name),
        },
        folderPathOf,
      );
      return mergeGuesses(inheritedDefaults(folderId), learned.labels);
    };

    // Depositing = background tasks (analysis, rangement; backend/deposit.ts).
    const deposits = registerDeposit({
      ctx,
      store,
      library,
      folderRows,
      ensureFolder: (names, parentId) => ensureFolder(names, parentId),
      folderOf,
      propose: (abs, folderId) => {
        const st = statSync(abs);
        const name = path.basename(abs);
        const provenance = st.isDirectory() ? null : ctx.files.provenance(abs);
        const deduced = deduce({
          name,
          isDirectory: st.isDirectory(),
          fileDate: st.mtime.toISOString(),
          provenance,
          folders: folderRefs(),
          courses: coursesSafe(),
          sites: sitesSeen(),
        });
        const learned = applyRules(
          deduced,
          learner.rules(),
          {
            name,
            site: hostOf(provenance?.referrerUrl) ?? hostOf(provenance?.hostUrl),
            ext: st.isDirectory() ? '' : extOf(name),
          },
          folderPathOf,
        );
        const target = folderId ?? (learned.route?.kind === 'existing' ? learned.route.id : null);
        const result: Pick<ProposalDto, 'route' | 'labels'> = {
          route: learned.route,
          // A folder: what applies to all its files (each file gets its own deductions too).
          labels: st.isDirectory()
            ? learned.labels.filter((l) => l.family === 'course' || l.family === 'prof')
            : mergeGuesses(inheritedDefaults(target), learned.labels),
        };
        return result;
      },
      proposeLabels,
      duplicateOf,
      writeLabels: (id, list) => writeLabels(id, list),
      refreshProject: (id, signal) => refreshProject(id, signal),
      learnFrom: (row, folderId) => learnFrom(row, folderId),
      remember: (run) => remember(run),
      removeIfEmpty: (ids) => removeIfEmpty(ids),
      dtos,
      getRow,
      hasItemAt: (rel) =>
        Boolean(
          ctx.db
            .prepare(
              `SELECT 1 FROM ${items} WHERE deleted_at IS NULL AND rel_path = ? COLLATE NOCASE`,
            )
            .get(rel),
        ),
      hasTrackedAt: (abs) =>
        Boolean(
          ctx.db
            .prepare(
              `SELECT 1 FROM ${items} WHERE deleted_at IS NULL AND tracked_path = ? COLLATE NOCASE`,
            )
            .get(path.resolve(abs)),
        ),
      after: (paths, created) => {
        if (created) textIndex.kick();
        // A new download put away is no longer proposed.
        downloads.ranged(paths);
      },
    });

    // The disk's update waits for a deposit running.
    disk.waitsFor = () => deposits.busy();
    // « Réinitialiser le Coffre » (backend/reset.ts).
    const reset = registerReset(deps, disk, {
      dtos,
      fileOf: (row) => absOf(row),
      clearDerived: () => {
        for (const table of ['text', 'text_state', 'downloads'])
          ctx.db.prepare(`DELETE FROM ${ctx.db.table(table)}`).run();
      },
    });
    disk.refuses = () =>
      reset.diskPending()
        ? 'Le Coffre a été réinitialisé : renomme d’abord son ancien dossier sur ce disque (Gestion)'
        : null;

    // --- « Nouveau fichier… » ---------------------------------------------------------

    /**
     * POST /files/create { folderId | null, name }: an EMPTY file with the name
     * and extension typed (valid on Windows; refused when the name is taken:
     * never over another), its labels proposed (the folder's defaults first).
     * Returns how to open it (code → VS Code; else its application; a program or
     * a script: never launched without a confirmation).
     */
    ctx.routes.post('/files/create', async (request) => {
      const b = requestBody(request);
      const folderId = typeof b.folderId === 'string' && b.folderId ? b.folderId : null;
      const raw = String(b.name ?? '').trim();
      if (!raw) throw new HttpError(400, 'Nom de fichier vide');
      if (!splitExtension(raw).ext)
        throw new HttpError(400, `« ${raw} » : tape aussi son extension (notes.md, main.py…)`);
      const name = safeName(raw);
      if (name !== raw)
        throw new HttpError(400, `« ${raw} » : nom refusé par Windows (essaie « ${name} »)`);
      if (folderId && getFolder(folderId).project)
        throw new HttpError(409, 'Dans un projet, crée le fichier dans VS Code (indivisible)');
      const dir = folderOf(folderId);
      library.ensureDir(dir);
      const target = path.join(library.abs(dir), name);
      if (existsSync(target) || library.freeIn(library.abs(dir), name) !== name)
        throw new HttpError(409, `« ${name} » existe déjà ici : choisis un autre nom`);
      const handle = await openFile(target, 'wx');
      await handle.close();
      const st = statSync(target);
      const row = store.create<ItemRow & { updated_at: string }>(
        'items',
        emptyItem({
          kind: 'file',
          name,
          rel_path: `${dir}/${name}`,
          sha256: await hashFile(target),
          ext: extOf(name),
          folder_id: folderId,
          file_date: st.mtime.toISOString(),
        }),
      );
      writeLabels(row.id, [
        ...proposeLabels(name, st.mtime.toISOString(), null, folderId).filter(
          (l) => l.family !== 'origin',
        ),
        {
          family: 'origin',
          value: 'fait par moi',
          origin: 'guessed',
          reason: 'créé dans le Coffre',
        },
      ]);
      const undoId = remember(async () => {
        const now = getRow(row.id);
        // Still empty: it goes to the Recycle Bin of Windows; written in meanwhile: kept.
        if (now.rel_path && library.exists(now.rel_path)) {
          if (statSync(library.abs(now.rel_path)).size > 0)
            throw new HttpError(409, `« ${now.name} » n’est plus vide : il reste`);
          await ctx.files.trash(library.abs(now.rel_path));
        }
        store.remove('items', row.id);
      });
      return {
        item: one(row.id),
        undoId,
        open: kindOf(name)?.language ? 'vscode' : isRunnable(target) ? 'confirm' : 'app',
      };
    });

    // --- Changing a file ----------------------------------------------------------------

    /**
     * Moves and / or renames a file: its file follows (one block, back on a
     * failure); archived, only its row (the disk follows at the next update).
     * `target`: its new folder (null: À ranger), or undefined (unchanged).
     * A project's content moves only with its folder (indivisible).
     * Returns what puts it back (« Annuler »).
     */
    const relocate = async (
      id: string,
      target: string | null | undefined,
      wantedName: string | null,
    ): Promise<() => Promise<void>> => {
      const row = getRow(id);
      if (row.kind === 'project')
        throw new HttpError(
          409,
          'Un projet se déplace et se renomme avec son dossier (indivisible)',
        );
      const fields: Record<string, string | number | null> = {};
      const folderChange = target !== undefined;
      const folderId = folderChange ? target : row.folder_id;
      if (folderChange) {
        if (folderId && getFolder(folderId).project)
          throw new HttpError(
            409,
            `« ${getFolder(folderId).name} » est un projet : rien n'y entre depuis le Coffre`,
          );
        fields.folder_id = folderId;
      }
      const newName = wantedName?.trim() ? safeName(wantedName) : null;
      const renamed = newName !== null && newName !== row.name;
      const before = { rel: row.rel_path, undo: { ...row } };
      let moved: string | null = null;
      if (row.archived_at && row.rel_path && (folderChange || renamed)) {
        const dir = folderOf(folderId);
        const free = library.freeIn(library.abs(dir), newName ?? row.name);
        fields.rel_path = `${dir}/${free}`;
        fields.name = free;
      } else if (row.rel_path && (folderChange || renamed)) {
        moved = await library.move(row.rel_path, folderOf(folderId), newName ?? row.name);
        fields.rel_path = moved;
        fields.name = path.posix.basename(moved);
      } else if (newName) fields.name = newName;
      // Renamed: the first name is kept (searchable).
      if (fields.name !== undefined && fields.name !== row.name && !row.original_name)
        fields.original_name = row.name;
      try {
        if (Object.keys(fields).length) store.update('items', id, fields);
        // Moved by Thomas into another folder: the rules learn the correction.
        if (folderChange && folderId !== row.folder_id) learnFrom(getRow(id), folderId);
      } catch (error) {
        if (moved && before.rel) {
          const back = path.posix.dirname(before.rel);
          await library.move(moved, back === '.' ? '' : back, path.posix.basename(before.rel));
        }
        throw error;
      }
      return async () => {
        const now = getRow(id);
        const restore: Record<string, string | number | null> = {
          folder_id: before.undo.folder_id,
          name: before.undo.name,
          original_name: before.undo.original_name,
        };
        if (now.archived_at) restore.rel_path = before.rel;
        else if (now.rel_path && before.rel && now.rel_path !== before.rel) {
          const back = path.posix.dirname(before.rel);
          restore.rel_path = await library.move(
            now.rel_path,
            back === '.' ? '' : back,
            path.posix.basename(before.rel),
          );
          restore.name = path.posix.basename(String(restore.rel_path));
        }
        store.update('items', id, restore);
      };
    };

    /** A folder given as `folderId`, `newFolder` (a route created now) or `later` (À ranger). */
    const targetOf = (b: Record<string, unknown>): string | null | undefined => {
      if (b.later === true) return null;
      if (Array.isArray(b.newFolder) && b.newFolder.length)
        return ensureFolder(b.newFolder.map(String));
      if ('folderId' in b) return typeof b.folderId === 'string' && b.folderId ? b.folderId : null;
      return undefined;
    };

    /** Name, folder (the file moves: one transaction, back on failure), pinned. */
    ctx.routes.patch('/files/:id', async (request) => {
      const id = uuidParam(request.params);
      const row = getRow(id);
      if (row.trashed_at) throw new HttpError(409, 'Dans la corbeille : le récupérer d’abord');
      const b = requestBody(request);
      const target = targetOf(b);
      const name = typeof b.name === 'string' && b.name.trim() ? b.name : null;
      const put =
        target !== undefined || name ? await relocate(id, target, name) : async () => undefined;
      const pinned = row.pinned;
      if (typeof b.pinned === 'boolean') store.update('items', id, { pinned: b.pinned ? 1 : 0 });
      const undoId = remember(async () => {
        await put();
        store.update('items', id, { pinned });
      });
      return { item: one(id), undoId };
    });

    /**
     * « Modifier la sélection » / « Pour tous » — one setting for several files
     * already stored: their folder (a route created now), one value for nature,
     * origin or year (empty removes), free labels added / removed, labels added
     * (a named set), their names (computed by the page from the template).
     * Every value is « choisi ». All or nothing; ONE « Annuler » for the lot.
     */
    ctx.routes.post('/files/batch', async (request) => {
      const b = requestBody(request);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(String);
      if (!ids.length) throw new HttpError(400, 'Aucun fichier choisi');
      if (ids.length > 2000) throw new HttpError(400, 'Trop de fichiers à la fois');
      for (const id of ids) {
        const row = getRow(id);
        if (row.trashed_at) throw new HttpError(409, `« ${row.name} » est dans la corbeille`);
      }
      const names = (b.names && typeof b.names === 'object' ? b.names : {}) as Record<
        string,
        unknown
      >;
      const set = (b.set && typeof b.set === 'object' ? b.set : {}) as Record<string, unknown>;
      const freeAdd = (Array.isArray(b.freeAdd) ? b.freeAdd : []).map((t) => String(t).trim());
      const freeRemove = (Array.isArray(b.freeRemove) ? b.freeRemove : []).map((t) =>
        String(t).trim().toLowerCase(),
      );
      const add = cleanLabels(b.add);
      const foldersBefore = new Set(folderRows().map((c) => c.id));
      const journal: (() => Promise<void> | void)[] = [];
      try {
        const target = targetOf(b);
        for (const id of ids) {
          const name = typeof names[id] === 'string' ? (names[id] as string) : null;
          if (target !== undefined || name) journal.push(await relocate(id, target, name));
          let list = labelsOf([id]).get(id) ?? [];
          for (const family of ['nature', 'origin', 'year'] as const) {
            if (!(family in set)) continue;
            const v = set[family];
            const value = typeof v === 'string' ? v.trim() : '';
            list = [
              ...list.filter((l) => l.family !== family),
              ...(value ? [{ family, value, origin: 'chosen' as const, reason: null }] : []),
            ];
          }
          if (freeAdd.length || freeRemove.length) {
            const kept = list.filter(
              (l) => l.family !== 'free' || !freeRemove.includes(l.value.toLowerCase()),
            );
            const added = freeAdd
              .filter(Boolean)
              .filter(
                (t) =>
                  !kept.some(
                    (l) => l.family === 'free' && l.value.toLowerCase() === t.toLowerCase(),
                  ),
              )
              .map((value) => ({
                family: 'free' as const,
                value,
                origin: 'chosen' as const,
                reason: null,
              }));
            list = [...kept, ...added];
          }
          for (const a of add)
            if (!list.some((l) => l.family === a.family && fold(l.value) === fold(a.value)))
              list.push({ ...a, origin: 'chosen', reason: null });
          const old = replaceLabels(id, list);
          journal.push(() => void replaceLabels(id, old));
        }
      } catch (error) {
        for (const step of [...journal].reverse()) await step();
        await removeIfEmpty(
          folderRows()
            .filter((c) => !foldersBefore.has(c.id))
            .map((c) => c.id),
        );
        throw error;
      }
      const newFolders = folderRows()
        .filter((c) => !foldersBefore.has(c.id))
        .map((c) => c.id);
      const undoId = remember(async () => {
        for (const step of [...journal].reverse()) await step();
        await removeIfEmpty(newFolders);
      });
      return { items: dtos(ids.map((id) => getRow(id))), undoId };
    });

    /**
     * « Coller les étiquettes » (Ctrl+Maj+V) on one or more files: `add` keeps
     * theirs and adds these (a pasted value replaces a guess of its family);
     * `replace` puts exactly these. Pasted labels are « choisi ». ONE « Annuler ».
     */
    ctx.routes.post('/files/labels/paste', (request) => {
      const b = requestBody(request);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(String);
      if (!ids.length) throw new HttpError(400, 'Aucun fichier choisi');
      const pasted = cleanLabels(b.labels);
      if (!pasted.length) throw new HttpError(400, 'Aucune étiquette à coller');
      const mode = b.mode === 'replace' ? 'replace' : 'add';
      for (const id of ids) getRow(id);
      const chosen = pasted.map((l) => ({ ...l, origin: 'chosen' as const, reason: null }));
      const families = new Set(chosen.map((c) => c.family));
      const before = new Map<string, LabelDto[]>();
      for (const id of ids) {
        const own = labelsOf([id]).get(id) ?? [];
        const next =
          mode === 'replace'
            ? chosen
            : [
                ...own.filter(
                  (l) =>
                    !chosen.some((c) => c.family === l.family && fold(c.value) === fold(l.value)) &&
                    !(l.origin === 'guessed' && l.family !== 'free' && families.has(l.family)),
                ),
                ...chosen,
              ];
        before.set(id, replaceLabels(id, next));
      }
      const undoId = remember(async () => {
        for (const [id, old] of before) replaceLabels(id, old);
      });
      return { items: dtos(ids.map((id) => getRow(id))), undoId };
    });

    /**
     * PUT /files/:id/labels { family, values }: Thomas's values for a family
     * (« choisi »: never replaced by a deduction); no value removes the family.
     */
    ctx.routes.put('/files/:id/labels', (request) => {
      const id = uuidParam(request.params);
      const row = getRow(id);
      const b = requestBody(request);
      const family = String(b.family) as LabelFamily;
      if (!LABEL_FAMILIES.includes(family))
        throw new HttpError(400, 'Famille d’étiquettes inconnue');
      const values = (Array.isArray(b.values) ? b.values : [])
        .map((v) => String(v).trim().slice(0, MAX_LABEL))
        .filter(Boolean);
      const own = labelsOf([id]).get(id) ?? [];
      const before = replaceLabels(id, [
        ...own.filter((l) => l.family !== family),
        ...values.map((value) => ({ family, value, origin: 'chosen' as const, reason: null })),
      ]);
      // A nature chosen in a folder: « .pdf in Thermo = synthèse » learns it.
      if (family === 'nature' && values[0] && row.folder_id)
        try {
          learner.learn({
            name: '',
            site: null,
            ext: row.ext,
            folderId: row.folder_id,
            nature: values[0],
          });
        } catch (error) {
          ctx.logger.warn(`Apprentissage : ${String(error)}`);
        }
      const undoId = remember(async () => void replaceLabels(id, before));
      return { item: one(id), undoId };
    });

    /** Re-run the deductions on a file: Thomas's choices and the defaults are kept. */
    ctx.routes.post('/files/:id/guess', (request) => {
      const id = uuidParam(request.params);
      const row = getRow(id);
      const current = labelsOf([id]).get(id) ?? [];
      const guessed = proposeLabels(
        row.name,
        row.file_date,
        row.source_url || row.referrer_url
          ? { zone: 3, hostUrl: row.source_url, referrerUrl: row.referrer_url }
          : null,
        row.folder_id,
      ).filter((l) => l.origin === 'guessed');
      replaceLabels(id, mergeGuesses(current, guessed));
      return one(id);
    });

    // --- Named sets of labels ---------------------------------------------------------

    const setDtos = (): LabelSetDto[] =>
      (
        ctx.db
          .prepare(
            `SELECT * FROM ${labelSets} WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
          )
          .all() as LabelSetRow[]
      ).map((r) => {
        let list: LabelValue[];
        try {
          list = cleanLabels(JSON.parse(r.labels_json));
        } catch {
          list = [];
        }
        return { id: r.id, name: r.name, labels: list };
      });
    const setName = (v: unknown) => {
      const name = String(v ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
      if (!name) throw new HttpError(400, 'Nom de l’ensemble vide');
      return name;
    };
    ctx.routes.get('/label-sets', () => setDtos());
    ctx.routes.post('/label-sets', (request) => {
      const b = requestBody(request);
      const list = cleanLabels(b.labels);
      if (!list.length) throw new HttpError(400, 'Un ensemble a au moins une étiquette');
      const name = setName(b.name);
      if (setDtos().some((s) => fold(s.name) === fold(name)))
        throw new HttpError(409, `Un ensemble « ${name} » existe déjà`);
      const row = store.create('label_sets', { name, labels_json: JSON.stringify(list) });
      return setDtos().find((s) => s.id === row.id);
    });
    ctx.routes.patch('/label-sets/:id', (request) => {
      const id = uuidParam(request.params);
      const b = requestBody(request);
      if (!setDtos().some((s) => s.id === id)) throw new HttpError(404, 'Ensemble introuvable');
      const fields: Record<string, string> = {};
      if ('name' in b) {
        const name = setName(b.name);
        if (setDtos().some((s) => s.id !== id && fold(s.name) === fold(name)))
          throw new HttpError(409, `Un ensemble « ${name} » existe déjà`);
        fields.name = name;
      }
      if ('labels' in b) fields.labels_json = JSON.stringify(cleanLabels(b.labels));
      store.update('label_sets', id, fields);
      return setDtos().find((s) => s.id === id);
    });
    ctx.routes.delete('/label-sets/:id', (request) => {
      const id = uuidParam(request.params);
      if (!setDtos().some((s) => s.id === id)) throw new HttpError(404, 'Ensemble introuvable');
      store.remove('label_sets', id);
      const undoId = remember(async () => void store.restore('label_sets', id));
      return { ok: true, undoId };
    });

    // --- The Coffre's Recycle Bin (règle 3) -------------------------------------------

    /** A project goes with its folder (indivisible): the folder leaves the map. */
    const trash = async (row: ItemRow) => {
      let relPath = row.rel_path;
      // v0.51.0 F: a project followed in place — « Retirer du Coffre »: it is no longer
      // followed; its real folder is never touched (its disk copy goes to the disk's bin).
      if (!row.tracked_path && row.rel_path && library.exists(row.rel_path))
        relPath = await library.move(row.rel_path, `${TRASH_FOLDER}/${row.id}`);
      store.update('items', row.id, {
        trashed_at: new Date().toISOString(),
        trash_from: row.rel_path ? path.posix.dirname(row.rel_path) : null,
        rel_path: relPath,
        pinned: 0,
      });
      if (row.kind === 'project' && row.folder_id) store.remove('folders', row.folder_id);
    };
    const restore = async (row: ItemRow) => {
      if (row.kind === 'project' && row.folder_id) store.restore('folders', row.folder_id);
      const folderOk = Boolean(row.folder_id && folderRows().some((c) => c.id === row.folder_id));
      // A project: back as its folder (its parent's place); a file: in its folder, else À ranger.
      let dir = folderOk ? folderOf(row.folder_id) : PENDING_FOLDER;
      if (row.kind === 'project' && folderOk) {
        const parent = path.posix.dirname(dir);
        dir = parent === '.' ? '' : parent;
      }
      let relPath = row.rel_path;
      if (row.tracked_path && folderOk) relPath = folderOf(row.folder_id);
      else if (row.rel_path && library.exists(row.rel_path))
        relPath = await library.move(row.rel_path, dir);
      store.update('items', row.id, {
        trashed_at: null,
        trash_from: null,
        rel_path: relPath,
        ...(folderOk ? {} : { folder_id: null }),
      });
    };
    ctx.routes.delete('/files/:id', async (request) => {
      const id = uuidParam(request.params);
      const row = getRow(id);
      if (row.trashed_at) throw new HttpError(409, 'Déjà dans la corbeille');
      await trash(row);
      const undoId = remember(async () => restore(getRow(id)));
      return { ok: true, undoId };
    });
    /** A Projet folder to the Recycle Bin: whole (indivisible). */
    ctx.routes.delete('/folders/:id/project', async (request) => {
      const id = uuidParam(request.params);
      const entry = projectItemOf(id);
      if (!entry) throw new HttpError(409, 'Ce dossier n’est pas un projet');
      await trash(entry);
      const undoId = remember(async () => restore(getRow(entry.id)));
      return { ok: true, undoId };
    });
    ctx.routes.post('/files/:id/restore', async (request) => {
      const id = uuidParam(request.params);
      const row = getRow(id);
      if (!row.trashed_at) return one(id);
      await restore(row);
      return one(id);
    });
    /** Erase for good (only from the Recycle Bin, and only when the page confirmed). */
    ctx.routes.post('/files/:id/erase', async (request) => {
      const id = uuidParam(request.params);
      const row = getRow(id);
      if (!row.trashed_at) throw new HttpError(409, 'Seulement depuis la corbeille du Coffre');
      if (requestBody(request).confirm !== true)
        throw new HttpError(400, 'Effacement définitif : confirmation nécessaire');
      // An archived one has no file on the PC: its path may be another's now.
      // v0.51.0 F: a project followed in place: its real folder is never erased.
      if (row.rel_path && !row.archived_at && !row.tracked_path) await library.erase(row.rel_path);
      const trashDir = `${TRASH_FOLDER}/${row.id}`;
      if (library.exists(trashDir)) await library.erase(trashDir);
      // A copy on the disk goes to the disk's Recycle Bin at the next update and can be
      // recovered from there: its labels are kept with it.
      const onDisk = copiesOf([id]).has(id);
      ctx.db.transaction(() => {
        if (!onDisk) {
          const rows = ctx.db
            .prepare(`SELECT id FROM ${labels} WHERE deleted_at IS NULL AND item_id = ?`)
            .all(id) as { id: string }[];
          for (const r of rows) store.remove('labels', r.id);
        }
        store.remove('items', id);
      });
      return { ok: true, onDisk };
    });

    ctx.routes.post('/undo', async (request) => {
      const id = String(requestBody(request).undoId ?? '');
      const entry = undo.get(id);
      if (!entry) throw new HttpError(410, 'Trop tard pour annuler');
      undo.delete(id);
      await entry.run();
      return { ok: true };
    });

    // --- Opening (règle 4) --------------------------------------------------------------

    /** VS Code's program, when it is installed (Windows' usual places). */
    const vscode = (): string | null => {
      const candidates = [
        process.env.LOCALAPPDATA &&
          path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        process.env.ProgramFiles &&
          path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
        process.env['ProgramFiles(x86)'] &&
          path.join(process.env['ProgramFiles(x86)']!, 'Microsoft VS Code', 'Code.exe'),
      ].filter((p): p is string => Boolean(p));
      return candidates.find((p) => existsSync(p)) ?? null;
    };
    /**
     * VS Code on `target`; v0.51.0: a file inside a project opens with its
     * project (`folder`) and at its line (`-g file:line`).
     */
    const openInVsCode = (target: string, at?: { folder: string; line?: number | null }) => {
      const exe = vscode();
      if (!exe) throw new HttpError(404, 'VS Code n’est pas installé');
      const args =
        at && at.folder !== target
          ? [at.folder, '-g', at.line ? `${target}:${at.line}` : target]
          : [target];
      const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
      // A program that cannot start must never stop ToolBox (an error is only logged).
      child.on('error', (error) => ctx.logger.warn(`VS Code : ${String(error)}`));
      child.unref();
      return { ok: true, args };
    };
    ctx.routes.get('/tools', () => ({
      vscode: vscode() !== null,
      animations: ctx.settings.get<boolean>('animations') !== false,
      root: library.root,
    }));

    /**
     * POST /files/:id/open { how: 'app' | 'folder' | 'vscode' | 'readcopy', runnable? }:
     * its application (Windows'), its folder in the Explorer, or VS Code. A
     * program or a script only with `runnable: true` (the page asked, naming it).
     */
    ctx.routes.post('/files/:id/open', async (request) => {
      const row = getRow(uuidParam(request.params));
      const file = absOf(row);
      if (row.archived_at && !file)
        throw new HttpError(
          409,
          `Branche le disque « ${disk.disk()?.name ?? 'du coffre'} » pour l’ouvrir`,
        );
      if (!file || !existsSync(file)) throw new HttpError(404, 'Fichier introuvable sur le disque');
      const b = requestBody(request);
      // When it was last opened (« pas ouverts depuis 6 mois »: a suggestion only).
      store.update('items', row.id, { opened_at: new Date().toISOString() });
      if (b.how === 'folder') {
        ctx.files.reveal(file);
        return { ok: true };
      }
      // An archived one is not modified: reactivate it, or open a read-only copy.
      if (row.archived_at && b.how !== 'readcopy')
        throw new HttpError(
          409,
          'Archivé : « Réactiver pour le modifier » ou « Ouvrir une copie en lecture »',
        );
      if (b.how === 'readcopy') {
        if (!row.archived_at) throw new HttpError(400, 'Seulement pour un fichier archivé');
        if (isRunnable(file) && b.runnable !== true)
          throw new HttpError(
            409,
            `« ${path.basename(file)} » ${mountsDisk(file) ? 'monte une image de disque' : 'lance un programme'} : confirmation nécessaire`,
          );
        const copy = await readCopy(file, row.id);
        await ctx.files.open(copy, { runnable: b.runnable === true });
        return { ok: true, copy };
      }
      if (b.how === 'vscode') return openInVsCode(file);
      if (isRunnable(file) && b.runnable !== true)
        throw new HttpError(
          409,
          `« ${path.basename(file)} » lance un programme : confirmation nécessaire`,
        );
      await ctx.files.open(file, { runnable: b.runnable === true });
      return { ok: true };
    });
    /**
     * A folder opened outside ToolBox, on request: VS Code (a project), the
     * Explorer, or one file of its inside (`rel`, under the folder). Code goes
     * to VS Code, never to its application (v0.47.1); a program: confirmed.
     */
    ctx.routes.post('/folders/:id/open', async (request) => {
      const id = uuidParam(request.params);
      const folder = getFolder(id);
      const b = requestBody(request);
      // v0.51.0: a project's real folder (followed in place, or in the Coffre).
      const entry = folder.project ? projectItemOf(id) : null;
      const abs = (entry && projects.rootOf(entry)) || library.abs(folderOf(id));
      let target = abs;
      if (typeof b.rel === 'string' && b.rel) {
        target = path.resolve(abs, ...b.rel.split('/'));
        if (!target.startsWith(abs + path.sep)) throw new HttpError(400, 'Chemin refusé');
      }
      if (!existsSync(target)) throw new HttpError(404, 'Introuvable sur le PC');
      const line = Number(b.line) > 0 ? Math.floor(Number(b.line)) : null;
      const inProject = entry ? { folder: abs, line } : undefined;
      if (b.how === 'vscode') return openInVsCode(target, inProject);
      if (b.how === 'folder') {
        ctx.files.reveal(target);
        return { ok: true };
      }
      if (kindOf(path.basename(target))?.language) return openInVsCode(target, inProject);
      if (isRunnable(target) && b.runnable !== true)
        throw new HttpError(
          409,
          `« ${path.basename(target)} » lance un programme : confirmation nécessaire`,
        );
      await ctx.files.open(target, { runnable: b.runnable === true });
      return { ok: true };
    });

    /** « Lire en plein écran » — a reading window of its own (ADR 0058). */
    ctx.routes.post('/files/:id/read-window', (request) => {
      const row = getRow(uuidParam(request.params));
      if (row.trashed_at) throw new HttpError(409, 'Dans la corbeille : le récupérer d’abord');
      const opened = ctx.ui.openWindow(`/m/coffre/lire/${row.id}`, { title: row.name });
      if (opened) store.update('items', row.id, { opened_at: new Date().toISOString() });
      return { opened, route: `/w/m/coffre/lire/${row.id}` };
    });

    /** The preview was opened (« pas ouverts depuis 6 mois » counts it as opened). */
    ctx.routes.post('/files/:id/seen', (request) => {
      const row = getRow(uuidParam(request.params));
      store.update('items', row.id, { opened_at: new Date().toISOString() });
      return { ok: true };
    });

    // Files sent by Windows (« Ranger dans ToolBox », « Envoyer vers », ADR 0059):
    // one batch = one rangement window. Nothing is written until Thomas clicks « Ranger ».
    const received = new Map<string, { at: number; paths: string[] }>();
    ctx.ui.receiveFiles((paths) => {
      const now = Date.now();
      for (const [k, b] of received) if (now - b.at > 24 * 3_600_000) received.delete(k);
      const id = newId();
      received.set(id, { at: now, paths });
      return `/m/coffre/ranger/${id}`;
    });
    ctx.routes.get('/received/:id', (request) => {
      const id = uuidParam(request.params);
      const batch = received.get(id);
      if (!batch) throw new HttpError(404, 'Ces fichiers ne sont plus en attente');
      const paths = batch.paths.filter((p) => existsSync(p));
      const dirs = paths.filter((p) => statSync(p).isDirectory()).length;
      return { id, paths, folders: dirs, missing: batch.paths.length - paths.length };
    });

    // « Proposer de ranger mes nouveaux téléchargements » (OFF by default, ADR 0060).
    const downloads = new DownloadWatcher(ctx, (sha) => duplicateOf(sha) !== null);
    ctx.settings.onChange((key) => {
      if (key === 'watchDownloads' || key === 'downloadsFolder') {
        if (downloads.enabled()) downloads.snapshot();
        downloads.start();
      }
    });
    ctx.routes.get('/downloads', () => downloads.status());
    /** Looks at the folder now (the page's « Actualiser », the tests). Read only. */
    ctx.routes.post('/downloads/check', async () => {
      await downloads.poll();
      return downloads.status();
    });
    ctx.routes.post('/downloads/ignore', (request) => {
      const b = requestBody(request);
      const paths = Array.isArray(b.paths)
        ? b.paths.filter((p): p is string => typeof p === 'string')
        : [];
      downloads.ignore(paths);
      return downloads.status();
    });
    ctx.routes.get('/downloads/existing', () => {
      if (!downloads.enabled())
        throw new HttpError(409, 'La surveillance de Téléchargements est désactivée');
      return downloads.existing();
    });
    downloads.start();
    ctx.onShutdown(() => downloads.stop());

    registerDiskRoutes(deps, disk);
    registerArchiveRoutes(deps, disk, (folderId) =>
      filesIn([folderId, ...descendants(folderId).map((d) => d.id)])
        .filter((r) => !r.trashed_at)
        .map((r) => r.id),
    );
    registerRestoreRoutes(deps, disk);
    registerVerifyRoutes(deps, disk);
    registerDiskExcludedRoutes(deps, disk);
    registerSearch({
      ctx,
      items,
      inner: projects.table,
      labels,
      textIndex,
      dtos,
      folderRows,
      pathOf,
      scanPc: () => disk.scanPc(),
    });

    // The Coffre's folders exist from the first opening (readable in the Explorer).
    try {
      library.ensure();
      // The old « _Arrivée » folder, empty, goes (« À ranger » replaces it).
      const old = library.abs(OLD_ARRIVAL_FOLDER);
      if (existsSync(old) && readdirSync(old).length === 0) rmdirSync(old);
    } catch (error) {
      ctx.logger.warn(`Dossier du Coffre non créé : ${String(error)}`);
    }
    // The disk is looked for every few seconds, READ ONLY (only a click writes on it).
    disk.start();
    // ToolBox's own temporary copies on the PC (a file or a version copied back from the
    // disk and never finished; the previous files kept for « Annuler », which a restart
    // ends: those versions are on the disk): removed at startup.
    cleanReadCopies();
    for (const dir of ['tmp', 'annuler'])
      try {
        rmSync(ctx.files.dataPath(dir), { recursive: true, force: true });
      } catch (error) {
        ctx.logger.warn(`Fichiers temporaires du Coffre : ${String(error)}`);
      }
    // What changed in the PC's files while ToolBox was closed (only the PC's database is
    // written), then the texts not read yet — in the background, interruptible, resumed.
    textIndex.forgetErased();
    const startupScan = setTimeout(() => {
      disk
        .scanPc()
        .catch((error) => ctx.logger.warn(`Fichiers du PC : ${String(error)}`))
        .finally(() => textIndex.kick());
    }, 1500);
    startupScan.unref?.();
    // A file changed in its folder while ToolBox is open (opened from the Explorer) is seen
    // within the next minutes (sizes and dates compared; only what changed is read).
    const rescan = setInterval(() => {
      disk.scanPc().catch((error) => ctx.logger.warn(`Fichiers du PC : ${String(error)}`));
    }, RESCAN_MS);
    rescan.unref?.();
    ctx.onShutdown(async () => {
      clearTimeout(startupScan);
      clearInterval(rescan);
      disk.stop();
      await textIndex.stop();
    });
  },
});
