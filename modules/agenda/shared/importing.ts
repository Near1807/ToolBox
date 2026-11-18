// v0.37.0: the preview of an import, before anything is written (pure). The
// items read in the file are compared with the source's events by their
// origin key: to add, the same, changed (with the differences), gone from
// the file, ignored (out of the period) and errors. An event the user changed
// since the last import is flagged « modifié par toi » (unchecked by default);
// a gone event is never deleted unless its box is checked.
import { daysBetween } from './time';
import {
  describeEvent,
  type ImportError,
  type ImportItem,
  titleOf,
  type TitleStyle,
} from './import-item';
import { minutesBetween } from './time';

/** How a source turns its items into Agenda events. */
export interface SourceSettings {
  /** Value of the file (« H ») → Agenda category (« Cours »). */
  mapping: Record<string, string>;
  /** Category of the values not in the mapping (and of the items without one). */
  defaultCategory: string;
  titleStyle: TitleStyle;
}

/** The fields of an event an import writes (and compares). */
export interface ImportedValues {
  title: string;
  start_at: string;
  end_at: string;
  all_day: number;
  location: string | null;
  note: string | null;
  category: string;
}

export const VALUE_FIELDS = [
  'title',
  'start_at',
  'end_at',
  'all_day',
  'location',
  'note',
  'category',
] as const satisfies readonly (keyof ImportedValues)[];

export const FIELD_LABELS: Record<keyof ImportedValues, string> = {
  title: 'Titre',
  start_at: 'Début',
  end_at: 'Fin',
  all_day: 'Toute la journée',
  location: 'Lieu',
  note: 'Note',
  category: 'Catégorie',
};

/** What an imported event keeps of its origin (its `origin` column, JSON). */
export interface Origin {
  /** The event as it was in the file, field by field. */
  original: Record<string, string>;
  /** The file's category value (« H »). */
  raw: string;
  /** What the last import wrote (to see what the user changed since). */
  imported: ImportedValues;
}

export function readOrigin(json: string | null): Origin | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Origin;
    return v && typeof v === 'object' && v.imported ? v : null;
  } catch {
    return null;
  }
}

/** An event of the source already in the Agenda. */
export interface ExistingImported {
  id: string;
  key: string;
  deleted: boolean;
  /** As it is now (the user may have changed it). */
  current: ImportedValues;
  /** As the last import wrote it (null: unknown, taken as `current`). */
  imported: ImportedValues | null;
}

/** « future »: from today on (default); « all »: the past too. */
export type ImportPeriod = 'future' | 'all';

export const categoryOf = (raw: string, settings: SourceSettings) =>
  (raw && settings.mapping[raw]?.trim()) || settings.defaultCategory;

export function valuesOf(item: ImportItem, settings: SourceSettings): ImportedValues {
  return {
    title: titleOf(item, settings.titleStyle),
    start_at: item.start,
    end_at: item.end,
    all_day: item.allDay ? 1 : 0,
    location: item.location,
    note: item.note,
    category: categoryOf(item.rawCategory, settings),
  };
}

const sameValues = (a: ImportedValues, b: ImportedValues) =>
  VALUE_FIELDS.every((f) => a[f] === b[f]);

/** Why an item cannot become an Agenda event (same limits as an event typed by hand), or null. */
export function itemProblem(item: ImportItem): string | null {
  if (!item.title.trim()) return 'titre vide';
  if (item.allDay) {
    if (item.end < item.start) return 'la fin est avant le début';
    if (daysBetween(item.start, item.end) > 366) return 'plus d’un an';
  } else {
    const minutes = minutesBetween(item.start, item.end);
    if (!(minutes > 0)) return 'la fin est avant le début';
    if (minutes > 14 * 24 * 60) return 'plus de deux semaines';
  }
  return null;
}

/** An event as the preview shows it. */
export interface PreviewLine {
  key: string;
  line: number;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  category: string;
}

export interface PreviewChange {
  field: keyof ImportedValues;
  label: string;
  before: string | null;
  after: string | null;
}

export interface ImportPreview {
  /** To add (checked), except those deleted here before (unchecked, `deletedBefore`). */
  add: (PreviewLine & { deletedBefore: boolean })[];
  /** Nothing to write. */
  same: number;
  /** Changed in the file: checked, except those the user changed (`mine`, unchecked). */
  modified: (PreviewLine & { id: string; changes: PreviewChange[]; mine: boolean })[];
  /** In the source, no longer in the file: unchecked (checked → tombstone, restorable). */
  gone: (PreviewLine & { id: string; mine: boolean })[];
  /** Out of the period (past). */
  ignored: PreviewLine[];
  errors: ImportError[];
  /** Number of events by value of the file, in the period (for the mapping). */
  categories: { value: string; count: number; category: string }[];
}

const shown = (v: string | number | null, field: keyof ImportedValues) =>
  field === 'all_day' ? (v ? 'oui' : 'non') : v === null || v === '' ? null : String(v);

