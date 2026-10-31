// « Prêt pour la synchro » migration of the To-do, the Boîte à idées and the
// Timer (v0.25): every row copied with the same values, the old tables left
// untouched, the links between modules kept (a Timer session and an idea point
// to the To-do's new UUID of their task), the same result when replayed.
import Database from 'better-sqlite3';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Migration } from '@hub/sdk/backend';
import { loadModuleFolder, migrationDatabaseFor } from '@hub/sdk/testing';

// The modules are loaded from their folder, as the hub does (the core never imports one).
const migrations: Record<string, Migration[]> = {};
beforeAll(async () => {
  for (const id of ['todo', 'ideas', 'timer'])
    migrations[id] = (
      await loadModuleFolder(path.resolve(__dirname, '../modules', id))
    ).backend!.migrations!;
});
const sql = (id: string) => {
  const up = migrations[id]![0]!.up;
  if (typeof up !== 'string') throw new Error('v1 is SQL');
  return up;
};
const toSync = (id: string, db: Database.Database, seed: string) => {
  const up = migrations[id]![1]!.up;
  if (typeof up === 'string') throw new Error('v2 is code');
  up(migrationDatabaseFor(db, id, seed));
};

/** A v0.24 database: tasks 1–5 (3 deleted for good), ideas, sessions, presets. */
function v24(): Database.Database {
  const db = new Database(':memory:');
  db.exec(sql('todo'));
  db.exec(sql('ideas'));
  db.exec(sql('timer'));
  const t = db.prepare(
    'INSERT INTO todo__tasks (id, title, tags, due_date, done_at, created_at, updated_at, subject) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  t.run(
    1,
    'Finir le mix',
    '["mix"]',
    '2026-10-31',
    null,
    '2026-10-20T10:00:00.000Z',
    '2026-10-21T09:00:00.000Z',
    'music-library:track:1',
  );
  t.run(
    2,
    'Envoyer le master',
    '[]',
    null,
    '2026-10-22T12:00:00.000Z',
    '2026-10-20T10:00:00.000Z',
    '2026-10-22T12:00:00.000Z',
    null,
  );
  t.run(
    4,
    'Acheter des cordes',
    '["courses","studio"]',
    null,
    null,
    '2026-10-23T08:00:00.000Z',
    '2026-10-23T08:00:00.000Z',
    null,
  );
  t.run(
    5,
    'Break avec des cordes',
    '["arrangement"]',
    null,
    null,
    '2026-10-24T08:00:00.000Z',
    '2026-10-24T08:00:00.000Z',
    null,
  );
  const i = db.prepare(
    'INSERT INTO ideas__ideas (id, title, body, tags, subject, archived_at, task_id, task_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  i.run(
    1,
    'Clip de nuit',
    'Dans le **métro**',
    '["clip"]',
    'music-library:track:1',
    null,
    null,
    null,
    '2026-10-19T10:00:00.000Z',
    '2026-10-25T10:00:00.000Z',
  );
  i.run(
    2,
    'Break avec des cordes',
    '',
    '["arrangement"]',
    null,
    null,
    5,
    'Break avec des cordes',
    '2026-10-24T07:00:00.000Z',
    '2026-10-24T07:00:00.000Z',
  );
  i.run(
    3,
    'Vieille idée',
    '',
    '[]',
    null,
    '2026-10-26T10:00:00.000Z',
    3,
    'Tâche supprimée',
    '2026-10-01T10:00:00.000Z',
    '2026-10-02T10:00:00.000Z',
  );
  db.prepare('INSERT INTO ideas__tags (name, color) VALUES (?, ?)').run('clip', 3);
  db.prepare('INSERT INTO ideas__tags (name, color) VALUES (?, ?)').run('arrangement', 5);
  const s = db.prepare(
    "INSERT INTO timer__sessions (id, mode, name, config, phases, task_id, task_title, status, started_at, resumed_at, elapsed_before, last_index, ended_at, work_sec, answer, created_at) VALUES (?, 'pomodoro', ?, '{}', '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  s.run(
    1,
    'Pomodoro 25/5',
    1,
    'Finir le mix',
    'done',
    '2026-10-21T08:00:00.000Z',
    null,
    3000,
    2,
    '2026-10-21T09:00:00.000Z',
    3000,
    'no',
    '2026-10-21T08:00:00.000Z',
  );
  s.run(
    2,
    'Timer 25 min',
    2,
    'Envoyer le master',
    'done',
    '2026-10-22T11:00:00.000Z',
    null,
    1500,
    1,
    '2026-10-22T11:25:00.000Z',
    1500,
    'yes',
    '2026-10-22T11:00:00.000Z',
  );
  s.run(
    3,
    'Timer 10 min',
    null,
    null,
    'stopped',
    '2026-10-23T11:00:00.000Z',
    null,
    300,
    1,
    '2026-10-23T11:05:00.000Z',
    300,
    null,
    '2026-10-23T11:00:00.000Z',
  );
  s.run(
    4,
    'Démarrage doux',
    5,
    'Break avec des cordes',
    'running',
    '2026-10-30T09:00:00.000Z',
    '2026-10-30T09:10:00.000Z',
    420,
    1,
    null,
    null,
    null,
    '2026-10-30T09:00:00.000Z',
  );
  db.prepare(
    "INSERT INTO timer__presets (name, config, created_at) VALUES ('Mon pomodoro', '{\"mode\":\"pomodoro\"}', '2026-10-25T10:00:00.000Z')",
  ).run();
  return db;
}

