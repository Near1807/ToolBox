// Importing a table (v0.37.0): the template (CSV and Excel, read back the
// same), the columns guessed then chosen, the date and time formats, the key
// without an identifier, and the route with a sheet of other column names.
process.env.TZ = 'Europe/Brussels';

import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestHost,
  createTestHub,
  dumpTables,
  loadModuleFolder,
  type TestHub,
} from '@hub/sdk/testing';
import {
  guessColumns,
  parseCsv,
  parseDateCell,
  parseDurationCell,
  parseTimeCell,
  tableItems,
  TEMPLATE_ROWS,
  templateCsv,
} from '../shared/table';
import { readXlsx, writeXlsx } from '../shared/xlsx';

describe('dates, times, lengths in a cell', () => {
  it('dates: JJ/MM/AAAA, J/M/AA, AAAA-MM-JJ, with a time, Excel numbers; nonsense refused', () => {
    expect(parseDateCell('15/01/2026')).toEqual({ day: '2026-01-15', minutes: null });
    expect(parseDateCell('5/1/26')).toEqual({ day: '2026-01-05', minutes: null });
    expect(parseDateCell('15.01.2026')).toEqual({ day: '2026-01-15', minutes: null });
    expect(parseDateCell('2026-01-15')).toEqual({ day: '2026-01-15', minutes: null });
    expect(parseDateCell('2026-01-15 08:30')).toEqual({ day: '2026-01-15', minutes: 510 });
    expect(parseDateCell('15/01/2026 8h30')).toEqual({ day: '2026-01-15', minutes: 510 });
    expect(parseDateCell('46037')).toEqual({ day: '2026-01-15', minutes: null });
    expect(parseDateCell('46037.354166667')).toEqual({ day: '2026-01-15', minutes: 510 });
    for (const bad of ['31/02/2026', 'demain', '2026-13-01', '12', ''])
      expect(parseDateCell(bad), bad).toBeNull();
  });
  it('times: 8h30, 8h, 08:30, 8:30:00, Excel fractions; lengths: 90, 1h30, 1:30, 2 h, 1,5h', () => {
    expect(['8h30', '8h', '08:30', '8:30:00', '0.354166667', '8 h 30'].map(parseTimeCell)).toEqual([
      510, 480, 510, 510, 510, 510,
    ]);
    expect(parseTimeCell('25:00')).toBeNull();
    expect(['90', '90 min', '1h30', '1:30', '2 h', '1,5h'].map(parseDurationCell)).toEqual([
      90, 90, 90, 90, 120, 90,
    ]);
  });
});

