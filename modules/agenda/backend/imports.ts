// v0.37.0 (Expérimental): importing a calendar into a source of the Agenda
// (ICS, CSV, Excel), read locally, nothing online. Three steps: analyse
// (what the file holds, which source it matches), preview (nothing written:
// to add / same / changed / gone / ignored / errors), apply (backup, one
// transaction, « Annuler l'import » for a while). The imported events are
// ordinary events of the Agenda (same views, load, switches, sync) with their
// source and their origin key; a re-import updates them, never duplicates.
// The sources: listed, renamed, their mapping changed (applied to their
// events), deleted (tombstones, restorable).
import {
  HttpError,
  type ModuleContext,
  newId,
  requestBody,
  SyncStore,
  uuidParam,
} from '@hub/sdk/core';
import { localToday } from '@hub/sdk/dates';
import { ImportFileError, parseIcs } from '../shared/ics';
import { clip, type ParsedFile } from '../shared/import-item';
import {
  categoryOf,
  comparePreview,
  compareTitles,
  type ExistingImported,
  type ImportedValues,
  type ImportPeriod,
  type Origin,
  readOrigin,
  type SourceSettings,
  type StoredImported,
  VALUE_FIELDS,
  valuesOf,
} from '../shared/importing';
import {
  type ColumnMap,
  guessColumns,
  parseCsv,
  TABLE_FIELDS,
  TABLE_LABELS,
  tableItems,
  templateCsv,
  TEMPLATE_ROWS,
} from '../shared/table';
import { writeXlsx } from '../shared/xlsx';
import { addDays } from '../shared/time';
import type { AgendaSourceDto } from '../shared/types';

export interface SourceRow {
  id: string;
  name: string;
  format: string;
  calendar_name: string | null;
  mapping: string;
  default_category: string;
  title_style: string;
  columns: string | null;
  last_import_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const parseJson = <T>(json: string | null, fallback: T): T => {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

const FORMATS = ['ics', 'csv', 'xlsx'] as const;
type Format = (typeof FORMATS)[number];

/** A file of a few thousand events; the routes refuse more. */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 20_000;
/** How long « Annuler l'import » stays possible. */
const UNDO_MS = 10 * 60_000;

type Op =
  | { kind: 'created' | 'removed' | 'restored'; table: string; id: string }
  | { kind: 'updated'; table: string; id: string; before: Record<string, string | number | null> };

export function registerImports(ctx: ModuleContext, store: SyncStore) {
  const events = ctx.db.table('events');
  const sources = ctx.db.table('sources');
  const undo = new Map<string, { ops: Op[]; at: number }>();

  const sourceRows = () =>
    ctx.db
      .prepare(`SELECT * FROM ${sources} WHERE deleted_at IS NULL ORDER BY name`)
      .all() as SourceRow[];
  const getSource = (id: string) => {
    const row = store.get<SourceRow>('sources', id);
    if (!row) throw new HttpError(404, 'Source introuvable');
    return row;
  };

  const sourceDto = (row: SourceRow): AgendaSourceDto => {
    const counts = ctx.db
      .prepare(
        `SELECT category, COUNT(*) AS n FROM ${events} WHERE deleted_at IS NULL AND source_id = ? GROUP BY category ORDER BY category`,
      )
      .all(row.id) as { category: string; n: number }[];
    return {
      id: row.id,
      name: row.name,
      format: row.format,
      calendarName: row.calendar_name,
      mapping: parseJson<Record<string, string>>(row.mapping, {}),
      defaultCategory: row.default_category,
      titleStyle: row.title_style === 'code' ? 'code' : 'short',
      columns: parseJson<ColumnMap | null>(row.columns, null),
      lastImportAt: row.last_import_at,
      events: counts.reduce((n, c) => n + c.n, 0),
      categories: counts.map((c) => c.category),
    };
  };

  // --- The file -------------------------------------------------------------

  const formatOf = (v: unknown): Format => {
    if (!FORMATS.includes(v as Format))
      throw new HttpError(400, 'Format inconnu (ics, csv ou xlsx)');
    return v as Format;
  };

  const columnsFrom = (v: unknown): ColumnMap | null => {
    if (!v || typeof v !== 'object') return null;
    const out: ColumnMap = {};
    for (const f of TABLE_FIELDS) {
      const i = (v as Record<string, unknown>)[f];
      if (Number.isInteger(i) && (i as number) >= 0 && (i as number) < 100) out[f] = i as number;
    }
    return out;
  };

  /** The file of the request, read (nothing written). */
  const readFile = (
    body: Record<string, unknown>,
    savedColumns: ColumnMap | null = null,
  ): ParsedFile & { format: Format; headers: string[] | null; columns: ColumnMap | null } => {
    const format = formatOf(body.format);
    try {
      if (format === 'ics') {
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text.trim()) throw new HttpError(400, 'Fichier vide');
        const parsed = parseIcs(text, { horizon: addDays(localToday(), 366) });
        if (parsed.items.length > MAX_ITEMS)
          throw new HttpError(400, 'Trop d’événements dans ce fichier');
        return { ...parsed, format, headers: null, columns: null };
      }
      let rows: string[][];
      if (format === 'csv') {
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text.trim()) throw new HttpError(400, 'Fichier vide');
        rows = parseCsv(text);
      } else {
        if (
          !Array.isArray(body.rows) ||
          !body.rows.every((r) => Array.isArray(r) && r.every((c) => typeof c === 'string'))
        )
          throw new HttpError(400, 'Feuille illisible');
        rows = body.rows as string[][];
      }
      if (rows.length < 2)
        throw new HttpError(
          400,
          'Aucune ligne à importer (il faut une ligne d’en-tête, puis les événements).',
        );
      if (rows.length > MAX_ITEMS) throw new HttpError(400, 'Trop de lignes dans ce fichier');
      const headers = rows[0]!.map((h) => h.trim());
      const columns = columnsFrom(body.columns) ?? savedColumns ?? guessColumns(headers);
      if (columns.title === undefined || columns.date === undefined)
        return { calendarName: null, items: [], errors: [], format, headers, columns };
      return { ...tableItems(rows, columns), format, headers, columns };
    } catch (err) {
      if (err instanceof ImportFileError) throw new HttpError(400, err.message);
      throw err;
    }
  };

