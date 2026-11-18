// The Agenda's categories. v0.42.0: a list managed by Thomas. v0.43.0
// (Expérimental, ADR 0049): categories are OBJECTS with an identifier and
// settings that act (colour, counted in the load, shown by default,
// conflicts flagged, default type / duration / place, order). Every element
// points to its category by `category_id`; its `category` text stays
// readable (compatibility, references) but is no longer the truth: a
// rename touches ONE row, and everything follows by the identifier.
// Identifiers of the categories the migration seeds — and of any category
// the Agenda makes for a name — are a UUID v5 of the folded name: the same
// on the PC and the phone (no duplicate, no conflict at the next sync).
// Categories Thomas creates by hand get a random UUID. Delete (his own only):
// elements moved, never deleted; backup, « Annuler ».
import {
  HttpError,
  type MigrationDatabase,
  type ModuleContext,
  newId,
  requestBody,
  SYNC_COLUMNS,
  SyncStore,
} from '@hub/sdk/core';
import {
  categoryKey,
  categoryList,
  type CategoryDto,
  type CategoryRowLike,
  type CategoryShape,
  DEFAULT_OFF,
  defaultShape,
  mergeCategories,
} from '../shared/categories';
import { categoryIdOf, foldName } from '../shared/category-id';
import { isColorValue } from '../shared/palette';

export interface CategoryRow extends CategoryRowLike {
  key: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** How long « Annuler » stays possible after a rename or a delete. */
const UNDO_MS = 10 * 60_000;
const MAX_NAME = 40;
const MAX_DURATION = 24 * 60;

type Op =
  | { kind: 'created' | 'removed'; table: string; id: string }
  | { kind: 'updated'; table: string; id: string; before: Record<string, string | number | null> };

/** A name: trimmed, single spaces, at most 40 characters. */
export function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
}

function parseJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

// --- Migration 7 (published: never change it) -----------------------------------------

/**
 * v0.43.0: the columns of the objects, then every category in use becomes a
 * row with its values of NOW (colour of before, counted, shown as the
 * setting says), its identifier derived from its name (`categoryIdOf`), so
 * the PC and the phone, each migrating alone, write the same rows. The rows
 * v0.42 already wrote keep their identifier and values. Then the added
 * columns are filled: `category_id` of events, week type and sources, and
 * `kind` (« deadline » in a category of that shape). Nothing else is written;
 * not journaled (the same on every device: nothing to send).
 */
