// The phone's safety net: one copy a day at opening (never of an empty base),
// the 7 newest kept, a restore OFFERED when the base is absent or empty and a
// copy with data exists — never automatic.
import { describe, expect, it } from 'vitest';
import { openWasmDatabase } from '@hub/sdk/testing';
import { PhoneHub } from '../../packages/phone/host';
import {
  countBase,
  describeCounts,
  needsCopyBeforeMigration,
  copiesToDelete,
  copyFileName,
  KEEP_COPIES,
  localDay,
  needsDailyCopy,
  restoreOffer,
  type BackupCopy,
} from '../../packages/phone/backup';

const copy = (day: string, rows = 10, hour = '08'): BackupCopy => ({
  file: copyFileName(`${day}T${hour}:00:00.000Z`),
  createdAt: `${day}T${hour}:00:00.000Z`,
  day,
  tasks: rows,
  rows,
  appVersion: '0.30.0',
  reason: 'quotidienne',
});
const full = { absent: false, rows: 12 };

describe('phone safety net', () => {
  it('one copy a day: taken when none today, not twice the same day', () => {
    expect(needsDailyCopy([], '2026-11-06', full)).toBe(true);
    expect(needsDailyCopy([copy('2026-11-05')], '2026-11-06', full)).toBe(true);
    expect(needsDailyCopy([copy('2026-11-06')], '2026-11-06', full)).toBe(false);
  });

  it('never a copy of an absent or empty base (the good copies are not pushed out)', () => {
    expect(needsDailyCopy([copy('2026-11-01')], '2026-11-06', { absent: true, rows: 0 })).toBe(
      false,
    );
    expect(needsDailyCopy([], '2026-11-06', { absent: false, rows: 0 })).toBe(false);
  });

  it('the 7 newest are kept, the older ones deleted', () => {
    expect(KEEP_COPIES).toBe(7);
    const copies = Array.from({ length: 10 }, (_, i) =>
      copy(`2026-11-${String(i + 1).padStart(2, '0')}`),
    );
    const deleted = copiesToDelete(copies).map((c) => c.day);
    expect(deleted).toEqual(['2026-11-03', '2026-11-02', '2026-11-01']);
    expect(copiesToDelete(copies.slice(0, 7))).toEqual([]);
  });

  it('restore offered only when the base is absent or empty AND a copy with data exists', () => {
    const copies = [copy('2026-11-04'), copy('2026-11-05', 0), copy('2026-11-03')];
    // Full base: nothing offered.
    expect(restoreOffer(copies, full)).toBeNull();
    // Absent or empty: the newest copy WITH data (the empty one is skipped).
    expect(restoreOffer(copies, { absent: true, rows: 0 })?.day).toBe('2026-11-04');
    expect(restoreOffer(copies, { absent: false, rows: 0 })?.day).toBe('2026-11-04');
    // No copy (or only empty ones): nothing to offer.
    expect(restoreOffer([], { absent: true, rows: 0 })).toBeNull();
    expect(restoreOffer([copy('2026-11-05', 0)], { absent: true, rows: 0 })).toBeNull();
  });

  it('local day and file names', () => {
    expect(localDay(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05');
    expect(copyFileName('2026-11-05T10:00:00.000Z')).toBe(
      'toolbox-2026-11-05T10-00-00-000Z.sqlite3',
    );
  });
});

describe('copy before migration (« avant-migration »)', () => {
  // A module with the To-do's id and table (the socle never imports a module).
  const MIGRATIONS = [
    {
      version: 1,
      description: 'tasks',
      up: 'CREATE TABLE todo__tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, created_at TEXT, updated_at TEXT)',
    },
    {
      version: 2,
      description: 'soft delete',
      up: 'ALTER TABLE todo__tasks ADD COLUMN deleted_at TEXT',
    },
    {
      version: 3,
      description: 'tags',
      up: "ALTER TABLE todo__tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'",
    },
  ];
  const todoBackend = { migrations: MIGRATIONS, register: () => {} };
  const todo = (migrations?: number) => ({
    manifest: {
      id: 'todo',
      name: 'To-do',
      description: 'test',
      version: '1.0.0',
      section: 'Outils',
      icon: 'bug',
    } as never,
    backend: { ...todoBackend, migrations: MIGRATIONS.slice(0, migrations ?? MIGRATIONS.length) },
  });

  it('pending migrations are listed without writing anything; a non-empty base is copied first', async () => {
    const db = await openWasmDatabase();
    // A fresh base: everything pending, but nothing to protect.
    const fresh = PhoneHub.pendingMigrations(db, [todo()]);
    expect(fresh.map((p) => p.scope)).toEqual(['core', 'todo']);
    expect(needsCopyBeforeMigration({ absent: true, rows: 0 }, fresh.length)).toBe(false);

    // The installed version only knows the first migration of the To-do.
    const old = await PhoneHub.start({ db, modules: [todo(1)], log: () => {} });
    await old.close();
    db.prepare(
      "INSERT INTO todo__tasks (title, created_at, updated_at) VALUES ('Une', 'x', 'x')",
    ).run();
    const schema = () =>
      JSON.stringify(db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all()) +
      JSON.stringify(db.prepare('SELECT * FROM core__migrations ORDER BY scope, version').all());
    const before = schema();
    const pending = PhoneHub.pendingMigrations(db, [todo()]);
    expect(pending).toEqual([{ scope: 'todo', count: todoBackend.migrations!.length - 1 }]);
    expect(schema()).toBe(before); // Nothing written.
    const base = { absent: false, ...countBase(db) };
    expect(base.rows).toBeGreaterThan(0);
    expect(needsCopyBeforeMigration(base, pending.length)).toBe(true);
    // Up to date: no copy.
    const now = await PhoneHub.start({ db, modules: [todo()], log: () => {} });
    await now.close();
    expect(PhoneHub.pendingMigrations(db, [todo()])).toEqual([]);
    expect(needsCopyBeforeMigration(base, 0)).toBe(false);
  });

  it('the copy cards count elements per module (deleted ones left out)', async () => {
    const db = await openWasmDatabase();
    const hub = await PhoneHub.start({ db, modules: [todo()], log: () => {} });
    await hub.close();
    for (const [id, deleted] of [
      ['a', null],
      ['b', null],
      ['c', 'x'],
    ] as const)
      db.prepare(
        'INSERT INTO todo__tasks (title, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?)',
      ).run(id, 'x', 'x', deleted);
    const counted = countBase(db);
    expect(counted.counts).toEqual({ tasks: 2 });
    expect(counted.tasks).toBe(2);
    expect(describeCounts(counted)).toBe('2 tâches');
    expect(describeCounts({ tasks: 1, counts: { tasks: 1, ideas: 3, recipes: 1 } })).toBe(
      '1 tâche · 3 idées · 1 recette',
    );
    // A card of 0.30.0 (no counts): its tasks.
    expect(describeCounts({ tasks: 4 })).toBe('4 tâches');
    expect(describeCounts({ tasks: 0, counts: {} })).toBe('aucun élément');
  });
});