  /** UIDs (before « # ») of a key, to recognise a source by its events. */
  const uidOf = (key: string) => key.split('#')[0]!;

  const existingOf = (sourceId: string): ExistingImported[] =>
    (
      ctx.db
        .prepare(`SELECT * FROM ${events} WHERE source_id = ? AND origin_key IS NOT NULL`)
        .all(sourceId) as (ImportedValues & {
        id: string;
        origin_key: string;
        origin: string | null;
        deleted_at: string | null;
      })[]
    ).map((r) => ({
      id: r.id,
      key: r.origin_key,
      deleted: r.deleted_at !== null,
      current: Object.fromEntries(VALUE_FIELDS.map((f) => [f, r[f]])) as unknown as ImportedValues,
      imported: readOrigin(r.origin)?.imported ?? null,
    }));

  // --- The choices of the import ----------------------------------------------

  const textOf = (v: unknown, max = 60) => (typeof v === 'string' ? clip(v, max) : '');

  const settingsOf = (body: Record<string, unknown>, source: SourceRow | null): SourceSettings => {
    const mapping: Record<string, string> = {};
    const given =
      body.mapping && typeof body.mapping === 'object'
        ? (body.mapping as Record<string, unknown>)
        : parseJson<Record<string, unknown>>(source?.mapping ?? null, {});
    for (const [k, v] of Object.entries(given).slice(0, 200)) {
      const c = textOf(v);
      if (c) mapping[clip(k, 60)] = c;
    }
    const defaultCategory =
      textOf(body.defaultCategory) || source?.default_category || textOf(body.name) || 'Importé';
    const style = body.titleStyle ?? source?.title_style;
    return { mapping, defaultCategory, titleStyle: style === 'code' ? 'code' : 'short' };
  };

  const periodOf = (v: unknown): ImportPeriod => (v === 'all' ? 'all' : 'future');

  const targetOf = (body: Record<string, unknown>): SourceRow | null =>
    body.sourceId ? getSource(uuidParam({ id: body.sourceId })) : null;