const lineOf = (key: string, line: number, v: ImportedValues): PreviewLine => ({
  key,
  line,
  title: v.title,
  start: v.start_at,
  end: v.end_at,
  allDay: v.all_day === 1,
  location: v.location,
  category: v.category,
});

/** Last day of an event (all day: its end; at a time: the day of its end). */
const lastDay = (v: { end_at: string }) => v.end_at.slice(0, 10);

export function comparePreview(
  items: ImportItem[],
  errors: ImportError[],
  existing: ExistingImported[],
  settings: SourceSettings,
  period: ImportPeriod,
  today: string,
): ImportPreview {
  const byKey = new Map<string, ExistingImported>();
  // A live event wins over a tombstone of the same key.
  for (const e of existing) {
    const before = byKey.get(e.key);
    if (!before || (before.deleted && !e.deleted)) byKey.set(e.key, e);
  }
  const out: ImportPreview = {
    add: [],
    same: 0,
    modified: [],
    gone: [],
    ignored: [],
    errors: [...errors],
    categories: [],
  };
  const counts = new Map<string, number>();
  const inFile = new Set<string>();
  for (const item of items) {
    inFile.add(item.key);
    const values = valuesOf(item, settings);
    const problem = itemProblem(item);
    if (problem) {
      out.errors.push({ line: item.line, reason: `${problem} (« ${values.title} »)` });
      continue;
    }
    if (period === 'future' && lastDay(values) < today) {
      out.ignored.push(lineOf(item.key, item.line, values));
      continue;
    }
    counts.set(item.rawCategory, (counts.get(item.rawCategory) ?? 0) + 1);
    const here = byKey.get(item.key);
    if (!here || here.deleted) {
      out.add.push({ ...lineOf(item.key, item.line, values), deletedBefore: Boolean(here) });
      continue;
    }
    const imported = here.imported ?? here.current;
    if (sameValues(values, imported) || sameValues(values, here.current)) {
      out.same++;
      continue;
    }
    const changes: PreviewChange[] = VALUE_FIELDS.filter((f) => here.current[f] !== values[f]).map(
      (f) => ({
        field: f,
        label: FIELD_LABELS[f],
        before: shown(here.current[f], f),
        after: shown(values[f], f),
      }),
    );
    out.modified.push({
      ...lineOf(item.key, item.line, values),
      id: here.id,
      changes,
      mine: !sameValues(here.current, imported),
    });
  }
  for (const e of byKey.values()) {
    if (e.deleted || inFile.has(e.key)) continue;
    if (period === 'future' && lastDay(e.current) < today) continue;
    out.gone.push({
      ...lineOf(e.key, 0, e.current),
      id: e.id,
      mine: e.imported !== null && !sameValues(e.current, e.imported),
    });
  }
  const byStart = (a: PreviewLine, b: PreviewLine) =>
    a.start.localeCompare(b.start) || a.title.localeCompare(b.title);
  out.add.sort(byStart);
  out.modified.sort(byStart);
  out.gone.sort(byStart);
  out.ignored.sort(byStart);
  out.errors.sort((a, b) => a.line - b.line);
  out.categories = [...counts]
    .map(([value, count]) => ({ value, count, category: categoryOf(value, settings) }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return out;
}

// --- v0.41.0: the titles of a source computed again, without the file ----------------

/**
 * The title an event of an ICS import would get now (describeEvent, v0.38.0),
 * from its original text; null for a table import (its title is a column,
 * nothing to compute).
 */
export function titleFromOriginal(
  original: Record<string, string>,
  style: TitleStyle,
): string | null {
  if (!('SUMMARY' in original)) return null;
  const summary = original.SUMMARY!.trim() || '(sans titre)';
  return titleOf(describeEvent(summary, original.DESCRIPTION ?? ''), style);
}

/** A live imported event of a source, as stored. */
export interface StoredImported {
  id: string;
  key: string;
  current: ImportedValues;
  origin: Origin;
}

/**
 * « Recalculer les titres » (v0.41.0): the same preview as an import, with
 * the title only. An event whose title the user changed since the import is
 * « modifié par toi » (unchecked by default); nothing else is compared, and
 * nothing else would be written.
 */
export function compareTitles(rows: StoredImported[], style: TitleStyle): ImportPreview {
  const out: ImportPreview = {
    add: [],
    same: 0,
    modified: [],
    gone: [],
    ignored: [],
    errors: [],
    categories: [],
  };
  for (const r of rows) {
    const title = titleFromOriginal(r.origin.original, style);
    if (title === null || title === r.current.title) {
      out.same++;
      continue;
    }
    out.modified.push({
      ...lineOf(r.key, 0, { ...r.current, title }),
      id: r.id,
      changes: [
        { field: 'title', label: FIELD_LABELS.title, before: r.current.title, after: title },
      ],
      mine: r.current.title !== r.origin.imported.title,
    });
  }
  out.modified.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return out;
}
