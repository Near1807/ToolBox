// The app's Worker (ADR 0044): SQLite WebAssembly on OPFS (VFS opfs-sahpool,
// tested on the S21 by the probe app), the phone host, and the modules'
// server code unchanged. It answers the page's calls (packages/phone/transport.ts):
// API requests, state of the base, copy and restore for the safety net.
// No fallback: when OPFS is missing, every call says so.
// A base that holds something is never migrated before the page has copied
// it (« avant-migration »): the hub then waits for the call « migrate ».
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapWasmDatabase, type SqlDatabase, type WasmDb } from '../../../packages/phone/database';
import { PhoneHub } from '../../../packages/phone/host';
import type { WorkerCall, WorkerEnvelope, WorkerReply } from '../../../packages/phone/transport';
import { countBase, needsCopyBeforeMigration } from '../../../packages/phone/backup';
import { SERVER_MODULES } from './server-modules';

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
  /** null while the migrations wait for the copy « avant-migration ». */
  hub: PhoneHub | null;
  /** The base file did not exist in OPFS before this start. */
  absent: boolean;
  /** Migrations waiting for that copy (empty once the hub runs). */
  pending: { scope: string; count: number }[];
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
  const pending = PhoneHub.pendingMigrations(db, SERVER_MODULES);
  open = { sqlite3, pool, raw, db, hub: null, absent, pending };
  if (!needsCopyBeforeMigration({ absent, rows: countBase(db).rows }, pending.length))
    await runHub(open);
}

async function runHub(o: Open): Promise<void> {
  o.hub = await PhoneHub.start({ db: o.db, modules: SERVER_MODULES });
  o.pending = [];
}

const ready = start().catch((error: unknown) => {
  failure =
    `La base du téléphone n’a pas pu s’ouvrir (OPFS) : ` +
    (error instanceof Error ? error.message : String(error));
});

async function answer(call: WorkerCall): Promise<unknown> {
  await ready;
  if (!open) throw new Error(failure ?? 'La base du téléphone n’est pas ouverte.');
  switch (call.kind) {
    case 'request':
      if (!open.hub) throw new Error('La mise à jour des données attend sa copie de sauvegarde.');
      return open.hub.handle(call.request);
    case 'status':
      return {
        absent: open.absent,
        ...countBase(open.db),
        pending: open.pending,
        modules: open.hub?.modules() ?? [],
        sqlite: open.sqlite3.version.libVersion,
        vfs: open.pool.vfsName,
      };
    case 'snapshot':
      // Between two calls no transaction is open: the file is consistent.
      return { bytes: open.pool.exportFile(FILE), ...countBase(open.db) };
    case 'migrate':
      // After the copy « avant-migration » (the page took it), or nothing pending.
      if (!open.hub) await runHub(open);
      return { ok: true };
    case 'restore': {
      // Only after the user's confirmation on the page (never automatic).
      await open.hub?.close();
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