  const preview = (body: Record<string, unknown>) => {
    const source = targetOf(body);
    if (!source && !textOf(body.name)) throw new HttpError(400, 'Nom de la source : obligatoire');
    const file = readFile(body, source ? parseJson<ColumnMap | null>(source.columns, null) : null);
    if (file.columns && (file.columns.title === undefined || file.columns.date === undefined))
      throw new HttpError(400, 'Choisis au moins la colonne du titre et celle de la date.');
    const settings = settingsOf(body, source);
    const period = periodOf(body.period);
    const result = comparePreview(
      file.items,
      file.errors,
      source ? existingOf(source.id) : [],
      settings,
      period,
      localToday(),
    );
    return { source, file, settings, period, result };
  };

  const previewDto = (p: ReturnType<typeof preview>) => ({
    sourceId: p.source?.id ?? null,
    settings: p.settings,
    period: p.period,
    ...p.result,
  });

  // --- Routes --------------------------------------------------------------------

  ctx.routes.get('/sources', () => sourceRows().map(sourceDto));

  /** Step 1: what the file holds, and the sources it may be (same name, same UIDs). */
  ctx.routes.post(
    '/import/analyze',
    (request) => {
      const body = requestBody(request);
      const file = readFile(body);
      const counts = new Map<string, number>();
      for (const i of file.items) counts.set(i.rawCategory, (counts.get(i.rawCategory) ?? 0) + 1);
      const uids = new Set(file.items.map((i) => uidOf(i.key)));
      const fold = (s: string | null) => (s ?? '').trim().toLowerCase();
      const matches = sourceRows()
        .map((s) => {
          const keys = ctx.db
            .prepare(
              `SELECT DISTINCT origin_key FROM ${events} WHERE source_id = ? AND origin_key IS NOT NULL`,
            )
            .all(s.id) as { origin_key: string }[];
          const shared = new Set(keys.map((k) => uidOf(k.origin_key)).filter((u) => uids.has(u)))
            .size;
          const byName =
            Boolean(file.calendarName) &&
            (fold(s.calendar_name) === fold(file.calendarName) ||
              fold(s.name) === fold(file.calendarName));
          return { id: s.id, name: s.name, byName, shared };
        })
        .filter((m) => m.byName || m.shared > 0)
        .sort((a, b) => b.shared - a.shared || Number(b.byName) - Number(a.byName));
      const today = localToday();
      return {
        format: file.format,
        calendarName: file.calendarName,
        total: file.items.length,
        future: file.items.filter((i) => i.end.slice(0, 10) >= today).length,
        errors: file.errors.length,
        categories: [...counts]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
        headers: file.headers,
        columns: file.columns,
        fields: TABLE_FIELDS.map((f) => ({ field: f, label: TABLE_LABELS[f] })),
        matches,
        codes: file.items.some((i) => i.code !== null),
      };
    },
    { bodyLimit: MAX_IMPORT_BYTES },
  );

  /** Step 2: the preview. Nothing is written. */
  ctx.routes.post('/import/preview', (request) => previewDto(preview(requestBody(request))), {
    bodyLimit: MAX_IMPORT_BYTES,
  });

