// v0.48.0 (Expérimental): the tree of the contexts, managed in ToolBox (ADR
// 0064) — move a context (under another, or to the root), merge it into
// another, delete it when it is empty, reorder siblings. A context is a path
// of rangement: its folder in the Coffre follows exactly (règle 2). Every
// action moves the files on the PC as a block, then the sheets; anything that
// fails is undone; « Annuler » puts back exactly the tree and the files of
// before. On the disk, the next update reproduces it as MOVES (each element's
// path changed; nothing copied again).
import { mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
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
import type { Library } from './library';
import type { ContextRow, ItemRow } from './rows';

export interface TreeDeps {
  ctx: ModuleContext;
  store: SyncStore;
  library: Library;
  t: { items: string; contexts: string; also: string; rules: string };
  contextRows: () => ContextRow[];
  /** A context's folder (« Cours/Thermo »). */
  folderOf: (contextId: string) => string;
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
  const byId = () => new Map(d.contextRows().map((c) => [c.id, c]));
  const children = (id: string | null) =>
    d
      .contextRows()
      .filter((c) => c.parent_id === id)
      .sort((a, b) => (a.sort ?? 1e9) - (b.sort ?? 1e9) || a.name.localeCompare(b.name, 'fr'));
  const get = (id: string) => {
    const c = byId().get(id);
    if (!c) throw new HttpError(404, 'Contexte introuvable');
    return c;
  };
  /** Is `id` the context itself or one of its descendants? */
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

  /** The elements whose path is under a folder (archived ones included), and the trashed ones from it. */
  const rewritePaths = (before: string, after: string, journal: Journal) => {
    const rows = ctx.db
      .prepare(`SELECT id, rel_path, trash_from FROM ${t.items} WHERE deleted_at IS NULL`)
      .all() as Pick<ItemRow, 'id' | 'rel_path' | 'trash_from'>[];
    for (const r of rows) {
      const rest = under(r.rel_path, before);
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

  /** Moves a context under `parentId` (null: the root) — its folder as a block, then the sheets. */
  async function move(id: string, parentId: string | null, journal: Journal): Promise<void> {
    const row = get(id);
    if (parentId !== null) get(parentId);
    if (parentId === id || isWithin(parentId, id))
      throw new HttpError(
        409,
        `« ${row.name} » ne peut pas aller dans lui-même ni dans un de ses sous-contextes`,
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
        `Un dossier « ${after} » existe déjà dans le Coffre sans être un contexte : adopte-le ou renomme-le d'abord`,
      );
    const moved = library.exists(before);
    if (moved) {
      mkdirSync(path.dirname(library.abs(after)), { recursive: true });
      renameSync(library.abs(before), library.abs(after));
      journal.push(() => {
        mkdirSync(path.dirname(library.abs(before)), { recursive: true });
        renameSync(library.abs(after), library.abs(before));
      });
    }
    const old = { parent_id: row.parent_id, sort: row.sort };
    ctx.db.transaction(() => {
      store.update('contexts', id, { parent_id: parentId, sort: null });
      rewritePaths(before, after, journal);
    });
    journal.push(() => void store.update('contexts', id, old));
  }

  /** The files of `src`'s own elements go into `dst`'s folder (free names); their sheets follow. */
  async function mergeInto(srcId: string, dstId: string, journal: Journal): Promise<void> {
    const src = get(srcId);
    const dst = get(dstId);
    const srcDir = d.folderOf(srcId);
    const dstDir = d.folderOf(dstId);
    const own = ctx.db
      .prepare(`SELECT * FROM ${t.items} WHERE deleted_at IS NULL AND context_id = ?`)
      .all(srcId) as ItemRow[];
    for (const item of own) {
      const old = {
        context_id: item.context_id,
        rel_path: item.rel_path,
        name: item.name,
        trash_from: item.trash_from,
      };
      const fields: Record<string, string | null> = { context_id: dstId };
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
    // « Aussi utilisé dans » the source: in the destination now (never twice).
    const links = ctx.db
      .prepare(`SELECT id, item_id FROM ${t.also} WHERE deleted_at IS NULL AND context_id = ?`)
      .all(srcId) as { id: string; item_id: string }[];
    for (const l of links) {
      const dup =
        ctx.db
          .prepare(
            `SELECT 1 FROM ${t.also} WHERE deleted_at IS NULL AND context_id = ? AND item_id = ?`,
          )
          .get(dstId, l.item_id) ||
        ctx.db
          .prepare(
            `SELECT 1 FROM ${t.items} WHERE deleted_at IS NULL AND id = ? AND context_id = ?`,
          )
          .get(l.item_id, dstId);
      if (dup) {
        store.remove('also', l.id);
        journal.push(() => void store.restore('also', l.id));
      } else {
        store.update('also', l.id, { context_id: dstId });
        journal.push(() => void store.update('also', l.id, { context_id: srcId }));
      }
    }
    // The sub-contexts: same name in the destination → merged too; else moved there.
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
      store.update('contexts', dstId, { course_name: src.course_name });
      journal.push(() => void store.update('contexts', dstId, { course_name: null }));
    }
    const covers = ctx.db
      .prepare(
        `SELECT id FROM ${t.contexts} WHERE deleted_at IS NULL AND cover_item_id IS NOT NULL AND id = ?`,
      )
      .get(dstId);
    if (!covers && src.cover_item_id) {
      store.update('contexts', dstId, { cover_item_id: src.cover_item_id });
      journal.push(() => void store.update('contexts', dstId, { cover_item_id: null }));
    }
    store.remove('contexts', srcId);
    journal.push(() => void store.restore('contexts', srcId));
    removeEmptyFolder(srcDir, journal);
  }

  /** The folder of a context that is gone, when nothing is left in it (never anything else). */
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
        ctx.logger.error(`Contextes : retour arrière incomplet (${String(e)})`),
      );
      throw error;
    }
    return d.remember(async () => {
      guard();
      await rollback(journal);
    });
  }

  /** What a context holds (a delete is refused when it is not empty). */
  const contentOf = (id: string) => {
    const n = (sql: string, ...a: unknown[]) => (ctx.db.prepare(sql).get(...a) as { n: number }).n;
    return {
      items: n(
        `SELECT COUNT(*) AS n FROM ${t.items} WHERE deleted_at IS NULL AND trashed_at IS NULL AND context_id = ?`,
        id,
      ),
      links: n(
        `SELECT COUNT(*) AS n FROM ${t.also} WHERE deleted_at IS NULL AND context_id = ?`,
        id,
      ),
      children: children(id).length,
    };
  };

  /**
   * v0.48.0: a route typed in the route picker (« Cours/Thermo/Labos »): the
   * missing contexts are created now — at the validation — and removed by the
   * rollback or « Annuler ».
   */
  const routeOf = (names: readonly string[], journal: Journal): string | null => {
    let parent: string | null = null;
    for (const raw of names) {
      const name = raw.replace(/\s+/g, ' ').trim();
      if (!name) throw new HttpError(400, 'Nom de contexte vide');
      const bad = invalidName(name);
      if (bad) throw new HttpError(400, bad);
      const found: ContextRow | undefined = children(parent).find(
        (c) => fold(c.name) === fold(name),
      );
      if (found) parent = found.id;
      else {
        const id: string = store.create<ContextRow & { updated_at: string }>('contexts', {
          parent_id: parent,
          name,
          color: null,
          sort: null,
          cover_item_id: null,
        }).id;
        journal.push(() => void store.remove('contexts', id));
        parent = id;
      }
    }
    return parent;
  };

  /** Renames a context: its folder follows (same place), then the sheets. */
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
          `Un dossier « ${after} » existe déjà dans le Coffre sans être un contexte`,
        );
      if (library.exists(before)) {
        // Through a temporary name: « thermo » → « Thermo » on a case-insensitive disk.
        const tmp = `${after}.~${Date.now()}`;
        renameSync(library.abs(before), library.abs(tmp));
        renameSync(library.abs(tmp), library.abs(after));
        journal.push(() => {
          renameSync(library.abs(after), library.abs(tmp));
          renameSync(library.abs(tmp), library.abs(before));
        });
      }
    }
    const old = row.name;
    ctx.db.transaction(() => {
      store.update('contexts', id, { name });
      if (before !== after) rewritePaths(before, after, journal);
    });
    journal.push(() => void store.update('contexts', id, { name: old }));
  }

  return {
    rename: (id: string, name: string) => act((j) => rename(id, name, j)),
    move: (id: string, parentId: string | null, newParent?: readonly string[]) =>
      act((j) => move(id, newParent?.length ? routeOf(newParent, j) : parentId, j)),
    merge: (srcId: string, dstId: string) =>
      act(async (j) => {
        if (srcId === dstId)
          throw new HttpError(409, 'Un contexte ne se fusionne pas avec lui-même');
        if (isWithin(dstId, srcId))
          throw new HttpError(
            409,
            `« ${get(srcId).name} » ne peut pas se fondre dans un de ses sous-contextes`,
          );
        await mergeInto(srcId, dstId, j);
      }),
    remove: (id: string) =>
      act(async (j) => {
        const row = get(id);
        const c = contentOf(id);
        if (c.items || c.links || c.children)
          throw new HttpError(
            409,
            `« ${row.name} » n'est pas vide (${c.items} élément(s), ${c.children} sous-contexte(s)) : déplace d'abord son contenu`,
          );
        const dir = d.folderOf(id);
        store.remove('contexts', id);
        j.push(() => void store.restore('contexts', id));
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
          store.update('contexts', c.id, { sort: i });
          j.push(() => void store.update('contexts', c.id, { sort: old }));
        });
      }),
    contentOf,
  };
}

export function registerTreeRoutes(d: TreeDeps): ReturnType<typeof createTree> {
  const tree = createTree(d);
  const parentOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  d.ctx.routes.post('/contexts/:id/move', async (request) => {
    const id = uuidParam(request.params);
    const b = requestBody(request);
    const route = Array.isArray(b.newParent) ? b.newParent.map(String) : undefined;
    const undoId = await tree.move(id, parentOf(b.parentId), route);
    return { undoId };
  });
  d.ctx.routes.post('/contexts/:id/merge', async (request) => {
    const id = uuidParam(request.params);
    const into = String(requestBody(request).into ?? '');
    const undoId = await tree.merge(id, into);
    return { undoId };
  });
  d.ctx.routes.post('/contexts/:id/reorder', async (request) => {
    const id = uuidParam(request.params);
    const undoId = await tree.reorder(id, parentOf(requestBody(request).beforeId));
    return { undoId };
  });
  d.ctx.routes.get('/contexts/:id/content', (request) => tree.contentOf(uuidParam(request.params)));
  d.ctx.routes.delete('/contexts/:id', async (request) => {
    const undoId = await tree.remove(uuidParam(request.params));
    return { undoId };
  });
  return tree;
}
