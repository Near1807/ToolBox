// Two devices for the synchronisation's tests: a PC (better-sqlite3, the real
// hub) and a phone (sqlite-wasm, the phone host), each with the 5 portable
// modules, and the exchange between them called directly (no network).
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  createTestHub,
  loadModuleFolder,
  MemoryFileStore,
  normaliseImage,
  openWasmDatabase,
  PhoneHub,
  phoneRequest,
  type TestHub,
} from '@hub/sdk/testing';
import type { SqlDatabase } from '../../packages/phone/database';
import {
  beginExchange,
  finishExchange,
  finishFirst,
  serveExchange,
  serveFirst,
  type FirstResponse,
} from '../../backend/core/sync/protocol';
import type { SyncEngine } from '../../backend/core/sync/engine';

export const MODULES = ['todo', 'ideas', 'sport', 'timer', 'courses'];
const ROOT = path.resolve(__dirname, '..', '..', 'modules');

export interface Devices {
  pc: TestHub;
  phone: PhoneHub;
  phoneDb: SqlDatabase;
  /** The phone's files (OPFS in the app, here in memory). */
  phoneFiles: MemoryFileStore;
  pcEngine: SyncEngine;
  phoneEngine: SyncEngine;
  /** A request on the PC's API (module routes). */
  onPc<T = unknown>(method: string, url: string, body?: unknown): Promise<T>;
  onPhone<T = unknown>(method: string, url: string, body?: unknown): Promise<T>;
  /** One synchronisation by hand (phone → PC → phone). */
  exchange(): ReturnType<typeof finishExchange>;
  /** The first synchronisation (both devices hold data). */
  first(mode: 'merge' | 'replace'): void;
  /** Every live and deleted row of the synchronised tables of a module, by id. */
  rows(device: 'pc' | 'phone', module: string): Record<string, Record<string, unknown>[]>;
  close(): Promise<void>;
}

export async function devices(): Promise<Devices> {
  const loaded = await Promise.all(MODULES.map((id) => loadModuleFolder(path.join(ROOT, id))));
  const pc = await createTestHub({ loadExamples: false, modules: loaded });
  const phoneDb = await openWasmDatabase();
  const phoneFiles = new MemoryFileStore();
  const phone = await PhoneHub.start({
    db: phoneDb,
    modules: loaded as never[],
    host: { files: phoneFiles, normaliseImage },
    log: () => {},
  });
  const pcEngine = pc.hub.sync;
  const phoneEngine = phone.sync;
  const ok = <T>(r: { status: number; body: T }, what: string) => {
    if (r.status >= 400) throw new Error(`${what} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const pcDb = () => new Database(path.join(pc.dataDir, 'hub.db'), { readonly: true });
  const rowsOf = (db: { prepare(sql: string): { all(): unknown[] } }, module: string) => {
    const out: Record<string, Record<string, unknown>[]> = {};
    const engine = pcEngine;
    for (const t of engine.tables(module))
      out[t] = db.prepare(`SELECT * FROM ${module}__${t} ORDER BY id`).all() as Record<
        string,
        unknown
      >[];
    return out;
  };
  return {
    pc,
    phone,
    phoneDb,
    phoneFiles,
    pcEngine,
    phoneEngine,
    onPc: async (method, url, body) =>
      ok(await pc.request(method, url, body), `PC ${method} ${url}`) as never,
    onPhone: async (method, url, body) =>
      ok(await phoneRequest(phone, method, url, body), `téléphone ${method} ${url}`) as never,
    exchange: () => {
      const request = JSON.parse(JSON.stringify(beginExchange(phoneEngine, pcEngine.device)));
      const response = JSON.parse(
        JSON.stringify(serveExchange(pcEngine, phoneEngine.device, request)),
      );
      return finishExchange(phoneEngine, pcEngine.device, response);
    },
    first: (mode) => {
      const snapshot = phoneEngine.snapshot();
      const response = JSON.parse(
        JSON.stringify(
          serveFirst(pcEngine, phoneEngine.device, {
            versions: phoneEngine.versions(),
            mode,
            snapshot: JSON.parse(JSON.stringify(snapshot)),
          }),
        ),
      ) as FirstResponse;
      finishFirst(phoneEngine, pcEngine.device, mode, snapshot.upTo, response);
    },
    rows: (device, module) => {
      if (device === 'phone') return rowsOf(phoneDb as never, module);
      const db = pcDb();
      try {
        return rowsOf(db, module);
      } finally {
        db.close();
      }
    },
    close: async () => {
      await phone.close();
      await pc.close();
    },
  };
}