  /**
   * The import itself, after the preview: `accept` = keys to add or update
   * (checked), `remove` = keys of gone events to delete (checked: tombstones,
   * restorable). Anything else is left as it is. Backup first, one transaction.
   */
  ctx.routes.post(
    '/import/apply',
    (request) => {
      const body = requestBody(request);
      const p = preview(body);
      const list = (v: unknown) => new Set(Array.isArray(v) ? v.map(String) : []);
      const accept = list(body.accept);
      const remove = list(body.remove);
      const add = p.result.add.filter((l) => accept.has(l.key));
      const modified = p.result.modified.filter((l) => accept.has(l.key));
      const gone = p.result.gone.filter((l) => remove.has(l.key));
      const summary = {
        same: p.result.same,
        left: {
          add: p.result.add.length - add.length,
          modified: p.result.modified.length - modified.length,
          gone: p.result.gone.length - gone.length,
        },
        errors: p.result.errors.length,
        ignored: p.result.ignored.length,
      };
      // Nothing checked (a re-import of the same file): nothing is written, not even the source.
      if (!add.length && !modified.length && !gone.length)
        return {
          importId: null,
          backup: null,
          source: p.source ? sourceDto(p.source) : null,
          added: 0,
          updated: 0,
          removed: 0,
          ...summary,
        };
      const items = new Map(p.file.items.map((i) => [i.key, i]));
      const backup = ctx.db.backup('avant import Agenda');
      const ops: Op[] = [];
      const now = new Date().toISOString();
      let sourceId = p.source?.id ?? '';
      const sourceFields = {
        format: p.file.format,
        calendar_name: p.file.calendarName ?? p.source?.calendar_name ?? null,
        mapping: JSON.stringify(p.settings.mapping),
        default_category: p.settings.defaultCategory,
        title_style: p.settings.titleStyle,
        columns: p.file.columns ? JSON.stringify(p.file.columns) : null,
        last_import_at: now,
      };
      const fieldsOf = (key: string): Record<string, string | number | null> => {
        const item = items.get(key)!;
        const values = valuesOf(item, p.settings);
        const origin: Origin = { original: item.original, raw: item.rawCategory, imported: values };
        return { ...values, source_id: sourceId, origin_key: key, origin: JSON.stringify(origin) };
      };
      const before = (row: Record<string, unknown>, fields: Record<string, unknown>) =>
        Object.fromEntries(Object.keys(fields).map((k) => [k, row[k] as string | number | null]));
      ctx.db.transaction(() => {
        if (p.source) {
          ops.push({
            kind: 'updated',
            table: 'sources',
            id: sourceId,
            before: before(p.source as never, sourceFields),
          });
          store.update('sources', sourceId, sourceFields);
        } else {
          sourceId = store.create<SourceRow>('sources', {
            name: textOf(body.name),
            ...sourceFields,
          }).id;
          ops.push({ kind: 'created', table: 'sources', id: sourceId });
        }
        for (const line of add) {
          const fields = fieldsOf(line.key);
          const old = line.deletedBefore
            ? (ctx.db
                .prepare(
                  `SELECT * FROM ${events} WHERE source_id = ? AND origin_key = ? AND deleted_at IS NOT NULL ORDER BY updated_at DESC`,
                )
                .get(sourceId, line.key) as Record<string, unknown> | undefined)
            : undefined;
          if (old) {
            ops.push({
              kind: 'updated',
              table: 'events',
              id: String(old.id),
              before: before(old, fields),
            });
            store.update('events', String(old.id), fields);
            store.restore('events', String(old.id));
            ops.push({ kind: 'restored', table: 'events', id: String(old.id) });
          } else {
            const row = store.create(
              'events',
              fields as unknown as Record<string, string | number | null>,
            );
            ops.push({ kind: 'created', table: 'events', id: row.id });
          }
        }
        for (const line of modified) {
          const row = store.get('events', line.id) as unknown as Record<string, unknown>;
          const fields = fieldsOf(line.key);
          const changed = Object.fromEntries(
            Object.entries(fields).filter(([k, v]) => row[k] !== v),
          ) as Record<string, string | number | null>;
          ops.push({ kind: 'updated', table: 'events', id: line.id, before: before(row, changed) });
          store.update('events', line.id, changed);
        }
        for (const line of gone) {
          store.remove('events', line.id);
          ops.push({ kind: 'removed', table: 'events', id: line.id });
        }
      });
      const importId = newId();
      const at = Date.now();
      for (const [id, u] of undo) if (at - u.at > UNDO_MS) undo.delete(id);
      undo.set(importId, { ops, at });
      return {
        importId,
        backup,
        source: sourceDto(getSource(sourceId)),
        added: add.length,
        updated: modified.length,
        removed: gone.length,
        ...summary,
      };
    },
    { bodyLimit: MAX_IMPORT_BYTES },
  );

  // --- v0.41.0: « Recalculer les titres » (no file: the original text kept) -----------

