// v0.45.0 (Expérimental): the Coffre — keep, put away, find and open the
// files that matter (cahier des charges : docs/coffre/CAHIER-DES-CHARGES.md,
// ADR 0052). PC only: it copies the user's files into ctx.files.libraryDir
// (userData/coffre) and opens their applications. Ready for sync (UUIDs,
// tombstones, journal) without a real sync yet.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  changesTableSql,
  defineBackendModule,
  HttpError,
  isRunnable,
  newId,
  requestBody,
  SYNC_COLUMNS,
  SyncStore,
  uuidParam,
} from '@hub/sdk/core';
import { isColorValue } from '@hub/sdk/palette';
import type { AgendaService } from '../../agenda/contract';
import { contextCss } from '../shared/colors';
import { deduce, fold, mergeGuesses, type ContextRef } from '../shared/deduce';
import { extOf } from '../shared/kinds';
import { ARRIVAL_FOLDER, folderName, safeName, TRASH_FOLDER } from '../shared/names';
import {
  ATTRIBUTE_KEYS,
  type AttributeDto,
  type AttributeKey,
  type ContextDto,
  type HomeDto,
  type ItemDto,
  type ItemKind,
  type ProposalDto,
} from '../shared/types';
import { filesOf, hashFile, hashFolder, Library } from './library';

interface ItemRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  kind: ItemKind;
  name: string;
  rel_path: string | null;
  external_path: string | null;
  size: number;
  sha256: string | null;
  ext: string;
  context_id: string | null;
  arrival: number;
  pinned: number;
  trashed_at: string | null;
  trash_from: string | null;
  source_path: string | null;
  source_url: string | null;
  referrer_url: string | null;
  file_date: string | null;
}
interface ContextRow {
  id: string;
  created_at: string;
  deleted_at: string | null;
  parent_id: string | null;
  name: string;
  color: string | null;
  sort: number | null;
  cover_item_id: string | null;
}
interface AttributeRow {
  id: string;
  item_id: string;
  key: AttributeKey;
  value: string;
  origin: 'guessed' | 'chosen';
  reason: string | null;
}

/** An entry of « Ranger » (the rangement window's choice for one dropped path). */
interface DepositEntry {
  path: string;
  /** A file, a whole folder (a project), or a link left in its place. */
  as: ItemKind;
  contextId?: string | null;
  /** A new context to create on the way (its names from the root). */
  newContext?: string[] | null;
  attributes?: AttributeDto[];
  /** « Ranger plus tard »: into Arrivée. */
  arrival?: boolean;
  /** Same content already in the Coffre: keep it anyway. */
  keepDuplicate?: boolean;
  /** A new name (the sheet's), else the original's. */
  name?: string;
}

/** How long « Annuler » stays possible. */
const UNDO_MS = 15 * 60_000;
/** A folder with more files than this is not fingerprinted (no duplicate check). */
const MAX_PROJECT_FILES = 20_000;
/** « Nouveau » on a tile: what was added in the last days. */
const FRESH_DAYS = 7;

