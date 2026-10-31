// Provenance of the numbers: the v0.18 migration labels the rows of before
// (what can be known for sure, nothing guessed), the API always wins over a
// CSV, and deleting an import never touches a value of the API.
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { ModuleContext } from '@hub/sdk/backend';
import { MIGRATION_V1, migrationV2, StatsStore } from '../backend/store';

function open() {
  const sqlite = new Database(':memory:');
  sqlite.exec(MIGRATION_V1);
  const table = (name: string) => `youtube_stats__${name}`;
  const migrate = () =>
    migrationV2({
      exec: (sql) => sqlite.exec(sql),
      prepare: (sql) => sqlite.prepare(sql),
      table,
      legacyId: () => {
        throw new Error('not used');
      },
    });
  const ctx = {
    db: {
      prefix: 'youtube_stats__',
      table,
      prepare: (sql: string) => sqlite.prepare(sql),
      transaction: <T>(fn: () => T) => sqlite.transaction(fn)(),
      backup: () => 'none',
    },
  } as unknown as ModuleContext;
  return { sqlite, migrate, store: new StatsStore(ctx) };
}

type Sqlite = InstanceType<typeof Database>;

/** Rows as v0.17 wrote them: API days (with an average duration), CSV-only days. */
function seedV17(sqlite: Sqlite, options: { imports: string[]; reach: string | null }) {
  sqlite
    .prepare(
      `INSERT INTO youtube_stats__videos (id, title, published_at, kind, updated_at, impressions, ctr)
       VALUES ('video000001', 'A', '2026-09-01T10:00:00Z', 'video', 'x', 900, 4.2)`,
    )
    .run();
  const day = sqlite.prepare(
    `INSERT INTO youtube_stats__days (video_id, day, views, minutes, avg_view_duration, impressions, ctr)
     VALUES ('video000001', ?, ?, ?, ?, ?, ?)`,
  );
  day.run('2026-09-01', 10, 5, 30, 100, 3);
  day.run('2026-09-02', 12, 6, 31, null, null);
  // v0.17: a CSV row on a day the API did not have yet (views 0 by default).
  day.run('2026-09-20', 0, 0, null, 50, 2);
  for (const kind of options.imports)
    sqlite
      .prepare(
        `INSERT INTO youtube_stats__imports (file_name, imported_at, kind, rows, matched, columns)
         VALUES (?, '2026-09-21T10:00:00Z', ?, 1, 1, '[]')`,
      )
      .run(`${kind}.csv`, kind);
  if (options.reach)
    sqlite
      .prepare(`INSERT INTO youtube_stats__meta (key, value) VALUES ('reach', ?)`)
      .run(JSON.stringify(options.reach));
}

const rows = (sqlite: Sqlite) =>
  sqlite
    .prepare(`SELECT day, api_at, reach_source, import_id FROM youtube_stats__days ORDER BY day`)
    .all() as {
    day: string;
    api_at: string | null;
    reach_source: string | null;
    import_id: number | null;
  }[];