  const storedOf = (sourceId: string): StoredImported[] =>
    (
      ctx.db
        .prepare(
          `SELECT * FROM ${events} WHERE source_id = ? AND origin_key IS NOT NULL AND deleted_at IS NULL`,
        )
        .all(sourceId) as (ImportedValues & {
        id: string;
        origin_key: string;
        origin: string | null;
      })[]
    ).flatMap((r) => {
      const origin = readOrigin(r.origin);
      if (!origin) return [];
      return [
        {
          id: r.id,
          key: r.origin_key,
          current: Object.fromEntries(
            VALUE_FIELDS.map((f) => [f, r[f]]),
          ) as unknown as ImportedValues,
          origin,
        },
      ];
    });

  const titlesPreview = (source: SourceRow) => {
    const settings = settingsOf({}, source);
    const rows = storedOf(source.id);
    return { settings, rows, result: compareTitles(rows, settings.titleStyle) };
  };

  /** The preview: the same shape as an import's (only « Modifiés »). Nothing is written. */
  ctx.routes.get('/sources/:id/titles', (request) => {
    const source = getSource(uuidParam(request.params));
    const p = titlesPreview(source);
    return { sourceId: source.id, settings: p.settings, period: 'all', ...p.result };
  });

  /**
   * The checked titles written (`accept`: keys), nothing else: backup first,
   * one transaction, « Annuler » like an import. What the import wrote
   * (origin.imported.title) follows, so the next import sees no change of the user.
   */
  ctx.routes.post('/sources/:id/titles/apply', (request) => {
    const source = getSource(uuidParam(request.params));
    const body = requestBody(request);
    const accept = new Set(Array.isArray(body.accept) ? body.accept.map(String) : []);
    const p = titlesPreview(source);
    const lines = p.result.modified.filter((l) => accept.has(l.key));
    const summary = {
      same: p.result.same,
      left: { add: 0, modified: p.result.modified.length - lines.length, gone: 0 },
      errors: 0,
      ignored: 0,
      added: 0,
      removed: 0,
    };
    if (!lines.length)
      return { importId: null, backup: null, source: sourceDto(source), updated: 0, ...summary };
    const rows = new Map(p.rows.map((r) => [r.id, r]));
    const backup = ctx.db.backup('avant recalcul des titres Agenda');
    const ops: Op[] = [];
    ctx.db.transaction(() => {
      for (const line of lines) {
        const r = rows.get(line.id)!;
        const origin: Origin = {
          ...r.origin,
          imported: { ...r.origin.imported, title: line.title },
        };
        const fields = { title: line.title, origin: JSON.stringify(origin) };
        const row = store.get('events', line.id) as unknown as Record<string, unknown>;
        ops.push({
          kind: 'updated',
          table: 'events',
          id: line.id,
          before: { title: row.title as string, origin: row.origin as string | null },
        });
        store.update('events', line.id, fields);
      }
    });
    const importId = newId();
    const at = Date.now();
    for (const [id, u] of undo) if (at - u.at > UNDO_MS) undo.delete(id);
    undo.set(importId, { ops, at });
    return {
      importId,
      backup,
      source: sourceDto(getSource(source.id)),
      updated: lines.length,
      ...summary,
    };
  });

  /**
   * The sources whose titles would change (not counting the events whose
   * title the user changed): the Agenda offers « Voir », never applies.
   */
  ctx.routes.get('/title-updates', () =>
    sourceRows().flatMap((s) => {
      const count = titlesPreview(s).result.modified.filter((l) => !l.mine).length;
      return count ? [{ id: s.id, name: s.name, count }] : [];
    }),
  );

  /** « Annuler l'import »: everything it did, undone (in the reverse order). */
  ctx.routes.post('/import/undo', (request) => {
    const id = String(requestBody(request).importId ?? '');
    const entry = undo.get(id);
    if (!entry || Date.now() - entry.at > UNDO_MS)
      throw new HttpError(404, 'Cet import ne peut plus être annulé.');
    undo.delete(id);
    ctx.db.transaction(() => {
      for (const op of [...entry.ops].reverse()) {
        if (op.kind === 'created' || op.kind === 'restored') store.remove(op.table, op.id);
        else if (op.kind === 'removed') store.restore(op.table, op.id);
        else if (op.kind === 'updated' && Object.keys(op.before).length)
          store.update(op.table, op.id, op.before);
      }
    });
    return { ok: true };
  });