export default defineBackendModule({
  migrations: [
    {
      version: 1,
      description: 'elements, contexts, attributes, « aussi utilisé », journal (ready for sync)',
      up: `
        CREATE TABLE coffre__items (
          ${SYNC_COLUMNS},
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          rel_path TEXT,
          external_path TEXT,
          size INTEGER NOT NULL DEFAULT 0,
          sha256 TEXT,
          ext TEXT NOT NULL DEFAULT '',
          context_id TEXT,
          arrival INTEGER NOT NULL DEFAULT 0,
          pinned INTEGER NOT NULL DEFAULT 0,
          trashed_at TEXT,
          trash_from TEXT,
          source_path TEXT,
          source_url TEXT,
          referrer_url TEXT,
          file_date TEXT
        );
        CREATE INDEX coffre__items_context ON coffre__items (context_id);
        CREATE INDEX coffre__items_sha ON coffre__items (sha256);
        CREATE TABLE coffre__contexts (
          ${SYNC_COLUMNS},
          parent_id TEXT,
          name TEXT NOT NULL,
          color TEXT,
          sort INTEGER,
          cover_item_id TEXT
        );
        CREATE TABLE coffre__attributes (
          ${SYNC_COLUMNS},
          item_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          origin TEXT NOT NULL,
          reason TEXT
        );
        CREATE INDEX coffre__attributes_item ON coffre__attributes (item_id);
        CREATE TABLE coffre__also (
          ${SYNC_COLUMNS},
          item_id TEXT NOT NULL,
          context_id TEXT NOT NULL
        );
        ${changesTableSql('coffre__changes')}
      `,
    },
  ],

  register(ctx) {
    const store = new SyncStore(ctx.db);
    const items = ctx.db.table('items');
    const contexts = ctx.db.table('contexts');
    const attributes = ctx.db.table('attributes');
    const also = ctx.db.table('also');
    const library = new Library(ctx.files.libraryDir);
    const agenda = () => ctx.services.optional<AgendaService>('agenda');
    const undo = new Map<string, { at: number; run: () => Promise<void> }>();
    const remember = (run: () => Promise<void>) => {
      const id = newId();
      const now = Date.now();
      for (const [k, u] of undo) if (now - u.at > UNDO_MS) undo.delete(k);
      undo.set(id, { at: now, run });
      return id;
    };

    // --- Reading ------------------------------------------------------------------

    const contextRows = () =>
      ctx.db
        .prepare(`SELECT * FROM ${contexts} WHERE deleted_at IS NULL ORDER BY sort, name`)
        .all() as ContextRow[];
    const pathOf = (byId: Map<string, ContextRow>, id: string | null): string[] => {
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
    /** The folder of a context (« Cours/Thermo »), or Arrivée. */
    const folderOf = (contextId: string | null): string => {
      if (!contextId) return ARRIVAL_FOLDER;
      const byId = new Map(contextRows().map((c) => [c.id, c]));
      if (!byId.has(contextId)) throw new HttpError(404, 'Contexte introuvable');
      return pathOf(byId, contextId).map(folderName).join('/');
    };

    const attributesOf = (ids: string[]) => {
      const out = new Map<string, AttributeDto[]>();
      if (!ids.length) return out;
      const rows = ctx.db
        .prepare(
          `SELECT * FROM ${attributes} WHERE deleted_at IS NULL AND item_id IN (${ids.map(() => '?').join(',')}) ORDER BY key, value`,
        )
        .all(...ids) as AttributeRow[];
      for (const r of rows)
        out.set(r.item_id, [
          ...(out.get(r.item_id) ?? []),
          { key: r.key, value: r.value, origin: r.origin, reason: r.reason },
        ]);
      return out;
    };
    const alsoOf = (ids: string[]) => {
      const out = new Map<string, string[]>();
      if (!ids.length) return out;
      const rows = ctx.db
        .prepare(
          `SELECT item_id, context_id FROM ${also} WHERE deleted_at IS NULL AND item_id IN (${ids.map(() => '?').join(',')})`,
        )
        .all(...ids) as { item_id: string; context_id: string }[];
      for (const r of rows) out.set(r.item_id, [...(out.get(r.item_id) ?? []), r.context_id]);
      return out;
    };
    const absOf = (row: ItemRow): string | null =>
      row.kind === 'link' ? row.external_path : row.rel_path ? library.abs(row.rel_path) : null;

    const dtos = (rows: ItemRow[]): ItemDto[] => {
      const byId = new Map(contextRows().map((c) => [c.id, c]));
      const ids = rows.map((r) => r.id);
      const attrs = attributesOf(ids);
      const others = alsoOf(ids);
      return rows.map((r) => {
        const file = absOf(r);
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
          contextId: r.context_id,
          contextPath: r.context_id ? pathOf(byId, r.context_id) : null,
          arrival: r.arrival === 1,
          pinned: r.pinned === 1,
          trashedAt: r.trashed_at,
          externalPath: r.external_path,
          sourcePath: r.source_path,
          fileDate: r.file_date,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          attributes: attrs.get(r.id) ?? [],
          alsoIn: others.get(r.id) ?? [],
          url,
          path: file,
        };
      });
    };
    const getRow = (id: string) => {
      const row = store.get<ItemRow & { updated_at: string }>('items', id);
      if (!row) throw new HttpError(404, 'Élément introuvable');
      return row as ItemRow;
    };
    const one = (id: string) => dtos([getRow(id)])[0]!;

    const contextDtos = (): ContextDto[] => {
      const rows = contextRows();
      const byId = new Map(rows.map((c) => [c.id, c]));
      const since = new Date(Date.now() - FRESH_DAYS * 86_400_000).toISOString();
      const counts = ctx.db
        .prepare(
          `SELECT context_id, COUNT(*) AS n, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS fresh FROM ${items} WHERE deleted_at IS NULL AND trashed_at IS NULL AND context_id IS NOT NULL GROUP BY context_id`,
        )
        .all(since) as { context_id: string; n: number; fresh: number }[];
      const count = new Map(counts.map((c) => [c.context_id, c]));
      return rows.map((c) => {
        const p = pathOf(byId, c.id);
        return {
          id: c.id,
          parentId: c.parent_id,
          name: c.name,
          color: c.color,
          css: contextCss(c.color, p[0] ?? c.name),
          sort: c.sort,
          path: p,
          count: count.get(c.id)?.n ?? 0,
          fresh: count.get(c.id)?.fresh ?? 0,
          coverItemId: c.cover_item_id,
        };
      });
    };

    // --- Contexts ----------------------------------------------------------------

    /** The context of this name under that parent (case and accents ignored), or a new one. */
    const ensureContext = (names: string[], parentId: string | null = null): string => {
      let parent = parentId;
      for (const raw of names) {
        const name = raw.replace(/\s+/g, ' ').trim();
        if (!name) throw new HttpError(400, 'Nom de contexte vide');
        const found = contextRows().find(
          (c) => c.parent_id === parent && fold(c.name) === fold(name),
        );
        parent = found
          ? found.id
          : store.create<ContextRow & { updated_at: string }>('contexts', {
              parent_id: parent,
              name,
              color: null,
              sort: null,
              cover_item_id: null,
            }).id;
      }
      if (!parent) throw new HttpError(400, 'Contexte vide');
      return parent;
    };

    ctx.routes.get('/contexts', () => contextDtos());
    ctx.routes.post('/contexts', (request) => {
      const b = requestBody(request);
      const parentId = typeof b.parentId === 'string' && b.parentId ? b.parentId : null;
      if (parentId && !contextRows().some((c) => c.id === parentId))
        throw new HttpError(404, 'Contexte parent introuvable');
      const id = ensureContext([String(b.name ?? '')], parentId);
      if (b.color !== undefined && b.color !== null) {
        if (!isColorValue(b.color)) throw new HttpError(400, 'Couleur invalide');
        store.update('contexts', id, { color: String(b.color) });
      }
      return contextDtos().find((c) => c.id === id);
    });
    /** Rename (its folder follows, its elements' paths too: one transaction) or recolour a context. */
    ctx.routes.patch('/contexts/:id', async (request) => {
      const id = uuidParam(request.params);
      const row = contextRows().find((c) => c.id === id);
      if (!row) throw new HttpError(404, 'Contexte introuvable');
      const b = requestBody(request);
      if ('color' in b) {
        if (b.color !== null && !isColorValue(b.color))
          throw new HttpError(400, 'Couleur invalide');
        store.update('contexts', id, { color: (b.color as string | null) ?? null });
      }
      if (typeof b.name === 'string' && b.name.trim() && b.name.trim() !== row.name) {
        const name = b.name.replace(/\s+/g, ' ').trim();
        if (
          contextRows().some(
            (c) => c.id !== id && c.parent_id === row.parent_id && fold(c.name) === fold(name),
          )
        )
          throw new HttpError(409, `« ${name} » existe déjà ici`);
        const before = folderOf(id);
        const after = [...before.split('/').slice(0, -1), folderName(name)].join('/');
        const moved = library.exists(before) && before !== after;
        if (moved)
          await library.move(
            before,
            path.posix.dirname(after) === '.' ? '' : path.posix.dirname(after),
            folderName(name),
          );
        try {
          ctx.db.transaction(() => {
            store.update('contexts', id, { name });
            const rows = ctx.db
              .prepare(
                `SELECT id, rel_path FROM ${items} WHERE deleted_at IS NULL AND rel_path LIKE ?`,
              )
              .all(`${before}/%`) as { id: string; rel_path: string }[];
            for (const r of rows)
              store.update('items', r.id, { rel_path: after + r.rel_path.slice(before.length) });
          });
        } catch (error) {
          if (moved)
            await library.move(
              after,
              path.posix.dirname(before) === '.' ? '' : path.posix.dirname(before),
              path.posix.basename(before),
            );
          throw error;
        }
      }
      return contextDtos().find((c) => c.id === id);
    });

    // --- Lists ----------------------------------------------------------------------

    const live = `deleted_at IS NULL`;
    ctx.routes.get('/items', (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const where = [live];
      const args: string[] = [];
      if (q.trash === '1') where.push('trashed_at IS NOT NULL');
      else where.push('trashed_at IS NULL');
      if (q.arrival === '1') where.push('arrival = 1');
      if (q.context) {
        where.push(
          `(context_id = ? OR id IN (SELECT item_id FROM ${also} WHERE deleted_at IS NULL AND context_id = ?))`,
        );
        args.push(q.context, q.context);
      }
      if (q.key && q.value) {
        where.push(
          `id IN (SELECT item_id FROM ${attributes} WHERE deleted_at IS NULL AND key = ? AND value = ? COLLATE NOCASE)`,
        );
        args.push(q.key, q.value);
      }
      const rows = ctx.db
        .prepare(`SELECT * FROM ${items} WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`)
        .all(...args) as ItemRow[];
      return dtos(rows);
    });
    ctx.routes.get('/items/:id', (request) => one(uuidParam(request.params)));

    ctx.routes.get('/home', async (): Promise<HomeDto> => {
      const rows = ctx.db
        .prepare(
          `SELECT * FROM ${items} WHERE ${live} AND trashed_at IS NULL ORDER BY updated_at DESC`,
        )
        .all() as ItemRow[];
      const pinned = rows.filter((r) => r.pinned === 1);
      const recent = rows.filter((r) => r.pinned !== 1 && r.arrival !== 1).slice(0, 12);
      const disk = await library.disk();
      const trashCount = (
        ctx.db
          .prepare(`SELECT COUNT(*) AS n FROM ${items} WHERE ${live} AND trashed_at IS NOT NULL`)
          .get() as { n: number }
      ).n;
      return {
        pinned: dtos(pinned),
        recent: dtos(recent),
        arrivalCount: rows.filter((r) => r.arrival === 1).length,
        contexts: contextDtos(),
        health: {
          items: rows.length,
          bytes: rows.filter((r) => r.kind !== 'link').reduce((s, r) => s + r.size, 0),
          diskFree: disk.free,
          diskTotal: disk.total,
          trashCount,
        },
      };
    });

    // --- Depositing ------------------------------------------------------------------

    const contextRefs = (): ContextRef[] => {
      const rows = contextRows();
      const byId = new Map(rows.map((c) => [c.id, c]));
      return rows.map((c) => ({ id: c.id, path: pathOf(byId, c.id) }));
    };
    const sitesSeen = () =>
      ctx.db
        .prepare(
          `SELECT a.value AS host, i.context_id AS contextId FROM ${attributes} a JOIN ${items} i ON i.id = a.item_id WHERE a.deleted_at IS NULL AND i.deleted_at IS NULL AND i.trashed_at IS NULL AND a.key = 'site' AND i.context_id IS NOT NULL`,
        )
        .all() as { host: string; contextId: string }[];
    const duplicateOf = (sha: string | null) => {
      if (!sha) return null;
      const row = ctx.db
        .prepare(`SELECT * FROM ${items} WHERE ${live} AND sha256 = ? ORDER BY created_at LIMIT 1`)
        .get(sha) as ItemRow | undefined;
      if (!row) return null;
      const dto = dtos([row])[0]!;
      return { id: dto.id, name: dto.name, contextPath: dto.contextPath };
    };
    const coursesSafe = () => {
      try {
        return agenda()?.courses() ?? [];
      } catch (error) {
        ctx.logger.warn(`Cours de l'Agenda illisibles : ${String(error)}`);
        return [];
      }
    };

    /** One dropped path: what it is and what the Coffre proposes. Nothing is written. */
    const propose = async (
      source: string,
      refs: ContextRef[],
      courses: ReturnType<typeof coursesSafe>,
      sites: ReturnType<typeof sitesSeen>,
    ): Promise<ProposalDto> => {
      const st = statSync(source);
      const name = path.basename(source);
      let sha256: string | null = null;
      let size = st.size;
      let fileCount = 1;
      let folderLanguage: string | null = null;
      if (st.isDirectory()) {
        fileCount = filesOf(source).length;
        if (fileCount <= MAX_PROJECT_FILES) {
          const h = await hashFolder(source);
          sha256 = h.sha256;
          size = h.size;
          folderLanguage = h.language;
        }
      } else sha256 = await hashFile(source);
      const guessed = deduce({
        name,
        isDirectory: st.isDirectory(),
        fileDate: st.mtime.toISOString(),
        provenance: st.isDirectory() ? null : ctx.files.provenance(source),
        contexts: refs,
        courses,
        sites,
        folderLanguage,
      });
      return {
        path: source,
        name,
        isDirectory: st.isDirectory(),
        fileCount,
        size,
        sha256,
        duplicate: duplicateOf(sha256),
        ...guessed,
      };
    };

    /**
     * POST /deposit/analyze { paths, expand? }: the proposals for dropped
     * paths (a folder with `expand`: one per file inside). Nothing written.
     */
    ctx.routes.post('/deposit/analyze', async (request) => {
      const b = requestBody(request);
      const paths = Array.isArray(b.paths)
        ? b.paths.filter((p): p is string => typeof p === 'string')
        : [];
      if (!paths.length) throw new HttpError(400, 'Aucun fichier');
      const refs = contextRefs();
      const courses = coursesSafe();
      const sites = sitesSeen();
      const out: ProposalDto[] = [];
      for (const p of paths) {
        if (!path.isAbsolute(p) || !existsSync(p)) throw new HttpError(404, `Introuvable : ${p}`);
        if (b.expand === true && statSync(p).isDirectory()) {
          for (const rel of filesOf(p))
            out.push(await propose(path.join(p, ...rel.split('/')), refs, courses, sites));
        } else out.push(await propose(p, refs, courses, sites));
      }
      return out;
    });

    const writeAttributes = (itemId: string, list: AttributeDto[]) => {
      for (const a of list) {
        if (!ATTRIBUTE_KEYS.includes(a.key) || typeof a.value !== 'string' || !a.value.trim())
          continue;
        store.create('attributes', {
          item_id: itemId,
          key: a.key,
          value: a.value.trim().slice(0, 200),
          origin: a.origin === 'chosen' ? 'chosen' : 'guessed',
          reason: a.origin === 'chosen' ? null : (a.reason ?? null),
        });
      }
    };

    /** « Ranger » / « Ranger plus tard »: copies (never touches the originals), then the sheets. */
    ctx.routes.post('/deposit/apply', async (request) => {
      const b = requestBody(request);
      const entries = (Array.isArray(b.entries) ? b.entries : []) as DepositEntry[];
      if (!entries.length) throw new HttpError(400, 'Rien à ranger');
      library.ensure();
      const created: string[] = [];
      const copies: string[] = [];
      const skipped: { path: string; duplicate: NonNullable<ReturnType<typeof duplicateOf>> }[] =
        [];
      try {
        for (const e of entries) {
          if (typeof e.path !== 'string' || !path.isAbsolute(e.path) || !existsSync(e.path))
            throw new HttpError(404, `Introuvable : ${String(e.path)}`);
          const st = statSync(e.path);
          const kind: ItemKind = e.as === 'link' ? 'link' : st.isDirectory() ? 'project' : 'file';
          const contextId = e.arrival
            ? null
            : e.newContext?.length
              ? ensureContext(e.newContext)
              : (e.contextId ?? null);
          const name = safeName(e.name?.trim() || path.basename(e.path));
          // Provenance: read on the ORIGINAL, before the copy.
          const provenance = kind === 'file' ? ctx.files.provenance(e.path) : null;
          let sha256: string | null = null;
          let size = st.size;
          if (kind === 'file') sha256 = await hashFile(e.path);
          else if (kind === 'project' && filesOf(e.path).length <= MAX_PROJECT_FILES) {
            const h = await hashFolder(e.path);
            sha256 = h.sha256;
            size = h.size;
          }
          const dup = kind === 'link' ? null : duplicateOf(sha256);
          if (dup && !e.keepDuplicate) {
            skipped.push({ path: e.path, duplicate: dup });
            continue;
          }
          let relPath: string | null = null;
          if (kind !== 'link') {
            relPath = await library.copyIn(
              e.path,
              contextId ? folderOf(contextId) : ARRIVAL_FOLDER,
              name,
            );
            copies.push(relPath);
            // The copy is read back: same content, or nothing is kept.
            if (kind === 'file' && (await hashFile(library.abs(relPath))) !== sha256)
              throw new Error(`Copie incomplète de « ${name} »`);
          }
          const attrs = (Array.isArray(e.attributes) ? e.attributes : []).filter(
            (a) => a && typeof a === 'object',
          );
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
            });
            writeAttributes(made.id, attrs);
            return made;
          });
          created.push(row.id);
        }
      } catch (error) {
        // Nothing half done: the copies of this deposit are removed, their sheets too.
        for (const rel of copies) await library.erase(rel).catch(() => undefined);
        for (const id of created) store.remove('items', id);
        throw error;
      }
      const undoId = created.length
        ? remember(async () => {
            for (const id of created) {
              const row = store.get<ItemRow & { updated_at: string }>(
                'items',
                id,
              ) as ItemRow | null;
              if (row?.rel_path) await library.erase(row.rel_path).catch(() => undefined);
              store.remove('items', id);
            }
          })
        : null;
      return { created: dtos(created.map((id) => getRow(id))), skipped, undoId };
    });

    // --- Changing an element -------------------------------------------------------------

    /** Name, context (the file moves: one transaction, back on failure), pinned, Arrivée. */
    ctx.routes.patch('/items/:id', async (request) => {
      const id = uuidParam(request.params);
      const row = getRow(id);
      if (row.trashed_at) throw new HttpError(409, 'Dans la corbeille : le récupérer d’abord');
      const b = requestBody(request);
      const fields: Record<string, string | number | null> = {};
      if (typeof b.pinned === 'boolean') fields.pinned = b.pinned ? 1 : 0;
      const contextChange = 'contextId' in b || 'newContext' in b || b.arrival === true;
      let contextId = row.context_id;
      if (contextChange) {
        contextId =
          b.arrival === true
            ? null
            : Array.isArray(b.newContext) && b.newContext.length
              ? ensureContext(b.newContext.map(String))
              : typeof b.contextId === 'string' && b.contextId
                ? b.contextId
                : null;
        if (contextId) folderOf(contextId); // 404 when it does not exist
        fields.context_id = contextId;
        fields.arrival = contextId ? 0 : 1;
      }
      const newName = typeof b.name === 'string' && b.name.trim() ? safeName(b.name) : null;
      const before = { rel: row.rel_path, undo: { ...row } };
      let moved: string | null = null;
      if (row.rel_path && (contextChange || (newName && newName !== row.name))) {
        moved = await library.move(
          row.rel_path,
          contextId ? folderOf(contextId) : ARRIVAL_FOLDER,
          newName ?? row.name,
        );
        fields.rel_path = moved;
        fields.name = path.posix.basename(moved);
      } else if (newName) fields.name = newName;
      try {
        if (Object.keys(fields).length) store.update('items', id, fields);
      } catch (error) {
        if (moved && before.rel) {
          const back = path.posix.dirname(before.rel);
          await library.move(moved, back === '.' ? '' : back, path.posix.basename(before.rel));
        }
        throw error;
      }
      const undoId = remember(async () => {
        const now = getRow(id);
        const restore: Record<string, string | number | null> = {
          pinned: before.undo.pinned,
          context_id: before.undo.context_id,
          arrival: before.undo.arrival,
          name: before.undo.name,
        };
        if (now.rel_path && before.rel && now.rel_path !== before.rel) {
          const back = path.posix.dirname(before.rel);
          restore.rel_path = await library.move(
            now.rel_path,
            back === '.' ? '' : back,
            path.posix.basename(before.rel),
          );
          restore.name = path.posix.basename(String(restore.rel_path));
        }
        store.update('items', id, restore);
      });
      return { item: one(id), undoId };
    });

    /**
     * PUT /items/:id/attributes { key, values }: Thomas's values for a key
     * (« choisi »: never replaced by a deduction); no value removes the key.
     */
    ctx.routes.put('/items/:id/attributes', (request) => {
      const id = uuidParam(request.params);
      getRow(id);
      const b = requestBody(request);
      const key = String(b.key) as AttributeKey;
      if (!ATTRIBUTE_KEYS.includes(key)) throw new HttpError(400, 'Attribut inconnu');
      const values = (Array.isArray(b.values) ? b.values : [])
        .map((v) => String(v).trim())
        .filter(Boolean);
      if (key !== 'tag' && values.length > 1)
        throw new HttpError(400, 'Une seule valeur pour cet attribut');
      const before =
        attributesOf([id])
          .get(id)
          ?.filter((a) => a.key === key) ?? [];
      const replace = (list: AttributeDto[]) =>
        ctx.db.transaction(() => {
          const rows = ctx.db
            .prepare(
              `SELECT id FROM ${attributes} WHERE deleted_at IS NULL AND item_id = ? AND key = ?`,
            )
            .all(id, key) as { id: string }[];
          for (const r of rows) store.remove('attributes', r.id);
          writeAttributes(id, list);
        });
      replace(values.map((value) => ({ key, value, origin: 'chosen', reason: null })));
      const undoId = remember(async () => replace(before));
      return { item: one(id), undoId };
    });

    /** Re-run the deductions on an element: Thomas's choices are kept (mergeGuesses). */
    ctx.routes.post('/items/:id/guess', (request) => {
      const id = uuidParam(request.params);
      const row = getRow(id);
      const current = attributesOf([id]).get(id) ?? [];
      const guessed = deduce({
        name: row.name,
        isDirectory: row.kind === 'project',
        fileDate: row.file_date,
        provenance:
          row.source_url || row.referrer_url
            ? { zone: 3, hostUrl: row.source_url, referrerUrl: row.referrer_url }
            : null,
        contexts: contextRefs(),
        courses: coursesSafe(),
        sites: sitesSeen(),
      });
      const merged = mergeGuesses(current, guessed.attributes);
      ctx.db.transaction(() => {
        const rows = ctx.db
          .prepare(`SELECT id FROM ${attributes} WHERE deleted_at IS NULL AND item_id = ?`)
          .all(id) as { id: string }[];
        for (const r of rows) store.remove('attributes', r.id);
        writeAttributes(id, merged);
      });
      return one(id);
    });

    /** « Aussi utilisé » in another context (a link, never a copy). */
    ctx.routes.post('/items/:id/also', (request) => {
      const id = uuidParam(request.params);
      getRow(id);
      const contextId = String(requestBody(request).contextId ?? '');
      folderOf(contextId);
      const exists = ctx.db
        .prepare(
          `SELECT id FROM ${also} WHERE deleted_at IS NULL AND item_id = ? AND context_id = ?`,
        )
        .get(id, contextId);
      if (!exists) store.create('also', { item_id: id, context_id: contextId });
      return one(id);
    });
    ctx.routes.delete('/items/:id/also/:context', (request) => {
      const { id, context } = request.params as { id: string; context: string };
      const rows = ctx.db
        .prepare(
          `SELECT id FROM ${also} WHERE deleted_at IS NULL AND item_id = ? AND context_id = ?`,
        )
        .all(id, context) as { id: string }[];
      for (const r of rows) store.remove('also', r.id);
      return one(id);
    });

    // --- The Coffre's Recycle Bin (règle 3) -------------------------------------------

    const trash = async (row: ItemRow) => {
      let relPath = row.rel_path;
      if (row.rel_path && library.exists(row.rel_path))
        relPath = await library.move(row.rel_path, `${TRASH_FOLDER}/${row.id}`);
      store.update('items', row.id, {
        trashed_at: new Date().toISOString(),
        trash_from: row.rel_path ? path.posix.dirname(row.rel_path) : null,
        rel_path: relPath,
        pinned: 0,
      });
    };
    const restore = async (row: ItemRow) => {
      // Back in its context (or in Arrivée when that context is gone).
      const contextOk = row.context_id && contextRows().some((c) => c.id === row.context_id);
      const dir = contextOk ? folderOf(row.context_id) : ARRIVAL_FOLDER;
      let relPath = row.rel_path;
      if (row.rel_path && library.exists(row.rel_path))
        relPath = await library.move(row.rel_path, dir);
      store.update('items', row.id, {
        trashed_at: null,
        trash_from: null,
        rel_path: relPath,
        ...(contextOk ? {} : { context_id: null, arrival: 1 }),
      });
    };
    ctx.routes.delete('/items/:id', async (request) => {
      const id = uuidParam(request.params);
      const row = getRow(id);
      if (row.trashed_at) throw new HttpError(409, 'Déjà dans la corbeille');
      await trash(row);
      const undoId = remember(async () => restore(getRow(id)));
      return { ok: true, undoId };
    });
    ctx.routes.post('/items/:id/restore', async (request) => {
      const id = uuidParam(request.params);
      const row = getRow(id);
      if (!row.trashed_at) return one(id);
      await restore(row);
      return one(id);
    });
    /** Erase for good (only from the Recycle Bin, and only when the page confirmed). */
    ctx.routes.post('/items/:id/erase', async (request) => {
      const id = uuidParam(request.params);
      const row = getRow(id);
      if (!row.trashed_at) throw new HttpError(409, 'Seulement depuis la corbeille du Coffre');
      if (requestBody(request).confirm !== true)
        throw new HttpError(400, 'Effacement définitif : confirmation nécessaire');
      if (row.rel_path) await library.erase(row.rel_path);
      const trashDir = `${TRASH_FOLDER}/${row.id}`;
      if (library.exists(trashDir)) await library.erase(trashDir);
      ctx.db.transaction(() => {
        const rows = ctx.db
          .prepare(`SELECT id FROM ${attributes} WHERE deleted_at IS NULL AND item_id = ?`)
          .all(id) as { id: string }[];
        for (const r of rows) store.remove('attributes', r.id);
        store.remove('items', id);
      });
      return { ok: true };
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

    /** VS Code's program, when it is installed (Windows' usual places, else « code » in the PATH). */
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
    ctx.routes.get('/tools', () => ({ vscode: vscode() !== null }));

    /**
     * POST /items/:id/open { how: 'app' | 'folder' | 'vscode', runnable? }:
     * its application (Windows'), its folder in the Explorer, or VS Code for a
     * project. A program or a script only with `runnable: true` (the page asked,
     * naming it).
     */
    ctx.routes.post('/items/:id/open', async (request) => {
      const row = getRow(uuidParam(request.params));
      const file = absOf(row);
      if (!file || !existsSync(file)) throw new HttpError(404, 'Fichier introuvable sur le disque');
      const b = requestBody(request);
      if (b.how === 'folder') {
        ctx.files.reveal(file);
        return { ok: true };
      }
      if (b.how === 'vscode') {
        const exe = vscode();
        if (!exe) throw new HttpError(404, 'VS Code n’est pas installé');
        spawn(exe, [file], { detached: true, stdio: 'ignore' }).unref();
        return { ok: true };
      }
      if (isRunnable(file) && b.runnable !== true)
        throw new HttpError(
          409,
          `« ${path.basename(file)} » lance un programme : confirmation nécessaire`,
        );
      await ctx.files.open(file, { runnable: b.runnable === true });
      return { ok: true };
    });

    // The Coffre's folders exist from the first opening (readable in the Explorer).
    try {
      library.ensure();
    } catch (error) {
      ctx.logger.warn(`Dossier du Coffre non créé : ${String(error)}`);
    }
  },
});
