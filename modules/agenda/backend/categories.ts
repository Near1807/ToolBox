// v0.42.0 (Expérimental): the Agenda's categories, a list managed by Thomas.
// The table agenda__categories holds only what he changed or created (a
// colour, « comptée », « affichée par défaut », the order, the shape of his
// own ones); without a row a category keeps exactly its values of before,
// and nothing is written at the opening. Rename and delete (his own ones
// only): backup first, one transaction (events, week type, import mappings,
// the setting), « Annuler » for a while. Events are never deleted: they move
// to the category he chose.
import { HttpError, type ModuleContext, newId, requestBody, SyncStore } from '@hub/sdk/core';
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
import { readOrigin } from '../shared/importing';
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

type Op =
  | { kind: 'created' | 'removed'; table: string; id: string }
  | { kind: 'updated'; table: string; id: string; before: Record<string, string | number | null> }
  | { kind: 'setting'; key: string; before: string | null };

/** A name: trimmed, single spaces, at most 40 characters. */
export function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
}

export function registerCategories(ctx: ModuleContext, store: SyncStore) {
  const table = ctx.db.table('categories');
  const events = ctx.db.table('events');
  const weekly = ctx.db.table('weekly');
  const sources = ctx.db.table('sources');
  const undo = new Map<string, { ops: Op[]; at: number }>();

  const rows = () =>
    ctx.db
      .prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY sort, name`)
      .all() as CategoryRow[];
  const rowOf = (key: string) => rows().find((r) => r.key === key) ?? null;

  /** Every name found in the data, with its number of events and week-type entries. */
  const used = () => {
    const out = new Map<string, number>();
    const count = (name: string, n: number) => out.set(name, (out.get(name) ?? 0) + n);
    for (const t of [events, weekly])
      for (const r of ctx.db
        .prepare(
          `SELECT category, COUNT(*) AS n FROM ${t} WHERE deleted_at IS NULL GROUP BY category`,
        )
        .all() as { category: string; n: number }[])
        count(r.category, r.n);
    for (const s of ctx.db
      .prepare(`SELECT mapping, default_category FROM ${sources} WHERE deleted_at IS NULL`)
      .all() as { mapping: string; default_category: string }[]) {
      count(s.default_category, 0);
      for (const c of Object.values(parseMapping(s.mapping))) count(c, 0);
    }
    return out;
  };
  const offByDefault = () =>
    categoryList(ctx.settings.get<string>('categoriesOff') ?? DEFAULT_OFF.join(', '));

  const list = (): CategoryDto[] =>
    mergeCategories({ rows: rows(), used: used(), offByDefault: offByDefault() });
  const find = (key: string) => {
    const c = list().find((x) => x.key === categoryKey(key));
    if (!c) throw new HttpError(404, 'Catégorie introuvable');
    return c;
  };

  /** The shape of a category (its row, else « Deadline » → deadline). */
  const shapeOf = (name: string): CategoryShape => {
    const row = rowOf(categoryKey(name));
    return row?.shape === 'deadline' || row?.shape === 'normal' ? row.shape : defaultShape(name);
  };

  const remember = (ops: Op[]) => {
    const id = newId();
    const at = Date.now();
    for (const [k, u] of undo) if (at - u.at > UNDO_MS) undo.delete(k);
    undo.set(id, { ops, at });
    return id;
  };

  /** Write a row for this category (Thomas's change over the default), or update it. */
  const upsert = (c: CategoryDto, fields: Record<string, string | number | null>, ops: Op[]) => {
    const row = rowOf(c.key);
    if (row) {
      const before = Object.fromEntries(
        Object.keys(fields).map((k) => [k, row[k as keyof CategoryRow] as string | number | null]),
      );
      store.update('categories', row.id, fields);
      ops.push({ kind: 'updated', table: 'categories', id: row.id, before });
      return;
    }
    const created = store.create<CategoryRow>('categories', {
      key: c.key,
      name: c.name,
      color: null,
      shape: c.shape,
      counted: c.counted ? 1 : 0,
      shown: c.shownByDefault ? 1 : 0,
      sort: null,
      mine: 0,
      ...fields,
    });
    ops.push({ kind: 'created', table: 'categories', id: created.id });
  };

  const checkFree = (name: string, except?: string) => {
    if (!name) throw new HttpError(400, 'Nom : obligatoire');
    const key = categoryKey(name);
    if (key !== except && list().some((c) => c.key === key))
      throw new HttpError(409, `La catégorie « ${name} » existe déjà.`);
  };
  const colorFrom = (value: unknown): string | null => {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !isColorValue(value))
      throw new HttpError(400, 'Couleur invalide (p:<teinte> ou #rrggbb)');
    return value.toLowerCase();
  };
  const shapeFrom = (value: unknown): CategoryShape => {
    if (value !== 'normal' && value !== 'deadline')
      throw new HttpError(400, 'Forme invalide (normal ou deadline)');
    return value;
  };

  // --- Routes ------------------------------------------------------------------

  ctx.routes.get('/categories', () => list());

  /** « Nouvelle catégorie » (from Réglages, the sheet, the bar or a slot). */
  ctx.routes.post('/categories', (request) => {
    const body = requestBody(request);
    const name = cleanName(body.name);
    checkFree(name);
    const max = rows().reduce((m, r) => Math.max(m, r.sort ?? -1), -1);
    const hasOrder = rows().some((r) => r.sort !== null);
    store.create<CategoryRow>('categories', {
      key: categoryKey(name),
      name,
      color: 'color' in body ? colorFrom(body.color) : null,
      shape: 'shape' in body ? shapeFrom(body.shape) : 'normal',
      counted: body.counted === false ? 0 : 1,
      shown: 1,
      sort: hasOrder ? max + 1 : null,
      mine: 1,
    });
    return find(name);
  });

  /**
   * Its colour (null = back to the original), counted or not, shown by
   * default or not, the shape (his own ones only). Any category.
   */
  ctx.routes.patch('/categories/:key', (request) => {
    const c = find(keyParam(request.params));
    const body = requestBody(request);
    const fields: Record<string, string | number | null> = {};
    if ('color' in body) fields.color = colorFrom(body.color);
    if ('counted' in body) fields.counted = body.counted === true ? 1 : 0;
    if ('shownByDefault' in body) fields.shown = body.shownByDefault === true ? 1 : 0;
    if ('shape' in body) {
      if (c.origin !== 'mine')
        throw new HttpError(403, 'La forme ne change que pour tes propres catégories.');
      fields.shape = shapeFrom(body.shape);
    }
    if (Object.keys(fields).length) ctx.db.transaction(() => upsert(c, fields, []));
    return find(c.key);
  });

  /** The order of the list (keys, first to last): every listed one gets its rank. */
  ctx.routes.put('/categories/order', (request) => {
    const keys = requestBody(request).keys;
    if (!Array.isArray(keys)) throw new HttpError(400, 'Ordre invalide');
    const all = list();
    const wanted = keys.map((k) => categoryKey(String(k)));
    const rest = all.map((c) => c.key).filter((k) => !wanted.includes(k));
    ctx.db.transaction(() => {
      [...wanted, ...rest].forEach((key, sort) => {
        const c = all.find((x) => x.key === key);
        if (!c) return;
        if (rowOf(key)?.sort === sort) return;
        upsert(c, { sort }, []);
      });
    });
    return list();
  });

  /** Replace a category's name in everything that names it (inside a transaction). */
  const moveAll = (from: string, to: string, ops: Op[]) => {
    const key = categoryKey(from);
    for (const t of ['events', 'weekly'] as const) {
      const name = ctx.db.table(t);
      const list = ctx.db
        .prepare(
          `SELECT id, category${t === 'events' ? ', origin' : ''} FROM ${name} WHERE deleted_at IS NULL AND lower(trim(category)) = ?`,
        )
        .all(key) as { id: string; category: string; origin?: string | null }[];
      for (const r of list) {
        const fields: Record<string, string | null> = { category: to };
        const before: Record<string, string | null> = { category: r.category };
        const origin = t === 'events' ? readOrigin(r.origin ?? null) : null;
        if (origin && categoryKey(origin.imported.category) === key) {
          fields.origin = JSON.stringify({
            ...origin,
            imported: { ...origin.imported, category: to },
          });
          before.origin = r.origin ?? null;
        }
        store.update(t, r.id, fields);
        ops.push({ kind: 'updated', table: t, id: r.id, before });
      }
    }
    // The imported events whose category Thomas changed keep the old name as « imported ».
    const imported = ctx.db
      .prepare(
        `SELECT id, origin FROM ${events} WHERE deleted_at IS NULL AND origin IS NOT NULL AND lower(trim(category)) <> ?`,
      )
      .all(key) as { id: string; origin: string }[];
    for (const r of imported) {
      const origin = readOrigin(r.origin);
      if (!origin || categoryKey(origin.imported.category) !== key) continue;
      store.update('events', r.id, {
        origin: JSON.stringify({ ...origin, imported: { ...origin.imported, category: to } }),
      });
      ops.push({ kind: 'updated', table: 'events', id: r.id, before: { origin: r.origin } });
    }
    for (const s of ctx.db
      .prepare(`SELECT id, mapping, default_category FROM ${sources} WHERE deleted_at IS NULL`)
      .all() as { id: string; mapping: string; default_category: string }[]) {
      const mapping = parseMapping(s.mapping);
      let changed = false;
      for (const [k, v] of Object.entries(mapping))
        if (categoryKey(v) === key) {
          mapping[k] = to;
          changed = true;
        }
      const fields: Record<string, string> = {};
      if (changed) fields.mapping = JSON.stringify(mapping);
      if (categoryKey(s.default_category) === key) fields.default_category = to;
      if (!Object.keys(fields).length) continue;
      store.update('sources', s.id, fields);
      ops.push({
        kind: 'updated',
        table: 'sources',
        id: s.id,
        before: {
          ...(fields.mapping ? { mapping: s.mapping } : {}),
          ...(fields.default_category ? { default_category: s.default_category } : {}),
        },
      });
    }
    const off = offByDefault();
    if (off.some((c) => categoryKey(c) === key)) {
      ops.push({
        kind: 'setting',
        key: 'categoriesOff',
        before: ctx.settings.get<string>('categoriesOff'),
      });
      ctx.settings.set(
        'categoriesOff',
        off.map((c) => (categoryKey(c) === key ? to : c)).join(', '),
      );
    }
  };

  /** Rename one of Thomas's categories: everything that names it follows. Backup, « Annuler ». */
  ctx.routes.post('/categories/:key/rename', (request) => {
    const c = find(keyParam(request.params));
    if (c.origin !== 'mine')
      throw new HttpError(403, 'Seules tes propres catégories se renomment.');
    const name = cleanName(requestBody(request).name);
    checkFree(name, c.key);
    if (name === c.name) return { category: c, undoId: null, backup: null };
    const backup = ctx.db.backup('avant renommage d’une catégorie de l’Agenda');
    const ops: Op[] = [];
    ctx.db.transaction(() => {
      moveAll(c.name, name, ops);
      upsert(c, { name, key: categoryKey(name) }, ops);
    });
    return { category: find(name), undoId: remember(ops), backup };
  });

  /**
   * Delete one of Thomas's categories. Its events and week-type entries move
   * to `moveTo` (required when there are any): never deleted. Backup, « Annuler ».
   */
  ctx.routes.delete('/categories/:key', (request) => {
    const c = find(keyParam(request.params));
    if (c.origin !== 'mine')
      throw new HttpError(403, 'Seules tes propres catégories se suppriment.');
    const moveTo = cleanName((request.query as { moveTo?: string } | undefined)?.moveTo);
    if (c.events > 0 || used().has(c.name)) {
      if (!moveTo) throw new HttpError(400, 'Choisis où déplacer ses événements (moveTo).');
      if (categoryKey(moveTo) === c.key) throw new HttpError(400, 'Choisis une autre catégorie.');
    }
    const backup = ctx.db.backup('avant suppression d’une catégorie de l’Agenda');
    const ops: Op[] = [];
    ctx.db.transaction(() => {
      if (moveTo) moveAll(c.name, moveTo, ops);
      const row = rowOf(c.key);
      if (row) {
        store.remove('categories', row.id);
        ops.push({ kind: 'removed', table: 'categories', id: row.id });
      }
    });
    return { ok: true, moved: c.events, undoId: remember(ops), backup };
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
        else if (op.kind === 'setting')
          ctx.settings.set(op.key, op.before ?? DEFAULT_OFF.join(', '));
      }
    });
    return list();
  });

  return { list, shapeOf };
}

const keyParam = (params: unknown) => String((params as { key?: string } | null)?.key ?? '');

function parseMapping(json: string): Record<string, string> {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}