  /** The template to fill in (CSV or Excel), « Enregistrer sous ». */
  ctx.routes.post('/import/template', async (request) => {
    const format = requestBody(request).format === 'xlsx' ? 'xlsx' : 'csv';
    const saved = await ctx.files.saveAs({
      title: 'Enregistrer le modèle d’import',
      defaultName: `Modèle Agenda.${format}`,
      filters: [
        format === 'xlsx'
          ? { name: 'Excel', extensions: ['xlsx'] }
          : { name: 'CSV', extensions: ['csv'] },
      ],
      data: format === 'xlsx' ? writeXlsx(TEMPLATE_ROWS) : templateCsv(),
    });
    return saved ? { path: saved } : { cancelled: true };
  });

  // --- Sources ---------------------------------------------------------------------

  /**
   * Rename a source, or change its mapping: the events whose category the
   * user did not change follow (their category, and what « imported » means
   * for the next import).
   */
  ctx.routes.patch('/sources/:id', (request) => {
    const id = uuidParam(request.params);
    const row = getSource(id);
    const body = requestBody(request);
    const fields: Record<string, string> = {};
    if ('name' in body) {
      const name = textOf(body.name);
      if (!name) throw new HttpError(400, 'Nom : obligatoire');
      fields.name = name;
    }
    if ('mapping' in body || 'defaultCategory' in body) {
      const settings = settingsOf(
        { mapping: body.mapping, defaultCategory: body.defaultCategory },
        row,
      );
      fields.mapping = JSON.stringify(settings.mapping);
      fields.default_category = settings.defaultCategory;
      ctx.db.transaction(() => {
        const rows = ctx.db
          .prepare(`SELECT * FROM ${events} WHERE source_id = ? AND deleted_at IS NULL`)
          .all(id) as { id: string; category: string; origin: string | null }[];
        for (const r of rows) {
          const origin = readOrigin(r.origin);
          if (!origin) continue;
          const category = categoryOf(origin.raw, settings);
          if (category === origin.imported.category) continue;
          const mine = r.category !== origin.imported.category;
          const next: Origin = { ...origin, imported: { ...origin.imported, category } };
          store.update('events', r.id, {
            ...(mine ? {} : { category }),
            origin: JSON.stringify(next),
          });
        }
        store.update('sources', id, fields);
      });
      return sourceDto(getSource(id));
    }
    return sourceDto(
      Object.keys(fields).length ? store.update<SourceRow>('sources', id, fields) : row,
    );
  });

  /** Delete a source (after the page's confirmation): it and its events become tombstones. */
  ctx.routes.delete('/sources/:id', (request) => {
    const id = getSource(uuidParam(request.params)).id;
    const backup = ctx.db.backup('avant suppression d’une source de l’Agenda');
    let count = 0;
    ctx.db.transaction(() => {
      const rows = ctx.db
        .prepare(`SELECT id FROM ${events} WHERE source_id = ? AND deleted_at IS NULL`)
        .all(id) as { id: string }[];
      // The source first: its events' tombstones come after it (see the restore).
      store.remove('sources', id);
      for (const r of rows) store.remove('events', r.id);
      count = rows.length;
    });
    return { ok: true, events: count, backup };
  });

  /** Bring a deleted source back, with the events deleted with it (not those deleted before). */
  ctx.routes.post('/sources/:id/restore', (request) => {
    const id = uuidParam(request.params);
    const row = store.get<SourceRow>('sources', id, true);
    if (!row || row.deleted_at === null) throw new HttpError(404, 'Plus rien à restaurer');
    ctx.db.transaction(() => {
      // The source's tombstone is written first, its events' just after (DELETE above).
      const rows = ctx.db
        .prepare(`SELECT id FROM ${events} WHERE source_id = ? AND deleted_at >= ?`)
        .all(id, row.deleted_at) as { id: string }[];
      store.restore('sources', id);
      for (const r of rows) store.restore('events', r.id);
    });
    return sourceDto(getSource(id));
  });
}
