// Test helpers for the phone (ADR 0044), re-exported by @hub/sdk/testing:
// sqlite-wasm under Node (in memory: the same engine and SQL as the phone,
// without its OPFS storage), the phone host, its tables and its requests.
// Only for tests.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapWasmDatabase, type SqlDatabase, type WasmDb } from '../phone/database';

let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>> | null = null;

export async function openWasmDatabase(): Promise<SqlDatabase> {
  sqlite3 ??= await (sqlite3InitModule as (o: object) => ReturnType<typeof sqlite3InitModule>)({
    print: () => {},
    printErr: () => {},
  });
  const db = new sqlite3.oo1.DB(':memory:') as unknown as WasmDb;
  return wrapWasmDatabase(db, sqlite3 as never);
}

/** Every row of a module's tables (`<prefix>__*`), like dumpTables of @hub/sdk/testing. */
export function dumpWasmTables(db: SqlDatabase, prefix: string): Record<string, unknown[]> {
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).filter((t) => t.name.startsWith(`${prefix}__`));
  return Object.fromEntries(
    tables.map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()]),
  );
}

/** A request to the phone host as the page's transport sends it (JSON body), parsed like hub.request. */
export async function phoneRequest<T>(
  hub: {
    handle: (r: {
      method: string;
      url: string;
      body?: string | null;
      contentType?: string | null;
    }) => Promise<{ status: number; text: string }>;
  },
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const r = await hub.handle({
    method,
    url,
    body: body === undefined ? null : JSON.stringify(body),
    contentType: body === undefined ? null : 'application/json',
  });
  let parsed: unknown = r.text;
  try {
    parsed = r.text ? JSON.parse(r.text) : null;
  } catch {
    // Not JSON: the raw text.
  }
  return { status: r.status, body: parsed as T };
}

export { PhoneHub, UnavailableOnPhoneError } from '../phone/host';
