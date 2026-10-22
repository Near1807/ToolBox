// Test helpers for modules and for the core: spin up a real hub (database,
// migrations, ctx services, HTTP routes) in a temporary folder.
// Only for tests — never import this from module runtime code.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BackendModule } from './backend';
import { createNullHost, type HostAdapter } from '../../backend/core/host';
import type { OAuthProvider } from '../../backend/core/accounts';
import type { DiscoveredModule, Hub } from '../../backend/core/hub';

export type { DiscoveredModule } from '../../backend/core/hub';
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
