// v0.37.0: importing a table (CSV, or an Excel sheet turned into rows by
// xlsx.ts): which column is what (guessed from the header, changed by the
// user, kept for the source), the date and time formats people write
// (JJ/MM/AAAA, AAAA-MM-JJ, 8h30, 08:30, Excel's numbers), and one item per
// row. Without an identifier column, the key is « titre + début »: a moved
// course then shows as gone + added (documented in the README).
import { addMinutes, minutesBetween } from './time';
import { clip, type ImportError, type ImportItem, type ParsedFile } from './import-item';
import { ImportFileError } from './ics';

/** The Agenda's fields a column can give. */
export const TABLE_FIELDS = [
  'title',
  'date',
  'start',
  'end',
  'duration',
  'allDay',
  'location',
  'note',
  'category',
  'id',
] as const;
export type TableField = (typeof TABLE_FIELDS)[number];

/** The header of the template (and its labels in the column screen). */
export const TABLE_LABELS: Record<TableField, string> = {
  title: 'titre',
  date: 'date',
  start: 'début',
  end: 'fin',
  duration: 'durée',
  allDay: 'toute la journée',
  location: 'lieu',
  note: 'note',
  category: 'catégorie',
  id: 'identifiant',
};

/** Field → index of its column (absent: not in the file). */
export type ColumnMap = Partial<Record<TableField, number>>;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const NAMES: Record<TableField, string[]> = {
  title: ['titre', 'title', 'intitule', 'sujet', 'summary', 'objet', 'cours', 'nom'],
  date: ['date', 'jour', 'day', 'date de debut'],
  start: ['debut', 'heure', 'heure de debut', 'start', 'start time'],
  end: ['fin', 'heure de fin', 'end', 'end time'],
  duration: ['duree', 'duration', 'longueur'],
  allDay: ['toute la journee', 'journee', 'all day', 'journee entiere'],
  location: ['lieu', 'salle', 'local', 'location', 'endroit'],
  note: ['note', 'notes', 'description', 'remarque', 'commentaire'],
  category: ['categorie', 'category', 'type', 'categories'],
  id: ['identifiant', 'id', 'uid', 'cle', 'reference'],
};

/** The columns guessed from a header row. */
export function guessColumns(header: string[]): ColumnMap {
  const out: ColumnMap = {};
  const names = header.map(fold);
  for (const field of TABLE_FIELDS) {
    const i = names.findIndex(
      (n, index) => NAMES[field].includes(n) && !Object.values(out).includes(index),
    );
    if (i >= 0) out[field] = i;
  }
  return out;
}

/** Rows of a CSV text: separator « ; », « , » or tab (the most frequent in the first line), quotes. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? '';
  const count = (c: string) => firstLine.split(c).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const pad = (n: number) => String(n).padStart(2, '0');
const validDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** Excel counts days from 30 December 1899 (with its 1900 leap-year bug, harmless after March 1900). */
function excelDay(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
const excelMinutes = (fraction: number) => Math.round((fraction - Math.floor(fraction)) * 1440);

/** A date (and maybe a time) in a cell: « 15/01/2026 », « 2026-01-15 08:30 », Excel's 46037… */
export function parseDateCell(value: string): { day: string; minutes: number | null } | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d{4,6}([.,]\d+)?$/.test(v)) {
    const n = Number(v.replace(',', '.'));
    if (n < 20000 || n > 80000) return null;
    const minutes = excelMinutes(n);
    return { day: excelDay(n), minutes: minutes ? minutes : null };
  }
  let y: number, m: number, d: number;
  let rest: string;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](.*))?$/.exec(v);
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s+(.*))?$/.exec(v);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    rest = iso[4] ?? '';
  } else if (fr) {
    [d, m, y] = [Number(fr[1]), Number(fr[2]), Number(fr[3])];
    if (y < 100) y += 2000;
    rest = fr[4] ?? '';
  } else return null;
  if (!validDay(y, m, d)) return null;
  const minutes = rest ? parseTimeCell(rest) : null;
  if (rest && minutes === null) return null;
  return { day: `${y}-${pad(m)}-${pad(d)}`, minutes };
}