describe('a table as events', () => {
  it('the template: its header is guessed whole, its rows become events', () => {
    const rows = parseCsv(templateCsv());
    expect(rows).toEqual(TEMPLATE_ROWS);
    const columns = guessColumns(rows[0]!);
    expect(Object.keys(columns)).toHaveLength(10);
    const { items, errors } = tableItems(rows, columns);
    expect(errors).toEqual([]);
    expect(items.map((i) => [i.key, i.title, i.start, i.end, i.allDay, i.rawCategory])).toEqual([
      ['id:TH-001', 'Thermodynamique', '2027-01-15T08:30', '2027-01-15T10:15', false, 'Cours'],
      [
        'examen d analyse|2027-01-20T09:00',
        'Examen d’analyse',
        '2027-01-20T09:00',
        '2027-01-20T12:00',
        false,
        'Examens',
      ],
      [
        'journee portes ouvertes|2027-02-06',
        'Journée portes ouvertes',
        '2027-02-06',
        '2027-02-06',
        true,
        'Cours',
      ],
    ]);
    expect(items[0]!.original).toMatchObject({ titre: 'Thermodynamique', lieu: '2F51' });
  });

  it('the Excel template, read back: the same rows', () => {
    expect(readXlsx(writeXlsx(TEMPLATE_ROWS))).toEqual(TEMPLATE_ROWS);
  });

  it('an Excel sheet of another program: shared strings, numbers as dates, empty cells', () => {
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
      <row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>46037</v></c><c r="C2"><v>0.354166666666667</v></c><c r="D2"><v>90</v></c></row>
      <row r="4"><c r="A4" t="inlineStr"><is><t>Labo &amp; TP</t></is></c><c r="B4"><v>46038.5</v></c></row>
    </sheetData></worksheet>`;
    const shared = `<sst><si><t>Cours</t></si><si><t>Jour</t></si><si><t>Heure</t></si><si><t>Durée</t></si><si><r><t>Ther</t></r><r><t>mo</t></r></si></sst>`;
    const bytes = zipSync({
      'xl/workbook.xml': strToU8(
        '<workbook><sheets><sheet name="Feuil1" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
      'xl/sharedStrings.xml': strToU8(shared),
    });
    const rows = readXlsx(bytes);
    expect(rows).toEqual([
      ['Cours', 'Jour', 'Heure', 'Durée'],
      ['Thermo', '46037', '0.354166666666667', '90'],
      ['Labo & TP', '46038.5'],
    ]);
    const { items } = tableItems(rows, guessColumns(rows[0]!));
    expect(items.map((i) => [i.title, i.start, i.end])).toEqual([
      ['Thermo', '2026-01-15T08:30', '2026-01-15T10:00'],
      ['Labo & TP', '2026-01-16T12:00', '2026-01-16T13:00'],
    ]);
    expect(() => readXlsx(strToU8('pas un zip'))).toThrow(/n’est pas un fichier Excel/);
  });

  it('errors with their line; an end before the start is the next day; duplicates', () => {
    const rows = parseCsv(
      'titre,date,début,fin\r\nNuit,15/01/2026,22h00,02h00\r\n,15/01/2026,8h,9h\r\nX,hier,8h,9h\r\nNuit,15/01/2026,22h00,02h00\r\n',
    );
    const { items, errors } = tableItems(rows, guessColumns(rows[0]!));
    expect(items.map((i) => [i.start, i.end])).toEqual([['2026-01-15T22:00', '2026-01-16T02:00']]);
    expect(errors).toEqual([
      { line: 3, reason: 'titre vide' },
      { line: 4, reason: 'date illisible : « hier »' },
      { line: 5, reason: 'ligne en double (même titre et même début)' },
    ]);
    expect(() => tableItems(rows, {})).toThrow(/colonne « titre »/);
  });
});

describe('importing a table (route)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  it('other column names: chosen by hand, kept for the source; without identifier, moved = gone + added', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 15, 10) });
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    const API = '/api/modules/agenda';
    const csv =
      'Matière;Le;À;Jusqu’à;Salle\nThermo;17/11/2026;8h15;10h;2F51\nAnalyse;18/11/2026;13h45;15h15;\n';
    const a = await hub.request<{ headers: string[]; columns: Record<string, number> }>(
      'POST',
      `${API}/import/analyze`,
      { format: 'csv', text: csv },
    );
    expect(a.body.headers).toEqual(['Matière', 'Le', 'À', 'Jusqu’à', 'Salle']);
    expect(a.body.columns).toEqual({ location: 4 }); // Not enough: the columns screen asks.
    const columns = { title: 0, date: 1, start: 2, end: 3, location: 4 };
    const choice = {
      format: 'csv',
      text: csv,
      name: 'Horaire CSV',
      defaultCategory: 'Cours',
      columns,
    };
    const p = await hub.request<{ add: { key: string }[] }>(
      'POST',
      `${API}/import/preview`,
      choice,
    );
    expect(p.body.add.map((l) => l.key)).toEqual([
      'thermo|2026-11-17T08:15',
      'analyse|2026-11-18T13:45',
    ]);
    const done = await hub.request<{ source: { id: string; columns: unknown } }>(
      'POST',
      `${API}/import/apply`,
      {
        ...choice,
        accept: p.body.add.map((l) => l.key),
      },
    );
    expect(done.body.source.columns).toEqual(columns);
    // Next time, the source's columns are used; the course moved to 9h: gone + added.
    const moved = csv.replace('8h15;10h', '9h;10h45');
    const again = await hub.request<{
      add: { key: string }[];
      gone: { key: string }[];
      same: number;
    }>('POST', `${API}/import/preview`, {
      format: 'csv',
      text: moved,
      sourceId: done.body.source.id,
    });
    expect(again.body.add.map((l) => l.key)).toEqual(['thermo|2026-11-17T09:00']);
    expect(again.body.gone.map((l) => l.key)).toEqual(['thermo|2026-11-17T08:15']);
    expect(again.body.same).toBe(1);
    // The same through an Excel sheet (rows read by the page).
    const xlsxRows = readXlsx(writeXlsx(parseCsv(moved)));
    const x = await hub.request<{ add: unknown[]; gone: unknown[]; same: number }>(
      'POST',
      `${API}/import/preview`,
      {
        format: 'xlsx',
        rows: xlsxRows,
        sourceId: done.body.source.id,
      },
    );
    expect([x.body.add.length, x.body.gone.length, x.body.same]).toEqual([1, 1, 1]);
    expect(dumpTables(hub.dataDir, 'agenda').agenda__events).toHaveLength(2);
  });

  it('the template, saved through « Enregistrer sous »: CSV and Excel, read back the same', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'agenda-template-'));
    let target = '';
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({ selectSaveFile: () => Promise.resolve(target) }),
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    for (const format of ['csv', 'xlsx'] as const) {
      target = path.join(dir, `modèle.${format}`);
      const r = await hub.request<{ path: string }>('POST', '/api/modules/agenda/import/template', {
        format,
      });
      expect(r.body.path).toBe(target);
      const bytes = readFileSync(target);
      const rows =
        format === 'csv' ? parseCsv(bytes.toString('utf8')) : readXlsx(new Uint8Array(bytes));
      expect(rows).toEqual(TEMPLATE_ROWS);
    }
  });
});
