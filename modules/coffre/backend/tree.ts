// v0.48.0, v0.50.0 (Expérimental; ADR 0064, 0067): the folders' tree, managed
// in ToolBox — move a folder (under another, or to the top), merge it into
// another, delete it when it is empty, reorder siblings. A folder is a real
// folder of the Coffre (règle 2). Every action moves the files on the PC as a
// block, then the rows; anything that fails is undone; « Annuler » puts back
// exactly the tree and the files of before. On the disk, the next update
// reproduces it as MOVES (each entry's path changed; nothing copied again).
// A Projet is indivisible: it moves whole, and is never merged.
import { mkdirSync, readdirSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import {
  HttpError,
  requestBody,
  uuidParam,
  type ModuleContext,
  type SyncStore,
} from '@hub/sdk/core';
import { fold } from '../shared/deduce';
import { folderName, invalidName } from '../shared/names';
import { renameHeld, type Library } from './library';
import { taskRoute } from './tasks';
import type { FolderRow, ItemRow } from './rows';

export interface TreeDeps {
  ctx: ModuleContext;
  store: SyncStore;
  library: Library;
  t: { items: string; folders: string; rules: string };
  folderRows: () => FolderRow[];
  /** A folder's folder (« Cours/Thermo »). */
  folderOf: (folderId: string) => string;
  /** Keeps an « Annuler » for a while; its id. */
  remember: (run: () => Promise<void>) => string;
  /** What runs on the disk now (no tree change meanwhile), or null. */
  busy: () => string | null;
}

/** Steps done, undone in reverse order on a failure or « Annuler ». */
type Journal = (() => Promise<void> | void)[];

async function rollback(journal: Journal): Promise<void> {
  for (const step of [...journal].reverse()) await step();
}

/** « Cours/Thermo/x.pdf » starts with the folder « Cours/Thermo »: the part after it, else null. */
const under = (rel: string | null, dir: string): string | null =>
  rel && rel.toLowerCase().startsWith(`${dir.toLowerCase()}/`) ? rel.slice(dir.length) : null;

export function createTree(d: TreeDeps) {
  const { ctx, store, library, t } = d;
  const byId = () => new Map(d.folderRows().map((c) => [c.id, c]));
  const children = (id: string | null) =>
    d
      .folderRows()
      .filter((c) => c.parent_id === id)
      .sort((a, b) => (a.sort ?? 1e9) - (b.sort ?? 1e9) || a.name.localeCompare(b.name, 'fr'));
  const get = (id: string) => {
    const c = byId().get(id);
    if (!c) throw new HttpError(404, 'Dossier introuvable');
    return c;
  };
  /** Is `id` the folder itself or one of its descendants? */
  const isWithin = (id: string | null, ancestor: string): boolean => {
    const map = byId();
    for (let c = id ? map.get(id) : undefined, n = 0; c && n < 1000; n++) {
      if (c.id === ancestor) return true;
      c = c.parent_id ? map.get(c.parent_id) : undefined;
    }
    return false;
  };
  const guard = () => {
    const b = d.busy();
    if (b) throw new HttpError(409, `Le disque est occupé (${b}) : réessaie après`);
  };
  const dirOf = (parentId: string | null) => (parentId ? d.folderOf(parentId) : '');
  const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

  /** The entries whose path is under a folder (archived ones included; a project's own path too), and the trashed ones from it. */
  const rewritePaths = (before: string, after: string, journal: Journal) => {
    const rows = ctx.db
      .prepare(`SELECT id, rel_path, trash_from FROM ${t.items} WHERE deleted_at IS NULL`)
      .all() as Pick<ItemRow, 'id' | 'rel_path' | 'trash_from'>[];
    for (const r of rows) {
      const rest =
        r.rel_path && r.rel_path.toLowerCase() === before.toLowerCase()
          ? ''
          : under(r.rel_path, before);
      const restTrash =
        r.trash_from === null
          ? null
          : r.trash_from.toLowerCase() === before.toLowerCase()
            ? ''
            : under(r.trash_from, before);
      if (rest === null && restTrash === null) continue;
      const fields: Record<string, string> = {};
      if (rest !== null) fields.rel_path = after + rest;
      if (restTrash !== null) fields.trash_from = after + restTrash;
      const old = { rel_path: r.rel_path, trash_from: r.trash_from };
      store.update('items', r.id, fields);
      journal.push(() => void store.update('items', r.id, old));
    }
  };

  /** Moves a folder under `parentId` (null: the top) — on the PC as a block, then the rows. */
  /** v0.49.0: the refusals of a merge, checked at once. */
  function checkMerge(srcId: string, dstId: string): void {
    get(srcId);
    get(dstId);
    if (srcId === dstId) throw new HttpError(409, 'Un dossier ne se fusionne pas avec lui-même');
    for (const id of [srcId, dstId])
      if (get(id).project)
        throw new HttpError(
          409,
          `« ${get(id).name} » est un projet : il ne se fusionne pas (indivisible)`,
        );
    if (isWithin(dstId, srcId))
      throw new HttpError(
        409,
        `« ${get(srcId).name} » ne peut pas se fondre dans un de ses sous-dossiers`,
      );
  }

  /** v0.49.0: the refusals of a move, checked at once (before the task is queued). */
  function checkMove(id: string, parentId: string | null): void {
    const row = get(id);
    if (parentId !== null && get(parentId).project)
      throw new HttpError(
        409,
        `« ${get(parentId).name} » est un projet : rien n'y entre depuis le Coffre (indivisible)`,
      );
    if (parentId === id || isWithin(parentId, id))
      throw new HttpError(
        409,
        `« ${row.name} » ne peut pas aller dans lui-même ni dans un de ses sous-dossiers`,
      );
    if (row.parent_id === parentId) return;
    const twin = children(parentId).find((c) => c.id !== id && fold(c.name) === fold(row.name));
    if (twin)
      throw new HttpError(
        409,
        `« ${row.name} » existe déjà ${parentId ? `dans « ${get(parentId).name} »` : 'à la racine'} : fusionne-les plutôt`,
      );
    const before = d.folderOf(id);
    const after = join(dirOf(parentId), folderName(row.name));
    if (before.toLowerCase() !== after.toLowerCase() && library.exists(after))
      throw new HttpError(
        409,
        `Un dossier « ${after} » existe déjà sur le PC dans le Coffre (hors de ToolBox) : renomme-le d'abord`,
      );
  }

  async function move(id: string, parentId: string | null, journal: Journal): Promise<void> {
    checkMove(id, parentId);
    const row = get(id);
    if (row.parent_id === parentId) return;
    const before = d.folderOf(id);
    const after = join(dirOf(parentId), folderName(row.name));
    const moved = library.exists(before);
    if (moved) {
      mkdirSync(path.dirname(library.abs(after)), { recursive: true });
      await renameHeld(library.abs(before), library.abs(after));
      journal.push(async () => {
        mkdirSync(path.dirname(library.abs(before)), { recursive: true });
        await renameHeld(library.abs(after), library.abs(before));
      });
    }
    const old = { parent_id: row.parent_id, sort: row.sort };
    ctx.db.transaction(() => {
      store.update('folders', id, { parent_id: parentId, sort: null });
      rewritePaths(before, after, journal);
    });
    journal.push(() => void store.update('folders', id, old));
  }

  /** The files of `src` go into `dst`'s folder (free names); their rows follow. */
  async function mergeInto(srcId: string, dstId: string, journal: Journal): Promise<void> {
    const src = get(srcId);
    const dst = get(dstId);
    const srcDir = d.folderOf(srcId);
    const dstDir = d.folderOf(dstId);
    const own = ctx.db
      .prepare(`SELECT * FROM ${t.items} WHERE deleted_at IS NULL AND folder_id = ?`)
      .all(srcId) as ItemRow[];
    for (const item of own) {
      const old = {
        folder_id: item.folder_id,
        rel_path: item.rel_path,
        name: item.name,
        trash_from: item.trash_from,
      };
      const fields: Record<string, string | null> = { folder_id: dstId };
      const rest = under(item.rel_path, srcDir);
      if (item.rel_path && rest !== null && !item.trashed_at) {
        if (item.archived_at) {
          // On the disk only: its place in the sheet, a free name there.
          const free = library.freeIn(library.abs(dstDir), item.name);
          fields.rel_path = `${dstDir}/${free}`;
          fields.name = free;
        } else if (library.exists(item.rel_path)) {
          const now = await library.move(item.rel_path, dstDir, item.name);
          const was = item.rel_path;
          journal.push(async () => {
            const back = path.posix.dirname(was);
            await library.move(now, back === '.' ? '' : back, path.posix.basename(was));
          });
          fields.rel_path = now;
          fields.name = path.posix.basename(now);
        }
      }
      if (item.trashed_at && item.trash_from === srcDir) fields.trash_from = dstDir;
      store.update('items', item.id, fields);
      journal.push(() => void store.update('items', item.id, old));
    }
    // The sub-folders: same name in the destination → merged too; else moved there.
    for (const child of children(srcId)) {
      const twin = children(dstId).find((c) => fold(c.name) === fold(child.name));
      if (twin) await mergeInto(child.id, twin.id, journal);
      else await move(child.id, dstId, journal);
    }
    // The learned rules and the course follow; the source goes.
    const rules = ctx.db
      .prepare(
        `SELECT id, kind, key, value FROM ${t.rules} WHERE deleted_at IS NULL AND (value = ? OR key LIKE ?)`,
      )
      .all(srcId, `${srcId}:%`) as { id: string; kind: string; key: string; value: string }[];
    for (const r of rules) {
      const fields: Record<string, string> =
        r.kind === 'ext' ? { key: `${dstId}${r.key.slice(srcId.length)}` } : { value: dstId };
      store.update('rules', r.id, fields);
      journal.push(() => void store.update('rules', r.id, { key: r.key, value: r.value }));
    }
    if (!dst.course_name && src.course_name) {
      store.update('folders', dstId, { course_name: src.course_name });
      journal.push(() => void store.update('folders', dstId, { course_name: null }));
    }
    store.remove('folders', srcId);
    journal.push(() => void store.restore('folders', srcId));
    removeEmptyFolder(srcDir, journal);
  }

  /** The folder of a folder that is gone, when nothing is left in it (never anything else). */
  function removeEmptyFolder(dir: string, journal: Journal) {
    if (!dir || !library.exists(dir)) return;
    const abs = library.abs(dir);
    try {
      if (readdirSync(abs).length) return;
      rmdirSync(abs);
      journal.push(() => void mkdirSync(abs, { recursive: true }));
    } catch {
      // Not empty, or in use: it stays.
    }
  }

  /** Runs an action with its journal: undone on a failure; « Annuler » for later. */
  async function act(run: (journal: Journal) => Promise<void>): Promise<string> {
    guard();
    const journal: Journal = [];
    try {
      await run(journal);
    } catch (error) {
      await rollback(journal).catch((e: unknown) =>
        ctx.logger.error(`Dossiers : retour arrière incomplet (${String(e)})`),
      );
      throw error;
    }
    return d.remember(async () => {
      guard();
      await rollback(journal);
    });
  }

  /** What a folder holds (a delete is refused when it is not empty). */
  const contentOf = (id: string) => {
    const n = (sql: string, ...a: unknown[]) => (ctx.db.prepare(sql).get(...a) as { n: number }).n;
    return {
      items: n(
        `SELECT COUNT(*) AS n FROM ${t.items} WHERE deleted_at IS NULL AND trashed_at IS NULL AND folder_id = ?`,
        id,
      ),
      children: children(id).length,
    };
  };

  /**
   * v0.48.0: a route typed in the route picker (« Cours/Thermo/Labos »): the
   * missing folders are created now — at the validation — and removed by the
   * rollback or « Annuler ».
   */
  const routeOf = (names: readonly string[], journal: Journal): string | null => {
    let parent: string | null = null;
    for (const raw of names) {
      const name = raw.replace(/\s+/g, ' ').trim();
      if (!name) throw new HttpError(400, 'Nom de dossier vide');
      const bad = invalidName(name);
      if (bad) throw new HttpError(400, bad);
      const found: FolderRow | undefined = children(parent).find(
        (c) => fold(c.name) === fold(name),
      );
      if (found) parent = found.id;
      else {
        const id: string = store.create<FolderRow & { updated_at: string }>('folders', {
          parent_id: parent,
          name,
          color: null,
          sort: null,
          end_of_route: 0,
          project: 0,
          default_labels_json: '[]',
        }).id;
        journal.push(() => void store.remove('folders', id));
        parent = id;
      }
    }
    return parent;
  };

  /** Renames a folder: on the PC (same place), then the rows. */
  async function rename(id: string, raw: string, journal: Journal): Promise<void> {
    const row = get(id);
    const name = raw.replace(/\s+/g, ' ').trim();
    const bad = invalidName(name);
    if (bad) throw new HttpError(400, bad);
    if (name === row.name) return;
    if (children(row.parent_id).some((c) => c.id !== id && fold(c.name) === fold(name)))
      throw new HttpError(409, `« ${name} » existe déjà ici`);
    const before = d.folderOf(id);
    const after = join(dirOf(row.parent_id), folderName(name));
    if (before !== after) {
      if (before.toLowerCase() !== after.toLowerCase() && library.exists(after))
        throw new HttpError(
          409,
          `Un dossier « ${after} » existe déjà dans le Coffre sans être un dossier`,
        );
      if (library.exists(before)) {
        // Through a temporary name: « thermo » → « Thermo » on a case-insensitive disk.
        const tmp = `${after}.~${Date.now()}`;
        await renameHeld(library.abs(before), library.abs(tmp));
        await renameHeld(library.abs(tmp), library.abs(after));
        journal.push(async () => {
          await renameHeld(library.abs(after), library.abs(tmp));
          await renameHeld(library.abs(tmp), library.abs(before));
        });
      }
    }
    const old = row.name;
    ctx.db.transaction(() => {
      store.update('folders', id, { name });
      if (before !== after) rewritePaths(before, after, journal);
    });
    journal.push(() => void store.update('folders', id, { name: old }));
  }

  return {
    rename: (id: string, name: string) => act((j) => rename(id, name, j)),
    move: (id: string, parentId: string | null, newParent?: readonly string[]) =>
      act((j) => move(id, newParent?.length ? routeOf(newParent, j) : parentId, j)),
    merge: (srcId: string, dstId: string) =>
      act(async (j) => {
        checkMerge(srcId, dstId);
        await mergeInto(srcId, dstId, j);
      }),
    checkMove,
    checkMerge,
    remove: (id: string) =>
      act(async (j) => {
        const row = get(id);
        const c = contentOf(id);
        if (c.items || c.children)
          throw new HttpError(
            409,
            `« ${row.name} » n'est pas vide (${c.items} fichier(s), ${c.children} sous-dossier(s)) : déplace d'abord son contenu`,
          );
        const dir = d.folderOf(id);
        store.remove('folders', id);
        j.push(() => void store.restore('folders', id));
        removeEmptyFolder(dir, j);
      }),
    /** Puts `id` before `beforeId` among its siblings (null: last). */
    reorder: (id: string, beforeId: string | null) =>
      act(async (j) => {
        const row = get(id);
        const list = children(row.parent_id).filter((c) => c.id !== id);
        const at = beforeId ? list.findIndex((c) => c.id === beforeId) : -1;
        list.splice(at < 0 ? list.length : at, 0, row);
        list.forEach((c, i) => {
          if (c.sort === i) return;
          const old = c.sort;
          store.update('folders', c.id, { sort: i });
          j.push(() => void store.update('folders', c.id, { sort: old }));
        });
      }),
    contentOf,
  };
}

export function registerTreeRoutes(d: TreeDeps): ReturnType<typeof createTree> {
  const tree = createTree(d);
  const parentOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const nameOf = (id: string) => d.folderRows().find((c) => c.id === id)?.name ?? 'dossier';
  // v0.49.0: moving and merging are background tasks (a merge can move thousands of files).
  taskRoute<{ id: string; parentId: string | null; newParent?: string[] }, { undoId: string }>(
    d.ctx,
    {
      route: '/folders/:id/move',
      type: 'folder-move',
      input: (request) => {
        const b = requestBody(request);
        const input = {
          id: uuidParam(request.params),
          parentId: parentOf(b.parentId),
          newParent: Array.isArray(b.newParent) ? b.newParent.map(String) : undefined,
        };
        // Refused at once (no task): itself, a descendant, a name taken…
        if (!input.newParent?.length) tree.checkMove(input.id, input.parentId);
        else
          for (const name of input.newParent) {
            const bad = invalidName(name);
            if (bad) throw new HttpError(400, bad);
          }
        return input;
      },
      title: (i) => `Coffre : déplacer « ${nameOf(i.id)} »`,
      run: async (job) => ({
        undoId: await tree.move(job.input.id, job.input.parentId, job.input.newParent),
      }),
    },
  );
  taskRoute<{ id: string; into: string }, { undoId: string }>(d.ctx, {
    route: '/folders/:id/merge',
    type: 'folder-merge',
    input: (request) => {
      const input = {
        id: uuidParam(request.params),
        into: String(requestBody(request).into ?? ''),
      };
      tree.checkMerge(input.id, input.into);
      return input;
    },
    title: (i) => `Coffre : fusionner « ${nameOf(i.id)} » dans « ${nameOf(i.into)} »`,
    run: async (job) => ({ undoId: await tree.merge(job.input.id, job.input.into) }),
  });
  d.ctx.routes.post('/folders/:id/reorder', async (request) => {
    const id = uuidParam(request.params);
    const undoId = await tree.reorder(id, parentOf(requestBody(request).beforeId));
    return { undoId };
  });
  d.ctx.routes.get('/folders/:id/content', (request) => tree.contentOf(uuidParam(request.params)));
  d.ctx.routes.delete('/folders/:id', async (request) => {
    const undoId = await tree.remove(uuidParam(request.params));
    return { undoId };
  });
  return tree;
}
