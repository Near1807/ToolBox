// The app's Worker (ADR 0044): SQLite WebAssembly on OPFS (VFS opfs-sahpool,
// tested on the S21 by the probe app), the phone host, and the modules'
// server code unchanged. It answers the page's calls (packages/phone/transport.ts):
// API requests, state of the base, copy and restore for the safety net.
// No fallback: when OPFS is missing, every call says so.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import todoBackend from '../../../modules/todo/backend/index';
import todoManifest from '../../../modules/todo/module.json';
import type { ModuleManifest } from '@hub/sdk/core';
import { wrapWasmDatabase, type SqlDatabase, type WasmDb } from '../../../packages/phone/database';
import { PhoneHub } from '../../../packages/phone/host';
import type { WorkerCall, WorkerEnvelope, WorkerReply } from '../../../packages/phone/transport';

/** The base: one file in the pool of the app (its name never changes). */
const POOL = 'toolbox';
const FILE = '/toolbox.sqlite3';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Pool = Awaited<ReturnType<Sqlite3['installOpfsSAHPoolVfs']>>;

interface Open {
  sqlite3: Sqlite3;
  pool: Pool;
  raw: { close(): void };
  db: SqlDatabase;
  hub: PhoneHub;
  /** The base file did not exist in OPFS before this start. */
  absent: boolean;
}

let open: Open | null = null;
let failure: string | null = null;
let sqlite3: Sqlite3 | null = null;
let pool: Pool | null = null;

async function start(): Promise<void> {
  sqlite3 ??= await (sqlite3InitModule as (o: object) => Promise<Sqlite3>)({
    print: () => {},
    printErr: () => {},
  });
  pool ??= await sqlite3.installOpfsSAHPoolVfs({ name: POOL, initialCapacity: 6 });
  const absent = !pool.getFileNames().includes(FILE);
  const raw = new pool.OpfsSAHPoolDb(FILE);
  const db = wrapWasmDatabase(raw as unknown as WasmDb, sqlite3 as never);
  db.exec('PRAGMA foreign_keys = ON');
  const hub = await PhoneHub.start({
    db,
    modules: [{ manifest: todoManifest as ModuleManifest, backend: todoBackend }],
  });
  open = { sqlite3, pool, raw, db, hub, absent };
}

const ready = start().catch((error: unknown) => {
  failure =
    `La base du téléphone n’a pas pu s’ouvrir (OPFS) : ` +
    (error instanceof Error ? error.message : String(error));
});

/** All rows of the modules' tables (0: an empty base), and the To-do's tasks. */
function counts(db: SqlDatabase) {
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as {
      name: string;
    }[]
  ).filter((t) => !t.name.startsWith('core__'));
  let rows = 0;
  for (const t of tables)
    rows += (db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number }).n;
  const tasks = (
    db.prepare('SELECT COUNT(*) AS n FROM todo__tasks WHERE deleted_at IS NULL').get() as {
      n: number;
    }
  ).n;
  return { rows, tasks };
}

async function answer(call: WorkerCall): Promise<unknown> {
  await ready;
  if (!open) throw new Error(failure ?? 'La base du téléphone n’est pas ouverte.');
  switch (call.kind) {
    case 'request':
      return open.hub.handle(call.request);
    case 'status':
      return {
        absent: open.absent,
        ...counts(open.db),
        modules: open.hub.modules(),
        sqlite: open.sqlite3.version.libVersion,
        vfs: open.pool.vfsName,
      };
    case 'snapshot':
      // Between two calls no transaction is open: the file is consistent.
      return { bytes: open.pool.exportFile(FILE), ...counts(open.db) };
    case 'restore': {
      // Only after the user's confirmation on the page (never automatic).
      await open.hub.close();
      open.raw.close();
      open = null;
      await pool!.importDb(FILE, call.bytes);
      await start();
      return { ok: true };
    }
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerEnvelope>) => {
  const { id, call } = event.data;
  answer(call).then(
    (result) => self.postMessage({ id, ok: true, result } satisfies WorkerReply),
    (error: unknown) =>
      self.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies WorkerReply),
  );
});
