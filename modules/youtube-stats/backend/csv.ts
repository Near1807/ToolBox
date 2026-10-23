// Import of a YouTube Studio export (Analytics › Advanced mode › Export:
// a .zip with « Table data.csv », « Chart data.csv », « Totals.csv », or one of
// those CSV files). Columns are detected by name, in English or French; what
// the API does not give (impressions, click-through rate) is merged into the
// local data, matched by video id (« Content » column).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';

export type CsvField =
  | 'video'
  | 'title'
  | 'date'
  | 'views'
  | 'impressions'
  | 'ctr'
  | 'watchHours'
  | 'subscribers'
  | 'avgViewDuration'
  | 'publishTime';

/** Normalised header → field (lower case, no accents, no punctuation). */
const SYNONYMS: Record<string, CsvField> = {
  content: 'video',
  contenu: 'video',
  video: 'video',
  'video id': 'video',
  'id de la video': 'video',
  'video title': 'title',
  'titre de la video': 'title',
  title: 'title',
  titre: 'title',
  date: 'date',
  day: 'date',
  jour: 'date',
  views: 'views',
  vues: 'views',
  impressions: 'impressions',
  'impressions click through rate': 'ctr',
  'impressions click through rate %': 'ctr',
  'taux de clics des impressions': 'ctr',
  'taux de clics des impressions %': 'ctr',
  'watch time hours': 'watchHours',
  'duree de visionnage heures': 'watchHours',
  subscribers: 'subscribers',
  abonnes: 'subscribers',
  'average view duration': 'avgViewDuration',
  'duree moyenne de visionnage': 'avgViewDuration',
  'video publish time': 'publishTime',
  'heure de publication de la video': 'publishTime',
};

export function normaliseHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+%/, ' %')
    .trim();
}

/** RFC 4180 CSV (quotes, doubled quotes, commas or semicolons). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === separator) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

/** "1 234,5" / "1,234.5" / "4.2%" → number; "" → null. */
export function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  let v = value.trim().replace(/[%\s\u00a0\u202f]/g, '');
  if (v === '' || v === '—' || v === '-') return null;
  if (v.includes(',') && v.includes('.')) v = v.replace(/,/g, '');
  else if (v.includes(',')) v = v.replace(',', '.');
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "Oct 21, 2026" / "2026-10-21" / "21/10/2026" → "2026-10-21". */
export function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (fr) return `${fr[3]}-${fr[2]!.padStart(2, '0')}-${fr[1]!.padStart(2, '0')}`;
  const parsed = Date.parse(`${v} UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

export interface CsvTable {
  fileName: string;
  /** Detected fields, by column index. */
  columns: { header: string; field: CsvField | null }[];
  rows: Partial<Record<CsvField, string>>[];
  /** daily: has a Date column (Chart data) · totals: one line per video (Table data). */
  kind: 'daily' | 'totals' | 'unknown';
}

export function readTable(fileName: string, text: string): CsvTable {
  const [header = [], ...lines] = parseCsv(text);
  const columns = header.map((h) => ({ header: h, field: SYNONYMS[normaliseHeader(h)] ?? null }));
  const rows = lines.map((line) => {
    const row: Partial<Record<CsvField, string>> = {};
    columns.forEach((c, i) => {
      if (c.field && line[i] !== undefined && row[c.field] === undefined) row[c.field] = line[i];
    });
    return row;
  });
  const fields = new Set(columns.map((c) => c.field));
  const kind = !fields.has('video') ? 'unknown' : fields.has('date') ? 'daily' : 'totals';
  return {
    fileName,
    columns,
    rows: rows.filter((r) => r.video && r.video.toLowerCase() !== 'total'),
    kind,
  };
}

async function unzip(file: string): Promise<{ name: string; text: string }[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Archive illisible'));
      const files: { name: string; text: string }[] = [];
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.toLowerCase().endsWith('.csv')) return zip.readEntry();
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err ?? new Error('Fichier illisible dans l’archive'));
          const parts: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => parts.push(chunk));
          stream.on('end', () => {
            files.push({
              name: path.basename(entry.fileName),
              text: Buffer.concat(parts).toString('utf8'),
            });
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(files));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

/** The CSV tables of a Studio export (.zip or .csv). */
export async function readExport(file: string): Promise<CsvTable[]> {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.zip') {
    return (await unzip(file)).map((f) => readTable(f.name, f.text));
  }
  if (extension === '.csv') return [readTable(path.basename(file), readFileSync(file, 'utf8'))];
  throw new Error('Choisis l’export de YouTube Studio : un fichier .zip ou .csv');
}

export interface ReachRow {
  videoId: string;
  day: string | null;
  impressions: number | null;
  ctr: number | null;
  title: string | null;
}

/** Impressions / CTR by video (and by day for « Chart data »). */
export function reachRows(table: CsvTable): ReachRow[] {
  if (table.kind === 'unknown') return [];
  return table.rows
    .map((r) => ({
      videoId: (r.video ?? '').trim(),
      day: table.kind === 'daily' ? parseDate(r.date) : null,
      impressions: parseNumber(r.impressions),
      ctr: parseNumber(r.ctr),
      title: r.title ?? null,
    }))
    .filter((r) => /^[\w-]{11}$/.test(r.videoId) && (r.impressions !== null || r.ctr !== null));
}
