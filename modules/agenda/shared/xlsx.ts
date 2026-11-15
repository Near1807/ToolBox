// v0.37.0: an Excel file (.xlsx) as rows of text, and the import template
// as an .xlsx. An .xlsx is a zip of XML files: the zip is read and written
// by fflate (pure JavaScript, no dependency, it runs everywhere), the few
// XML parts needed are read here (the first sheet, its shared strings).
// Numbers are given as written (a date is Excel's number of days: the date
// parser of table.ts reads it). Formulas: their last computed value.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { ImportFileError } from './ics';

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : Number(k.slice(1)));
  });
const encode = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 refuses are left out.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** The text of every <t> of an XML fragment (a shared string or an inline string). */
const texts = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join('');

const columnIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
};

/** Upper bounds (a timetable is a few thousand rows). */
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 50;

/** The first sheet of an .xlsx as rows of text. Throws ImportFileError when it is not one. */
export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => f.name.startsWith('xl/') && f.name.endsWith('.xml') && f.originalSize < 50e6,
    });
  } catch {
    throw new ImportFileError('Ce fichier n’est pas un fichier Excel (.xlsx) lisible.');
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]!) : null);
  const workbook = text('xl/workbook.xml');
  if (!workbook)
    throw new ImportFileError('Ce fichier n’est pas un fichier Excel (.xlsx) lisible.');
  // The first sheet, through the workbook's relations.
  const firstId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  const rels = text('xl/_rels/workbook.xml.rels') ?? '';
  let target = 'worksheets/sheet1.xml';
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = m[1]!;
    if (firstId && new RegExp(`\\bId="${firstId}"`).test(attrs))
      target = /\bTarget="([^"]+)"/.exec(attrs)?.[1] ?? target;
  }
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheet = text(path);
  if (!sheet) throw new ImportFileError('La première feuille de ce fichier Excel est introuvable.');
  const shared = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (m) => texts(m[1]!),
  );
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (rows.length >= MAX_ROWS) break;
    const number = Number(/\br="(\d+)"/.exec(r[1]!)?.[1] ?? rows.length + 1);
    const row: string[] = [];
    let next = 0;
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const index = ref ? columnIndex(ref) : next;
      next = index + 1;
      if (index >= MAX_COLUMNS) continue;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? 'n';
      const body = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = texts(body);
      else if (v !== undefined) value = decode(v);
      row[index] = value;
    }
    for (let i = 0; i < row.length; i++) row[i] ??= '';
    // Rows missing in the sheet (empty) are not rows of the table.
    while (rows.length < number - 1 && rows.length < MAX_ROWS) rows.push([]);
    rows.push(row);
  }
  return rows.filter((row) => row.some((c) => c.trim()));
}

const columnName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** A one-sheet .xlsx of text cells (the template): header in bold, columns a bit wider. */
export function writeXlsx(rows: string[][], sheetName = 'Agenda'): Uint8Array {
  const sheetRows = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map(
            (v, c) =>
              `<c r="${columnName(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${encode(v)}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('');
  const width = Math.max(...rows.map((r) => r.length));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${encode(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    'xl/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="${width}" width="18" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  };
  // A fixed date: the same template gives the same file.
  return zipSync(files, { level: 6, mtime: new Date(Date.UTC(2026, 0, 1)) });
}