/** A time: « 8h30 », « 8h », « 08:30 », « 8:30:00 », Excel's fraction of a day (0.354…). Minutes. */
export function parseTimeCell(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (/^0?[.,]\d+$/.test(v)) return excelMinutes(Number(v.replace(',', '.')));
  const m = /^(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?::\d{2})?$/.exec(v) ?? /^(\d{1,2})\s*h$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** A length: « 90 », « 90 min », « 1h30 », « 1:30 », « 2 h ». Minutes. */
export function parseDurationCell(value: string): number | null {
  const v = value.trim().toLowerCase().replace(/\s+/g, '');
  if (!v) return null;
  let m = /^(\d+)(?:min|mn|m)?$/.exec(v);
  if (m) return Number(m[1]);
  m = /^(\d+)(?:h|:)(\d{1,2})?(?:min|mn|m)?$/.exec(v);
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  m = /^(\d+)[.,](\d+)h$/.exec(v);
  if (m) return Math.round(Number(`${m[1]}.${m[2]}`) * 60);
  return null;
}

const YES = ['oui', 'o', 'x', '1', 'vrai', 'true', 'yes', 'y'];

/**
 * One item per row (the header row skipped). A row without a title or a
 * readable date is an error (with its line); a row without a start time is
 * a whole day.
 */
export function tableItems(rows: string[][], columns: ColumnMap, header = true): ParsedFile {
  if (columns.title === undefined || columns.date === undefined)
    throw new ImportFileError('Il faut au moins une colonne « titre » et une colonne « date ».');
  const items: ImportItem[] = [];
  const errors: ImportError[] = [];
  const names = header ? (rows[0] ?? []) : [];
  const seen = new Set<string>();
  rows.slice(header ? 1 : 0).forEach((row, index) => {
    const line = index + (header ? 2 : 1);
    const cell = (f: TableField) =>
      columns[f] === undefined ? '' : (row[columns[f]!] ?? '').trim();
    try {
      const title = clip(cell('title'));
      if (!title) throw new Error('titre vide');
      const date = parseDateCell(cell('date'));
      if (!date) throw new Error(`date illisible : « ${cell('date')} »`);
      const allDayCell = cell('allDay').toLowerCase();
      const startMinutes = cell('start') ? parseTimeCell(cell('start')) : date.minutes;
      if (cell('start') && startMinutes === null)
        throw new Error(`heure de début illisible : « ${cell('start')} »`);
      const allDay = YES.includes(allDayCell) || startMinutes === null;
      let start: string;
      let end: string;
      if (allDay) {
        start = date.day;
        const endDate = cell('end') ? parseDateCell(cell('end')) : null;
        end = endDate && endDate.day >= start ? endDate.day : start;
      } else {
        start = `${date.day}T${pad(Math.floor(startMinutes! / 60))}:${pad(startMinutes! % 60)}`;
        const endText = cell('end');
        const duration = cell('duration') ? parseDurationCell(cell('duration')) : null;
        if (cell('duration') && duration === null)
          throw new Error(`durée illisible : « ${cell('duration')} »`);
        if (endText) {
          const asTime = parseTimeCell(endText);
          const asDate = asTime === null ? parseDateCell(endText) : null;
          if (asTime !== null) {
            end = `${date.day}T${pad(Math.floor(asTime / 60) % 24)}:${pad(asTime % 60)}`;
            if (asTime === 1440) end = addMinutes(`${date.day}T00:00`, 1440);
            // An end before the start: the next day (a night).
            if (minutesBetween(start, end) <= 0) end = addMinutes(end, 1440);
          } else if (asDate && asDate.minutes !== null)
            end = `${asDate.day}T${pad(Math.floor(asDate.minutes / 60))}:${pad(asDate.minutes % 60)}`;
          else throw new Error(`fin illisible : « ${endText} »`);
        } else end = addMinutes(start, duration ?? 60);
      }
      const id = cell('id');
      const key = id ? `id:${id}` : `${fold(title)}|${start}`;
      if (seen.has(key))
        throw new Error(
          id ? `identifiant en double : « ${id} »` : 'ligne en double (même titre et même début)',
        );
      seen.add(key);
      const original: Record<string, string> = {};
      row.forEach((value, i) => {
        if (value.trim()) original[names[i]?.trim() || `colonne ${i + 1}`] = value;
      });
      items.push({
        key,
        line,
        title,
        code: null,
        start,
        end,
        allDay,
        location: cell('location') ? clip(cell('location')) : null,
        note: cell('note') ? clip(cell('note')) : null,
        rawCategory: cell('category'),
        original,
      });
    } catch (err) {
      errors.push({ line, reason: (err as Error).message });
    }
  });
  return { calendarName: null, items, errors };
}

/** The template's rows (header + two examples), for the CSV and the Excel file. */
export const TEMPLATE_ROWS: string[][] = [
  TABLE_FIELDS.map((f) => TABLE_LABELS[f]),
  [
    'Thermodynamique',
    '15/01/2027',
    '8h30',
    '10h15',
    '',
    'non',
    '2F51',
    'Groupe 4MIN-7a',
    'Cours',
    'TH-001',
  ],
  [
    'Examen d’analyse',
    '2027-01-20',
    '09:00',
    '',
    '180',
    'non',
    'Auditoire',
    'Écrit',
    'Examens',
    '',
  ],
  ['Journée portes ouvertes', '06/02/2027', '', '', '', 'oui', '', '', 'Cours', ''],
];

/** The template as CSV (« ; », UTF-8 with its mark: Excel opens it in French without trouble). */
export function templateCsv(): string {
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `\uFEFF${TEMPLATE_ROWS.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}
