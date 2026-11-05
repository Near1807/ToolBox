// The phone's database (ADR 0044): SQLite compiled to WebAssembly
// (@sqlite.org/sqlite-wasm, VFS opfs-sahpool in the app's Worker), behind the
// same synchronous interface as better-sqlite3 on the PC — the subset the
// core and the modules use: exec, prepare → run / get / all, transaction
// (nested: savepoints). Same values (plain row objects, numbers), same
// errors (messages without sqlite-wasm's prefix, `code` like SQLITE_…).
// Portable: no Node import; the sqlite3 object is given by the caller.

/** What this adapter needs of an sqlite-wasm `oo1.DB` (structural, no import). */
export interface WasmDb {
  exec(sql: string): unknown;
  prepare(sql: string): WasmStatement;
  changes(total?: boolean, sixtyFour?: boolean): number | bigint;
  close(): void;
}
interface WasmStatement {
  readonly pointer?: unknown;
  readonly columnCount: number;
  readonly parameterCount: number;
  bind(values: unknown[]): unknown;
  step(): boolean;
  get(index: number): unknown;
  getColumnNames(): string[];
  finalize(): unknown;
}
/** The part of the sqlite3 namespace the adapter uses. */
export interface WasmSqlite {
  capi: {
    sqlite3_last_insert_rowid(db: WasmDb): number | bigint;
    sqlite3_stmt_readonly(stmt: unknown): number;
  };
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}
export interface SqlStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
/** The better-sqlite3 subset (`SqliteDatabase` of backend/core/migrations-core.ts). */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  close(): void;
}

/** sqlite-wasm's « SQLITE_CONSTRAINT_UNIQUE: sqlite3 result code 2067: UNIQUE … » → like better-sqlite3. */
function sqliteError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error));
  const m = /^(SQLITE_[A-Z_]+): sqlite3 result code \d+: ([\s\S]*)$/.exec(error.message);
  if (!m) return error;
  const out = new Error(m[2]) as Error & { code: string };
  out.name = 'SqliteError';
  out.code = m[1]!;
  return out;
}

/**
 * better-sqlite3 accepts the values as arguments or as an array (undefined
 * binds NULL); never booleans or objects.
 */
function bindings(params: unknown[], expected: number): unknown[] {
  const values = (params.length === 1 && Array.isArray(params[0]) ? params[0] : params).map(
    (v: unknown) => (v === undefined ? null : v),
  );
  for (const v of values) {
    const ok =
      v === null ||
      typeof v === 'number' ||
      typeof v === 'string' ||
      typeof v === 'bigint' ||
      v instanceof Uint8Array;
    if (!ok)
      throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null');
  }
  if (values.length < expected) throw new RangeError('Too few parameter values were provided');
  if (values.length > expected) throw new RangeError('Too many parameter values were provided');
  return values;
}

/** A column value as better-sqlite3 gives it (numbers, not bigints). */
function value(v: unknown): unknown {
  return typeof v === 'bigint' ? Number(v) : v;
}

export function wrapWasmDatabase(db: WasmDb, sqlite3: WasmSqlite): SqlDatabase {
  let depth = 0;
  const withStatement = <T>(sql: string, params: unknown[], use: (s: WasmStatement) => T): T => {
    let stmt: WasmStatement;
    try {
      stmt = db.prepare(sql);
    } catch (error) {
      throw sqliteError(error);
    }
    try {
      const values = bindings(params, stmt.parameterCount);
      if (values.length) stmt.bind(values);
      return use(stmt);
    } catch (error) {
      throw sqliteError(error);
    } finally {
      stmt.finalize();
    }
  };
  const row = (stmt: WasmStatement, names: string[]) => {
    const out: Record<string, unknown> = {};
    names.forEach((name, i) => (out[name] = value(stmt.get(i))));
    return out;
  };
  const reader = (stmt: WasmStatement) => {
    if (stmt.columnCount === 0)
      throw new TypeError('This statement does not return data. Use run() instead');
    return stmt.getColumnNames();
  };
  const exec = (sql: string) => {
    try {
      db.exec(sql);
    } catch (error) {
      throw sqliteError(error);
    }
  };
  return {
    exec,
    prepare(sql) {
      // Compiled now, like better-sqlite3 (a syntax error throws here).
      try {
        db.prepare(sql).finalize();
      } catch (error) {
        throw sqliteError(error);
      }
      return {
        run: (...params) =>
          withStatement(sql, params, (stmt) => {
            while (stmt.step()) {
              /* a statement that returns rows: run() ignores them */
            }
            // A statement that changes nothing (SELECT…) reports 0, like better-sqlite3.
            const readonly = sqlite3.capi.sqlite3_stmt_readonly(stmt.pointer) !== 0;
            return {
              changes: readonly ? 0 : Number(db.changes()),
              lastInsertRowid: Number(sqlite3.capi.sqlite3_last_insert_rowid(db)),
            };
          }),
        get: (...params) =>
          withStatement(sql, params, (stmt) => {
            const names = reader(stmt);
            return stmt.step() ? row(stmt, names) : undefined;
          }),
        all: (...params) =>
          withStatement(sql, params, (stmt) => {
            const names = reader(stmt);
            const rows: unknown[] = [];
            while (stmt.step()) rows.push(row(stmt, names));
            return rows;
          }),
      };
    },
    transaction(fn) {
      return (...args) => {
        const level = depth++;
        const name = `tx_${level}`;
        exec(level === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
        try {
          const result = fn(...args);
          exec(level === 0 ? 'COMMIT' : `RELEASE ${name}`);
          return result;
        } catch (error) {
          if (level === 0) exec('ROLLBACK');
          else exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
          throw error;
        } finally {
          depth--;
        }
      };
    },
    close: () => db.close(),
  };
}
