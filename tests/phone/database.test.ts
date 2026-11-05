// The phone's database adapter (sqlite-wasm) behaves like better-sqlite3 for
// everything the core and the modules use: same values, same errors, same
// transactions (nested ones as savepoints).
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { SqlDatabase } from '../../packages/phone/database';
import { openWasmDatabase } from '@hub/sdk/testing';

type Db = Pick<SqlDatabase, 'exec' | 'prepare' | 'transaction'>;

/** The same script on a database; every result or error, in order. */
function script(db: Db) {
  const out: unknown[] = [];
  const attempt = (label: string, fn: () => unknown) => {
    try {
      out.push([label, fn()]);
    } catch (error) {
      const e = error as Error & { code?: string };
      out.push([
        label,
        'error',
        e.constructor.name === 'SqliteError' ? 'SqliteError' : e.name,
        e.message,
        e.code ?? null,
      ]);
    }
  };
  db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT UNIQUE, n REAL, big INTEGER, blob BLOB);
           CREATE TABLE u (id TEXT PRIMARY KEY, v TEXT)`);
  const insert = db.prepare('INSERT INTO t (name, n, big) VALUES (?, ?, ?)');
  attempt('insert', () => insert.run('a', 1.5, 9007199254740991));
  attempt('insert 2', () => insert.run(['b', 2, 3]));
  attempt('unique', () => insert.run('a', 1, 1));
  attempt('boolean', () => insert.run('c', true, 1));
  attempt('undefined', () => insert.run('c', undefined, 1));
  attempt('too few', () => insert.run('c'));
  attempt('too many', () => insert.run('c', 1, 2, 3));
  attempt('syntax', () => db.prepare('SELEC 1'));
  attempt('no table', () => db.prepare('SELECT * FROM nope'));
  attempt('get', () => db.prepare('SELECT * FROM t WHERE name = ?').get('a'));
  attempt('get none', () => db.prepare('SELECT * FROM t WHERE name = ?').get('zz'));
  attempt('all', () => db.prepare('SELECT id, name, n, big, blob FROM t ORDER BY id').all());
  attempt('count', () =>
    db.prepare('SELECT COUNT(*) AS c, MAX(n) AS m, SUM(big) AS s FROM t').get(),
  );
  attempt('get on write', () => db.prepare('DELETE FROM t WHERE id = 99').get());
  attempt('update', () => db.prepare('UPDATE t SET n = n * 2').run());
  attempt('select run', () => db.prepare('SELECT 1').run());
  attempt('dup columns', () => db.prepare('SELECT 1 AS x, 2 AS x').get());
  attempt('json', () => db.prepare("SELECT json_extract('{\"a\":[1,2]}', '$.a') AS j").get());
  // Transactions: committed, rolled back, nested savepoint rolled back alone.
  const add = db.prepare('INSERT INTO u (id, v) VALUES (?, ?)');
  db.transaction(() => add.run('1', 'ok'))();
  attempt('rollback', () =>
    db.transaction(() => {
      add.run('2', 'lost');
      throw new Error('boom');
    })(),
  );
  db.transaction(() => {
    add.run('3', 'outer');
    attempt('inner', () =>
      db.transaction(() => {
        add.run('4', 'inner lost');
        throw new Error('inner boom');
      })(),
    );
    db.transaction(() => add.run('5', 'inner kept'))();
  })();
  attempt('rows', () => db.prepare('SELECT * FROM u ORDER BY id').all());
  attempt('pk', () => add.run('1', 'again'));
  return out;
}

describe('phone database adapter (sqlite-wasm) = better-sqlite3', () => {
  it('same values, same errors, same transactions', async () => {
    const pc = new Database(':memory:');
    const phone = await openWasmDatabase();
    const fromPc = script(pc as unknown as Db);
    const fromPhone = script(phone);
    expect(fromPhone).toEqual(fromPc);
    // A plain object per row, like better-sqlite3.
    const row = phone.prepare('SELECT 1 AS a').get() as object;
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });
});