describe('migration of the data of before v0.18', () => {
  it('one daily and one totals import, the API never gave impressions: attributed to them', () => {
    const { sqlite, migrate, store } = open();
    seedV17(sqlite, { imports: ['daily', 'totals'], reach: 'unavailable' });
    migrate();
    expect(rows(sqlite)).toEqual([
      { day: '2026-09-01', api_at: 'avant-0.18', reach_source: 'csv', import_id: 1 },
      { day: '2026-09-02', api_at: 'avant-0.18', reach_source: null, import_id: null },
      { day: '2026-09-20', api_at: null, reach_source: 'csv', import_id: 1 },
    ]);
    const imports = store.imports();
    expect(imports.find((i) => i.id === 1)).toMatchObject({
      legacy: true,
      days: 2,
      period_from: '2026-09-01',
      period_to: '2026-09-20',
    });
    expect(imports.find((i) => i.id === 2)).toMatchObject({ legacy: true, videos: 1 });
    expect(store.unattributedCsv()).toEqual({ days: 0, videos: 0 });
    // The CSV-only day made the old sync believe the days up to it were known: repaired.
    expect(store.meta('fullResync')).toBe('migration-0.18');
    expect(store.lastDayOf('video000001')).toBe('2026-09-02');
  });

  it('several imports: not attributable for sure, so nothing is guessed', () => {
    const { sqlite, migrate, store } = open();
    seedV17(sqlite, { imports: ['daily', 'daily', 'totals', 'totals'], reach: null });
    migrate();
    expect(rows(sqlite).map((r) => r.import_id)).toEqual([null, null, null]);
    expect(rows(sqlite).map((r) => r.reach_source)).toEqual(['csv', null, 'csv']);
    expect(store.unattributedCsv()).toEqual({ days: 2, videos: 1 });
    // « Supprimer toutes les données CSV » removes them; the API views stay.
    expect(store.deleteImport('all')).toEqual({ days: 2, rowsRemoved: 1, videos: 1 });
    expect(
      sqlite.prepare(`SELECT day, views, impressions FROM youtube_stats__days ORDER BY day`).all(),
    ).toEqual([
      { day: '2026-09-01', views: 10, impressions: null },
      { day: '2026-09-02', views: 12, impressions: null },
    ]);
    expect(store.imports()).toEqual([]);
  });

  it('API and CSV both gave impressions: « unknown », never counted as the API', () => {
    const { sqlite, migrate } = open();
    seedV17(sqlite, { imports: ['daily'], reach: 'api' });
    migrate();
    expect(rows(sqlite).map((r) => r.reach_source)).toEqual(['unknown', null, 'unknown']);
  });

  it('no import at all: every impression is the API’s', () => {
    const { sqlite, migrate, store } = open();
    seedV17(sqlite, { imports: [], reach: 'api' });
    migrate();
    expect(rows(sqlite).map((r) => r.reach_source)).toEqual(['api', null, 'api']);
    expect(store.unattributedCsv().days).toBe(0);
  });
});

describe('priority of the sources', () => {
  it('the API wins over a CSV, whichever comes first', () => {
    const { migrate, store, sqlite } = open();
    migrate();
    const reach = (impressions: number) => [
      { videoId: 'video000001', day: '2026-10-01', impressions, ctr: 3 },
    ];
    const first = store.addImport({
      fileName: 'a.csv',
      kind: 'daily',
      rows: 1,
      matched: 1,
      columns: [],
      metrics: ['impressions'],
    });
    expect(store.upsertReach(reach(100), { kind: 'csv', importId: first })).toEqual({
      written: 1,
      keptApi: 0,
    });
    // The API arrives: it replaces the CSV value.
    store.upsertReach(reach(140), { kind: 'api' });
    // A later CSV does not mask it.
    const second = store.addImport({
      fileName: 'b.csv',
      kind: 'daily',
      rows: 1,
      matched: 1,
      columns: [],
      metrics: ['impressions'],
    });
    expect(store.upsertReach(reach(90), { kind: 'csv', importId: second })).toEqual({
      written: 0,
      keptApi: 1,
    });
    expect(
      sqlite.prepare(`SELECT impressions, reach_source, import_id FROM youtube_stats__days`).get(),
    ).toEqual({ impressions: 140, reach_source: 'api', import_id: null });
    // Deleting the imports leaves the API value.
    store.deleteImport(first);
    store.deleteImport(second);
    expect(sqlite.prepare(`SELECT impressions FROM youtube_stats__days`).get()).toEqual({
      impressions: 140,
    });
  });

  it('API days: only real changes are counted', () => {
    const { migrate, store } = open();
    migrate();
    const row = {
      videoId: 'video000001',
      day: '2026-10-01',
      views: 5,
      engagedViews: null,
      minutes: 1,
      avgViewDuration: 30,
      avgViewPct: 50,
      likes: 0,
      comments: 0,
      shares: 0,
      subsGained: 0,
      subsLost: 0,
      impressions: null,
      ctr: null,
    };
    expect(store.upsertDays([row])).toBe(1);
    expect(store.upsertDays([row])).toBe(0);
    expect(store.upsertDays([{ ...row, views: 6 }])).toBe(1);
  });
});