export function migrateCategoriesToObjects(db: MigrationDatabase): void {
  // The lists of v0.43.0, frozen here (a published migration never changes).
  const FIXED = ['Rendez-vous', 'Cours', 'Réunions', 'Examens', 'Loisirs', 'Perso', 'Deadline'];
  const TOOLS = ['Tâches', 'Sport', 'Repas', 'Cuisine', 'Timer', 'Musique'];
  db.exec(`
    ALTER TABLE agenda__categories ADD COLUMN conflicts INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE agenda__categories ADD COLUMN default_duration INTEGER;
    ALTER TABLE agenda__categories ADD COLUMN default_location TEXT;
    ALTER TABLE agenda__categories ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE agenda__categories ADD COLUMN found INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE agenda__events ADD COLUMN category_id TEXT;
    ALTER TABLE agenda__events ADD COLUMN kind TEXT NOT NULL DEFAULT 'rendez-vous';
    ALTER TABLE agenda__weekly ADD COLUMN category_id TEXT;
    ALTER TABLE agenda__sources ADD COLUMN mapping_ids TEXT;
    ALTER TABLE agenda__sources ADD COLUMN default_category_id TEXT;
    CREATE TABLE agenda__task_categories (${SYNC_COLUMNS},
      task_id TEXT NOT NULL, category_id TEXT NOT NULL);
    CREATE UNIQUE INDEX agenda__task_categories_task ON agenda__task_categories (task_id)
      WHERE deleted_at IS NULL;
    CREATE INDEX agenda__events_category ON agenda__events (category_id);
  `);
  const builtinFold = new Map([...FIXED, ...TOOLS].map((n) => [foldName(n), n]));
  // The setting « Catégories éteintes par défaut » as it is now (read only).
  let offText = 'Sport, Repas, Timer';
  try {
    const row = db
      .prepare("SELECT value FROM core__settings WHERE scope = 'agenda' AND key = 'categoriesOff'")
      .get() as { value: string | null } | undefined;
    if (row?.value) offText = String(JSON.parse(row.value));
  } catch {
    // No setting table (never on a real device): the default.
  }
  const off = new Set(categoryList(offText).map(foldName));

  // Every name in use: fixed, tools, events and week type (deleted ones too:
  // a restore must find its category), import mappings.
  const names: string[] = [...FIXED, ...TOOLS];
  for (const t of ['agenda__events', 'agenda__weekly'])
    for (const r of db.prepare(`SELECT DISTINCT category FROM ${t}`).all() as {
      category: string;
    }[])
      names.push(r.category);
  const sources = db.prepare('SELECT id, mapping, default_category FROM agenda__sources').all() as {
    id: string;
    mapping: string;
    default_category: string;
  }[];
  for (const s of sources) {
    names.push(s.default_category);
    names.push(...Object.values(parseJson<Record<string, string>>(s.mapping, {})));
  }

  // The rows v0.42 wrote keep their id; the others are seeded.
  const existing = db
    .prepare('SELECT id, name, shape, mine FROM agenda__categories WHERE deleted_at IS NULL')
    .all() as { id: string; name: string; shape: string; mine: number }[];
  const byFold = new Map<string, { id: string; shape: string }>();
  for (const r of existing) byFold.set(foldName(r.name), { id: r.id, shape: r.shape });
  for (const r of existing)
    if (builtinFold.has(foldName(r.name)))
      db.prepare('UPDATE agenda__categories SET builtin = 1 WHERE id = ?').run(r.id);
    // A v0.42 row of a name only found in his data (« used »): found, as before (no switch of its own).
    else if (r.mine === 0)
      db.prepare('UPDATE agenda__categories SET found = 1 WHERE id = ?').run(r.id);

  // Variants of one name (« Réunions », « reunions »): one category, its name
  // the fixed one, else the smallest variant (the same choice on every device).
  const variants = new Map<string, string[]>();
  for (const n of names) {
    const clean = String(n ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const fold = foldName(clean);
    if (!fold) continue;
    variants.set(fold, [...(variants.get(fold) ?? []), clean]);
  }
  const now = '2026-11-18T00:00:00.000Z';
  const insert = db.prepare(
    `INSERT INTO agenda__categories (id, created_at, updated_at, deleted_at, key, name, color,
       shape, counted, shown, sort, mine, conflicts, default_duration, default_location, builtin,
       found)
     VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, 1, ?, NULL, ?, 1, NULL, NULL, ?, ?)`,
  );
  for (const [fold, list] of [...variants].sort(([a], [b]) => a.localeCompare(b))) {
    if (byFold.has(fold)) continue;
    const name = builtinFold.get(fold) ?? [...new Set(list)].sort()[0]!;
    const id = categoryIdOf(name);
    const shape = fold === 'deadline' ? 'deadline' : 'normal';
    const builtin = builtinFold.has(fold) ? 1 : 0;
    insert.run(
      id,
      now,
      now,
      categoryKey(name),
      name,
      shape,
      off.has(fold) ? 0 : 1,
      1 - builtin,
      builtin,
      // Found in his data, never created (v0.42 « used »): no switch outside its period.
      1 - builtin,
    );
    byFold.set(fold, { id, shape });
  }

  // The added columns, filled the same way on every device.
  const idOf = (name: string) => byFold.get(foldName(String(name ?? '')))?.id ?? null;
  const shapeOf = (name: string) => byFold.get(foldName(String(name ?? '')))?.shape ?? 'normal';
  for (const t of ['agenda__events', 'agenda__weekly'])
    for (const r of db.prepare(`SELECT DISTINCT category FROM ${t}`).all() as {
      category: string;
    }[]) {
      db.prepare(`UPDATE ${t} SET category_id = ? WHERE category = ?`).run(
        idOf(r.category),
        r.category,
      );
      if (t === 'agenda__events' && shapeOf(r.category) === 'deadline')
        db.prepare("UPDATE agenda__events SET kind = 'deadline' WHERE category = ?").run(
          r.category,
        );
    }
  for (const s of sources) {
    const mapping = parseJson<Record<string, string>>(s.mapping, {});
    const ids = Object.fromEntries(
      Object.entries(mapping).flatMap(([k, v]) => {
        const id = idOf(v);
        return id ? [[k, id]] : [];
      }),
    );
    db.prepare(
      'UPDATE agenda__sources SET mapping_ids = ?, default_category_id = ? WHERE id = ?',
    ).run(JSON.stringify(ids), idOf(s.default_category), s.id);
  }
}

// --- Runtime ----------------------------------------------------------------------

/** What an element's category resolves to, by its id first, else by its name. */
export interface CategoryLookup {
  byId: Map<string, CategoryDto>;
  byFold: Map<string, CategoryDto>;
  /** The category of an element (never none: a name without a row is shown as is). */
  of(name: string, id?: string | null): CategoryDto | null;
  /** Its current name (a renamed category: the new name). */
  nameOf(name: string, id?: string | null): string;
}

export function registerCategories(ctx: ModuleContext, store: SyncStore) {
  const table = ctx.db.table('categories');
  const events = ctx.db.table('events');
  const weekly = ctx.db.table('weekly');
  const sources = ctx.db.table('sources');
  const taskCats = ctx.db.table('task_categories');
  const undo = new Map<string, { ops: Op[]; at: number }>();

  const rows = () =>
    ctx.db
      .prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY sort, name`)
      .all() as CategoryRow[];

  const offByDefault = () =>
    categoryList(ctx.settings.get<string>('categoriesOff') ?? DEFAULT_OFF.join(', '));

  /** The list: rows, plus names in the data without a row yet; counts by category. */
  const list = (): CategoryDto[] => {
    const live = rows();
    const byId = new Map(live.map((r) => [r.id, foldName(r.name)]));
    const counts = new Map<string, number>();
    const names: string[] = [];
    for (const t of [events, weekly])
      for (const r of ctx.db
        .prepare(
          `SELECT category, category_id, COUNT(*) AS n FROM ${t} WHERE deleted_at IS NULL GROUP BY category, category_id`,
        )
        .all() as { category: string; category_id: string | null; n: number }[]) {
        const fold = (r.category_id && byId.get(r.category_id)) || foldName(r.category);
        counts.set(fold, (counts.get(fold) ?? 0) + r.n);
        if (!r.category_id || !byId.has(r.category_id)) names.push(r.category);
      }
    for (const s of ctx.db
      .prepare(`SELECT mapping, default_category FROM ${sources} WHERE deleted_at IS NULL`)
      .all() as { mapping: string; default_category: string }[])
      names.push(
        s.default_category,
        ...Object.values(parseJson<Record<string, string>>(s.mapping, {})),
      );
    return mergeCategories({
      rows: live,
      counts,
      names,
      offByDefault: offByDefault(),
      idOf: categoryIdOf,
    });
  };

  const lookup = (all = list()): CategoryLookup => {
    const byId = new Map(all.map((c) => [c.id, c]));
    const byFold = new Map(all.map((c) => [foldName(c.name), c]));
    const of = (name: string, id?: string | null) =>
      (id ? byId.get(id) : undefined) ?? byFold.get(foldName(name)) ?? null;
    return { byId, byFold, of, nameOf: (name, id) => of(name, id)?.name ?? name };
  };

  const find = (ref: string) => {
    const c = lookup().of(ref, ref);
    if (!c) throw new HttpError(404, 'Catégorie introuvable');
    return c;
  };

  /** The default type of a category (« deadline » or « normal »). */
  const shapeOf = (name: string, id?: string | null): CategoryShape =>
    lookup().of(name, id)?.shape ?? defaultShape(name);

  /**
   * The row of a category, written when it has none yet (its identifier from
   * its name: the same on every device). Inside a write of the user.
   */
  const ensure = (c: CategoryDto, ops?: Op[]): CategoryRow => {
    const live = store.get<CategoryRow>('categories', c.id);
    if (live) return live;
    const any = store.get<CategoryRow>('categories', c.id, true);
    if (any) {
      store.restore('categories', c.id);
      ops?.push({ kind: 'created', table: 'categories', id: c.id });
      return store.get<CategoryRow>('categories', c.id)!;
    }
    const made = store.create<CategoryRow>(
      'categories',
      {
        key: c.key,
        name: c.name,
        color: null,
        shape: c.shape,
        counted: c.counted ? 1 : 0,
        shown: c.shownByDefault ? 1 : 0,
        sort: null,
        mine: c.origin === 'mine' ? 1 : 0,
        conflicts: 1,
        default_duration: null,
        default_location: null,
        builtin: c.origin === 'mine' ? 0 : 1,
        // A name found in his data (not created): no switch outside its period, as before.
        found: c.origin === 'mine' ? 1 : 0,
      },
      c.id,
    );
    ops?.push({ kind: 'created', table: 'categories', id: made.id });
    return made;
  };

  /**
   * The category an element is written with: `categoryId` (must exist), else
   * the name (a new name: a category is made for it). Returns its id and name.
   */
  const resolve = (input: { categoryId?: unknown; category?: unknown }, fallback: string) => {
    const l = lookup();
    if (typeof input.categoryId === 'string' && input.categoryId) {
      const c = l.byId.get(input.categoryId);
      if (c) return { id: ensure(c).id, name: c.name };
      // An id or a name (« Deadline » chosen in the bar): the name decides.
      if (!input.category) throw new HttpError(400, 'Catégorie introuvable');
    }
    const name = cleanName(input.category) || fallback;
    const c =
      l.byFold.get(foldName(name)) ??
      mergeCategories({
        rows: [],
        counts: new Map(),
        names: [name],
        offByDefault: offByDefault(),
        idOf: categoryIdOf,
      }).find((x) => foldName(x.name) === foldName(name))!;
    return { id: ensure(c).id, name: c.name };
  };

  const remember = (ops: Op[]) => {
    const id = newId();
    const at = Date.now();
    for (const [k, u] of undo) if (at - u.at > UNDO_MS) undo.delete(k);
    undo.set(id, { ops, at });
    return id;
  };

  const update = (c: CategoryDto, fields: Record<string, string | number | null>, ops: Op[]) => {
    const row = ensure(c, ops);
    const before = Object.fromEntries(
      Object.keys(fields).map((k) => [k, row[k as keyof CategoryRow] as string | number | null]),
    );
    const changed = Object.fromEntries(
      Object.entries(fields).filter(([k, v]) => row[k as keyof CategoryRow] !== v),
    );
    if (!Object.keys(changed).length) return;
    store.update('categories', row.id, changed);
    ops.push({ kind: 'updated', table: 'categories', id: row.id, before });
  };

  /** Unique without case, accents nor extra spaces. */
  const checkFree = (name: string, except?: string) => {
    if (!name) throw new HttpError(400, 'Nom : obligatoire');
    const other = lookup().byFold.get(foldName(name));
    if (other && other.id !== except)
      throw new HttpError(409, `La catégorie « ${other.name} » existe déjà.`);
  };
  const colorFrom = (value: unknown): string | null => {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !isColorValue(value))
      throw new HttpError(400, 'Couleur invalide (p:<teinte> ou #rrggbb)');
    return value.toLowerCase();
  };
  const shapeFrom = (value: unknown): CategoryShape => {
    if (value === 'normal' || value === 'rendez-vous') return 'normal';
    if (value === 'deadline') return 'deadline';
    throw new HttpError(400, 'Type par défaut invalide (rendez-vous ou deadline)');
  };
  const durationFrom = (value: unknown): number | null => {
    if (value === null || value === '' || value === undefined) return null;
    const d = Number(value);
    if (!(Number.isInteger(d) && d > 0 && d <= MAX_DURATION))
      throw new HttpError(400, 'Durée par défaut invalide (en minutes)');
    return d;
  };
  const placeFrom = (value: unknown): string | null =>
    typeof value === 'string' && value.trim()
      ? value.replace(/\s+/g, ' ').trim().slice(0, 200)
      : null;

  /** The settings a request may set (any category). */
  const settingsFrom = (body: Record<string, unknown>) => {
    const fields: Record<string, string | number | null> = {};
    if ('color' in body) fields.color = colorFrom(body.color);
    if ('counted' in body) fields.counted = body.counted === true ? 1 : 0;
    if ('shownByDefault' in body) fields.shown = body.shownByDefault === true ? 1 : 0;
    if ('conflicts' in body) fields.conflicts = body.conflicts === true ? 1 : 0;
    if ('shape' in body) fields.shape = shapeFrom(body.shape);
    if ('defaultKind' in body) fields.shape = shapeFrom(body.defaultKind);
    if ('defaultDuration' in body) fields.default_duration = durationFrom(body.defaultDuration);
    if ('defaultLocation' in body) fields.default_location = placeFrom(body.defaultLocation);
    return fields;
  };

  // --- Routes ------------------------------------------------------------------

  ctx.routes.get('/categories', () => list());

  /** « Nouvelle catégorie » (Réglages, the sheet, the bar, a slot): a random UUID. */
  ctx.routes.post('/categories', (request) => {
    const body = requestBody(request);
    const name = cleanName(body.name);
    checkFree(name);
    const live = rows();
    const max = live.reduce((m, r) => Math.max(m, r.sort ?? -1), -1);
    const hasOrder = live.some((r) => r.sort !== null);
    const made = store.create<CategoryRow>('categories', {
      key: categoryKey(name),
      name,
      color: null,
      shape: 'normal',
      counted: 1,
      shown: 1,
      sort: hasOrder ? max + 1 : null,
      mine: 1,
      conflicts: 1,
      default_duration: null,
      default_location: null,
      builtin: 0,
      ...settingsFrom(body),
    });
    return find(made.id);
  });

  /** Its settings (any category; the type by default, Thomas's ones only). */
  ctx.routes.patch('/categories/:key', (request) => {
    const c = find(keyParam(request.params));
    const body = requestBody(request);
    const fields = settingsFrom(body);
    if ('shape' in fields && c.origin !== 'mine' && fields.shape !== c.shape)
      throw new HttpError(403, 'Le type par défaut ne change que pour tes propres catégories.');
    if (Object.keys(fields).length) ctx.db.transaction(() => update(c, fields, []));
    return find(c.id);
  });

  /** The order of the list (ids or keys, first to last). */
  ctx.routes.put('/categories/order', (request) => {
    const refs = requestBody(request).keys;
    if (!Array.isArray(refs)) throw new HttpError(400, 'Ordre invalide');
    const all = list();
    const l = lookup(all);
    const wanted = refs
      .map((r) => l.of(String(r), String(r)))
      .filter((c): c is CategoryDto => Boolean(c));
    const order = [...wanted, ...all.filter((c) => !wanted.some((w) => w.id === c.id))];
    ctx.db.transaction(() => order.forEach((c, sort) => update(c, { sort }, [])));
    return list();
  });

  /**
   * Rename one of Thomas's categories: ONLY its row (the elements follow by
   * the identifier). « Annuler ».
   */
  ctx.routes.post('/categories/:key/rename', (request) => {
    const c = find(keyParam(request.params));
    if (c.origin !== 'mine')
      throw new HttpError(
        403,
        'Les catégories de l’Agenda et des autres outils ne se renomment pas.',
      );
    const name = cleanName(requestBody(request).name);
    checkFree(name, c.id);
    if (name === c.name) return { category: c, undoId: null, backup: null };
    const ops: Op[] = [];
    ctx.db.transaction(() => update(c, { name, key: categoryKey(name) }, ops));
    return { category: find(c.id), undoId: remember(ops), backup: null };
  });

  /** Elements of a category (live), by its id or, without one, by its name. */
  const elementsOf = (c: CategoryDto, t: 'events' | 'weekly') =>
    (
      ctx.db
        .prepare(
          `SELECT id, category, category_id FROM ${ctx.db.table(t)} WHERE deleted_at IS NULL AND (category_id = ? OR category_id IS NULL)`,
        )
        .all(c.id) as { id: string; category: string; category_id: string | null }[]
    ).filter((r) => r.category_id === c.id || foldName(r.category) === foldName(c.name));

  /**
   * Delete one of Thomas's categories. Its events, week-type entries, tasks
   * and import mappings move to `moveTo` (an id or a name; required when it
   * has any): never deleted. Confirmation (the page), backup, « Annuler ».
   */
  ctx.routes.delete('/categories/:key', (request) => {
    const c = find(keyParam(request.params));
    if (c.origin !== 'mine')
      throw new HttpError(
        403,
        'Les catégories de l’Agenda et des autres outils ne se suppriment pas.',
      );
    const moveRef = String((request.query as { moveTo?: string } | undefined)?.moveTo ?? '');
    const target = moveRef ? lookup().of(moveRef, moveRef) : null;
    const items = [...elementsOf(c, 'events'), ...elementsOf(c, 'weekly')];
    const links = ctx.db
      .prepare(`SELECT id FROM ${taskCats} WHERE deleted_at IS NULL AND category_id = ?`)
      .all(c.id) as { id: string }[];
    const srcs = (
      ctx.db
        .prepare(
          `SELECT id, mapping, mapping_ids, default_category, default_category_id FROM ${sources} WHERE deleted_at IS NULL`,
        )
        .all() as {
        id: string;
        mapping: string;
        mapping_ids: string | null;
        default_category: string;
        default_category_id: string | null;
      }[]
    ).filter(
      (s) =>
        s.default_category_id === c.id ||
        Object.values(parseJson<Record<string, string>>(s.mapping_ids, {})).includes(c.id) ||
        foldName(s.default_category) === foldName(c.name) ||
        Object.values(parseJson<Record<string, string>>(s.mapping, {})).some(
          (v) => foldName(v) === foldName(c.name),
        ),
    );
    const busy = items.length + links.length + srcs.length > 0;
    if (busy && !target) throw new HttpError(400, 'Choisis où déplacer ses éléments (moveTo).');
    if (target && target.id === c.id) throw new HttpError(400, 'Choisis une autre catégorie.');
    const backup = ctx.db.backup('avant suppression d’une catégorie de l’Agenda');
    const ops: Op[] = [];
    ctx.db.transaction(() => {
      if (target) {
        const to = ensure(target, ops);
        for (const t of ['events', 'weekly'] as const)
          for (const r of elementsOf(c, t)) {
            store.update(t, r.id, { category_id: to.id, category: to.name });
            ops.push({
              kind: 'updated',
              table: t,
              id: r.id,
              before: { category_id: r.category_id, category: r.category },
            });
          }
        for (const r of links) {
          store.update('task_categories', r.id, { category_id: to.id });
          ops.push({
            kind: 'updated',
            table: 'task_categories',
            id: r.id,
            before: { category_id: c.id },
          });
        }
        for (const s of srcs) {
          const mapping = parseJson<Record<string, string>>(s.mapping, {});
          const ids = parseJson<Record<string, string>>(s.mapping_ids, {});
          for (const k of Object.keys(mapping))
            if (ids[k] === c.id || foldName(mapping[k]!) === foldName(c.name)) {
              mapping[k] = to.name;
              ids[k] = to.id;
            }
          const own =
            s.default_category_id === c.id || foldName(s.default_category) === foldName(c.name);
          store.update('sources', s.id, {
            mapping: JSON.stringify(mapping),
            mapping_ids: JSON.stringify(ids),
            ...(own ? { default_category: to.name, default_category_id: to.id } : {}),
          });
          ops.push({
            kind: 'updated',
            table: 'sources',
            id: s.id,
            before: {
              mapping: s.mapping,
              mapping_ids: s.mapping_ids,
              ...(own
                ? {
                    default_category: s.default_category,
                    default_category_id: s.default_category_id,
                  }
                : {}),
            },
          });
        }
      }
      if (c.stored) {
        store.remove('categories', c.id);
        ops.push({ kind: 'removed', table: 'categories', id: c.id });
      }
    });
    return { ok: true, moved: items.length, undoId: remember(ops), backup };
  });

  /** « Annuler » a rename or a delete: everything it did, undone (in the reverse order). */
  ctx.routes.post('/categories/undo', (request) => {
    const id = String(requestBody(request).undoId ?? '');
    const entry = undo.get(id);
    if (!entry || Date.now() - entry.at > UNDO_MS)
      throw new HttpError(404, 'Ce changement ne peut plus être annulé.');
    undo.delete(id);
    ctx.db.transaction(() => {
      for (const op of [...entry.ops].reverse()) {
        if (op.kind === 'created') store.remove(op.table, op.id);
        else if (op.kind === 'removed') store.restore(op.table, op.id);
        else if (op.kind === 'updated') store.update(op.table, op.id, op.before);
      }
    });
    return list();
  });

  // --- v0.43.0: a category of the Agenda for a task of the To-do --------------
  // The To-do does not change: the Agenda keeps its own table (task → category).

  const taskLinks = () =>
    new Map(
      (
        ctx.db
          .prepare(`SELECT task_id, category_id FROM ${taskCats} WHERE deleted_at IS NULL`)
          .all() as { task_id: string; category_id: string }[]
      ).map((r) => [r.task_id, r.category_id]),
    );

  /** Give a task a category (`categoryId`), or none (`null`: « Tâches » as before). */
  ctx.routes.put('/tasks/:id/category', (request) => {
    const taskId = String((request.params as { id?: string }).id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new HttpError(400, 'Tâche invalide');
    const body = requestBody(request);
    const live = ctx.db
      .prepare(`SELECT id, category_id FROM ${taskCats} WHERE deleted_at IS NULL AND task_id = ?`)
      .get(taskId) as { id: string; category_id: string } | undefined;
    const before = live?.category_id ?? null;
    ctx.db.transaction(() => {
      if (!body.categoryId && !body.category) {
        if (live) store.remove('task_categories', live.id);
        return;
      }
      const to = resolve({ categoryId: body.categoryId, category: body.category }, '');
      if (live) store.update('task_categories', live.id, { category_id: to.id });
      else store.create('task_categories', { task_id: taskId, category_id: to.id });
    });
    return { taskId, categoryId: taskLinks().get(taskId) ?? null, before };
  });

  return { list, lookup, shapeOf, resolve, taskLinks };
}

const keyParam = (params: unknown) => String((params as { key?: string } | null)?.key ?? '');
