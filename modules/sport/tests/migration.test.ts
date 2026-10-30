// Migration 3: the exercise lists stored as JSON (v0.23–v0.24) become one row
// per line, nothing lost, journalled; the old column is left as it was.
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import sport from '../backend';

const migrate = (db: Database.Database, upTo: number, from = 1) => {
  for (const m of sport.migrations ?? []) {
    if (m.version > upTo || m.version < from) continue;
    const shim = {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => db.prepare(sql),
      table: (n: string) => `sport__${n}`,
    };
    db.transaction(() => (typeof m.up === 'string' ? db.exec(m.up) : m.up(shim as never)))();
  }
};

describe('sport migration 3', () => {
  it('turns every JSON line into a row, in order, without losing anything', () => {
    const db = new Database(':memory:');
    migrate(db, 2);
    const at = '2026-10-29T10:00:00.000Z';
    db.prepare(
      "INSERT INTO sport__exercises (id, created_at, updated_at, name) VALUES ('e1', ?, ?, 'Squat'), ('e2', ?, ?, 'Gainage')",
    ).run(at, at, at, at);
    const lines = JSON.stringify([
      { exerciseId: 'e1', sets: 4, reps: '8', load: '60 kg', restSec: 120, note: '' },
      { exerciseId: 'e2', sets: 3, reps: '45 s', load: '', restSec: null, note: 'dos plat' },
    ]);
    db.prepare(
      "INSERT INTO sport__templates (id, created_at, updated_at, weekday, name, start_time, duration_min, exercises) VALUES ('t1', ?, ?, 1, 'Jambes', '18:30', 75, ?)",
    ).run(at, at, lines);
    db.prepare(
      "INSERT INTO sport__sessions (id, created_at, updated_at, date, week, name, start_time, duration_min, template_id, exercises) VALUES ('s1', ?, ?, '2026-10-26', '2026-10-26', 'Jambes', '18:30', 75, 't1', ?)",
    ).run(at, at, lines);
    db.prepare(
      "INSERT INTO sport__sessions (id, created_at, updated_at, date, week, name, start_time, duration_min, exercises) VALUES ('s2', ?, ?, '2026-10-27', '2026-10-26', 'Vélo', '07:00', 30, 'pas du JSON')",
    ).run(at, at);
    migrate(db, 3, 3);
    const rows = db
      .prepare(
        'SELECT session_id, exercise_id, position, sets, reps, load, rest_sec, note, created_at FROM sport__session_exercises ORDER BY session_id, position',
      )
      .all();
    expect(rows).toEqual([
      {
        session_id: 's1',
        exercise_id: 'e1',
        position: 0,
        sets: 4,
        reps: '8',
        load: '60 kg',
        rest_sec: 120,
        note: '',
        created_at: at,
      },
      {
        session_id: 's1',
        exercise_id: 'e2',
        position: 1,
        sets: 3,
        reps: '45 s',
        load: '',
        rest_sec: null,
        note: 'dos plat',
        created_at: at,
      },
    ]);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM sport__template_exercises').get() as { n: number }).n,
    ).toBe(2);
    // Journalled for the future synchronisation; the old column untouched.
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM sport__changes WHERE op = 'create'").get() as {
          n: number;
        }
      ).n,
    ).toBe(4);
    expect(
      (
        db.prepare("SELECT exercises FROM sport__sessions WHERE id = 's1'").get() as {
          exercises: string;
        }
      ).exercises,
    ).toBe(lines);
  });
});