const dump = (db: Database.Database, table: string) =>
  db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[];

function migrate(db: Database.Database, seed = 'installation-a') {
  for (const id of ['todo', 'ideas', 'timer']) toSync(id, db, seed);
}

describe('migration « Prêt pour la synchro » (To-do, Boîte à idées, Timer)', () => {
  it('copies every row with the same values, leaves the old tables untouched', () => {
    const db = v24();
    const before = Object.fromEntries(
      ['todo__tasks', 'ideas__ideas', 'ideas__tags', 'timer__sessions', 'timer__presets'].map(
        (t) => [t, dump(db, t)],
      ),
    );
    migrate(db);
    // The old tables, renamed, have exactly the same rows.
    expect(dump(db, 'todo__tasks_v1')).toEqual(before.todo__tasks);
    expect(dump(db, 'ideas__ideas_v1')).toEqual(before.ideas__ideas);
    expect(dump(db, 'ideas__tags_v1')).toEqual(before.ideas__tags);
    expect(dump(db, 'timer__sessions_v1')).toEqual(before.timer__sessions);
    expect(dump(db, 'timer__presets_v1')).toEqual(before.timer__presets);

    // Line by line: same values, a UUID, no tombstone, the old number kept.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const tasks = dump(db, 'todo__tasks');
    expect(tasks).toHaveLength(before.todo__tasks!.length);
    for (const old of before.todo__tasks!) {
      const row = tasks.find((r) => r.legacy_id === old.id)!;
      expect(row.id).toMatch(uuid);
      expect(row).toMatchObject({ ...old, id: row.id, deleted_at: null, legacy_id: old.id });
    }
    const taskId = (n: number) => tasks.find((r) => r.legacy_id === n)?.id ?? null;

    const ideaRows = dump(db, 'ideas__ideas');
    for (const old of before.ideas__ideas!) {
      const row = ideaRows.find((r) => r.legacy_id === old.id)!;
      const { task_id: oldTask, updated_at, ...same } = old;
      expect(row).toMatchObject({ ...same, id: row.id, updated_at, edited_at: updated_at });
      // The idea that became task 5 points to the To-do's new id of task 5.
      if (oldTask === 5) expect(row.task_id).toBe(taskId(5));
      // Task 3 was deleted for good before: no task has that id (as before).
      if (oldTask === 3) expect(tasks.some((t) => t.id === row.task_id)).toBe(false);
    }
    expect(dump(db, 'ideas__tags').map((t) => [t.name, t.color])).toEqual([
      ['clip', 3],
      ['arrangement', 5],
    ]);

    const sessions = dump(db, 'timer__sessions');
    for (const old of before.timer__sessions!) {
      const row = sessions.find((r) => r.legacy_id === old.id)!;
      const { task_id: oldTask, ...same } = old;
      expect(row).toMatchObject({ ...same, id: row.id, deleted_at: null });
      expect(row.task_id).toBe(oldTask === null ? null : taskId(oldTask as number));
    }
    // Time per task, as the To-do shows it: same seconds on the same tasks.
    const perTask = db
      .prepare(
        'SELECT task_id, SUM(work_sec) AS s FROM timer__sessions WHERE task_id IS NOT NULL AND work_sec IS NOT NULL GROUP BY task_id',
      )
      .all() as { task_id: string; s: number }[];
    expect(Object.fromEntries(perTask.map((p) => [p.task_id, p.s]))).toEqual({
      [String(taskId(1))]: 3000,
      [String(taskId(2))]: 1500,
    });
    // Presets: the two default ones (v1) and Thomas's, in the same order.
    expect(dump(db, 'timer__presets').map((p) => p.name)).toEqual(
      before.timer__presets!.map((p) => p.name),
    );

    // The pairs old → new, and one journal « create » per row.
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM todo__legacy_ids').get() as { n: number }).n,
    ).toBe(4);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM timer__changes WHERE op = 'create'").get() as {
          n: number;
        }
      ).n,
    ).toBe(4 + before.timer__presets!.length);
  });

  it('replayed (from the backup), it gives the very same ids; another installation, others', () => {
    const a = v24();
    const b = v24();
    const c = v24();
    migrate(a);
    migrate(b);
    migrate(c, 'installation-b');
    for (const table of ['todo__tasks', 'ideas__ideas', 'timer__sessions', 'timer__presets'])
      expect(dump(a, table)).toEqual(dump(b, table));
    expect(dump(c, 'todo__tasks').map((r) => r.id)).not.toEqual(
      dump(a, 'todo__tasks').map((r) => r.id),
    );
  });
});
