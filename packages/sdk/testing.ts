// Test helpers for modules and for the core: spin up a real hub (database,
// migrations, ctx services, HTTP routes) in a temporary folder.
// Only for tests — never import this from module runtime code.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BackendModule, MigrationDatabase } from './backend';
import { legacyUuid } from '../../backend/core/legacy-id';
import { createNullHost, type HostAdapter } from '../../backend/core/host';
import type { OAuthProvider } from '../../backend/core/accounts';
import type { DiscoveredModule, Hub } from '../../backend/core/hub';

export type { DiscoveredModule } from '../../backend/core/hub';
export type { HostKeyEvent } from '../../backend/core/host';
import { TOKEN_HEADER } from '../../backend/core/security';
import { buildServer } from '../../backend/server';
import type { FastifyInstance } from 'fastify';

/**
 * True in the full suite (`npm run test:full`, always run by the Windows CI):
 * tests that make complete renders (and the ones that use their files) run
 * only then, with `describe.runIf(fullRenderTests)` / `it.runIf(...)`.
 * `npm test` (fast tests) is what a work session runs.
 */
export const fullRenderTests = process.env.TOOLBOX_TEST_FULL === '1';

/**
 * The database a module's migration receives, on a bare better-sqlite3
 * database (migration tests): prefixed tables, `legacyId` with a fixed seed.
 */
export function migrationDatabaseFor(
  db: { exec(sql: string): unknown; prepare(sql: string): unknown },
  moduleId: string,
  seed = 'test-installation',
): MigrationDatabase {
  return {
    exec: (sql) => void db.exec(sql),
    prepare: (sql) => db.prepare(sql) as never,
    table: (name) => `${moduleId.replace(/-/g, '_')}__${name}`,
    legacyId: (kind, oldId) => legacyUuid(seed, kind, oldId),
  };
}

const TEST_TOKEN = 'test-token';
const TEST_PORT = 4321;

/** Host with a fake, reversible "encryption" so secret settings can be tested. */
export function createTestHost(overrides: Partial<HostAdapter> = {}): HostAdapter {
  return createNullHost({
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`enc:${text}`),
    decryptString: (buffer) => buffer.toString().replace(/^enc:/, ''),
    ...overrides,
  });
}

/** Reads a module folder like the build does (module.json + backend/index.ts). */
export async function loadModuleFolder(dir: string): Promise<DiscoveredModule> {
  const manifest: unknown = JSON.parse(readFileSync(path.join(dir, 'module.json'), 'utf8'));
  const backendFile = ['index.ts', 'index.js']
    .map((name) => path.join(dir, 'backend', name))
    .find((file) => existsSync(file));
  let backend: BackendModule | undefined;
  if (backendFile) {
    const imported = (await import(pathToFileURL(backendFile).href)) as { default: BackendModule };
    backend = imported.default;
  }
  return { folder: path.basename(dir), manifest, backend };
}

export interface TestResponse<T = unknown> {
  status: number;
  body: T;
}

export interface TestHub {
  app: FastifyInstance;
  hub: Hub;
  dataDir: string;
  /** Authenticated request to the hub API, e.g. request('GET', '/api/modules/x/items'). */
  request<T = unknown>(method: string, url: string, body?: unknown): Promise<TestResponse<T>>;
  /** Stops the hub; pass keepData to reopen the same folder with another createTestHub. */
  close(options?: { keepData?: boolean }): Promise<void>;
}

export async function createTestHub(options: {
  modules: DiscoveredModule[];
  dataDir?: string;
  host?: HostAdapter;
  loadExamples?: boolean;
  /** Defaults to the repository's modules/ folder. */
  assetsRoot?: string;
  /** OAuth endpoints of a mock server, e.g. { google: { tokenUrl, apiBase… } }. */
  accountProviders?: Record<string, Partial<OAuthProvider>>;
}): Promise<TestHub> {
  const dataDir = options.dataDir ?? mkdtempSync(path.join(tmpdir(), 'toolbox-test-'));
  const built = await buildServer({
    dataDir,
    token: TEST_TOKEN,
    appVersion: '0.0.0-test',
    host: options.host ?? createTestHost(),
    modules: options.modules,
    loadExamples: options.loadExamples ?? true,
    assetsRoot: options.assetsRoot ?? path.resolve(import.meta.dirname, '../../modules'),
    accountProviders: options.accountProviders,
  });
  built.setPort(TEST_PORT);

  return {
    app: built.app,
    hub: built.hub,
    dataDir,
    request: async <T>(method: string, url: string, body?: unknown) => {
      const response = await built.app.inject({
        method: method as 'GET',
        url,
        headers: { host: `127.0.0.1:${TEST_PORT}`, [TOKEN_HEADER]: TEST_TOKEN },
        ...(body === undefined ? {} : { payload: body as object }),
      });
      const text = response.body;
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // Non-JSON response: return the raw text.
      }
      return { status: response.statusCode, body: parsed as T };
    },
    close: async ({ keepData = false } = {}) => {
      await built.app.close();
      if (!keepData && !options.dataDir) rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Non-regression references (a module's answers written once by the code of
 * a known version, then compared): the same shape whatever the random ids
 * and the time zone. UUIDs become `#1`, `#2`… in order of appearance; UTC
 * timestamps (`…Z`) become milliseconds from `origin` (`+0ms`, `+1500000ms`), so a
 * frozen clock (`vi.useFakeTimers({ toFake: ['Date'], now })`) gives the
 * same reference on every machine. Local dates (`YYYY-MM-DD`) are kept.
 */
export function referenceShape(value: unknown, origin: number): unknown {
  const ids = new Map<string, string>();
  const text = JSON.stringify(value)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
      if (!ids.has(id)) ids.set(id, `#${ids.size + 1}`);
      return ids.get(id)!;
    })
    .replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g,
      (iso) => `+${Date.parse(iso) - origin}ms`,
    );
  return JSON.parse(text) as unknown;
}

/**
 * The reference stored in `file` (JSON). With `TOOLBOX_WRITE_REFERENCE=1`
 * (only on purpose, with the code of the reference version) `value` is
 * written there first.
 */
export function readReference(file: string, value: unknown): unknown {
  if (process.env.TOOLBOX_WRITE_REFERENCE === '1') {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

/** Every row of a module's tables (`<prefix>__*`), in insertion order: what the module stored. */
export { withoutSyncBookkeeping } from './testing-sync';
import { withoutSyncBookkeeping } from './testing-sync';

export function dumpTables(dataDir: string, prefix: string): Record<string, unknown[]> {
  const db = new Database(path.join(dataDir, 'hub.db'), { readonly: true });
  try {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[]
    ).filter((t) => t.name.startsWith(`${prefix}__`));
    return withoutSyncBookkeeping(
      Object.fromEntries(
        tables.map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()]),
      ),
    );
  } finally {
    db.close();
  }
}

/** The PC implementation of `ctx.images.normalise` (tests of a module's image options). */
export { normaliseImage } from '../../backend/core/images';

/** The phone's stack under Node (sqlite-wasm, phone host): see ./testing-phone.ts. */
export {
  dumpWasmTables,
  openWasmDatabase,
  phoneRequest,
  PhoneHub,
  UnavailableOnPhoneError,
  WorkerClient,
  workerTransport,
  MemoryFileStore,
} from './testing-phone';
