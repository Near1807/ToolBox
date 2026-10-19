import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { openDatabase, getSqliteVersion, type SqliteDatabase } from './core/database';
import { getBinaryVersion, getFfmpegPath, getFfprobePath } from './core/ffmpeg-binaries';
import type { HostAdapter } from './core/host';
import { registerSecurity, StreamTicketStore } from './core/security';

export interface ServerOptions {
  /** Root of all user data (Electron's userData folder). Never the install folder. */
  dataDir: string;
  /** Per-session API token, shared with the UI through the preload script. */
  token: string;
  appVersion: string;
  host: HostAdapter;
  /** 0 = random free port (production). */
  port?: number;
  /** Built UI to serve at `/`; omitted in dev, where Vite serves the UI. */
  rendererDir?: string;
  /** Extra allowed origins, e.g. the Vite dev server. */
  extraOrigins?: string[];
  logger?: boolean;
}

export interface RunningServer {
  app: FastifyInstance;
  db: SqliteDatabase;
  /** Base URL, e.g. http://127.0.0.1:53124 */
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface SystemInfo {
  appVersion: string;
  dataDir: string;
  sqliteVersion: string;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
  runtime: { node: string; electron: string | null; platform: string; arch: string };
}

/** Builds the Fastify app without listening (used directly by tests via inject()). */
export function buildServer(options: ServerOptions): {
  app: FastifyInstance;
  db: SqliteDatabase;
  setPort(port: number): void;
} {
  mkdirSync(options.dataDir, { recursive: true });
  const db = openDatabase(path.join(options.dataDir, 'hub.db'));
  let port = options.port ?? 0;

  const app = Fastify({ logger: options.logger ?? false });

  registerSecurity(app, {
    token: options.token,
    tickets: new StreamTicketStore(),
    getPort: () => port,
    extraOrigins: options.extraOrigins,
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/core/system', async (): Promise<SystemInfo> => {
    const [ffmpegVersion, ffprobeVersion] = await Promise.all([
      getBinaryVersion(getFfmpegPath()),
      getBinaryVersion(getFfprobePath()),
    ]);
    return {
      appVersion: options.appVersion,
      dataDir: options.dataDir,
      sqliteVersion: getSqliteVersion(db),
      ffmpegVersion,
      ffprobeVersion,
      runtime: {
        node: process.versions.node,
        electron: process.versions.electron ?? null,
        platform: process.platform,
        arch: process.arch,
      },
    };
  });

  app.post('/api/core/open-data-dir', async () => {
    await options.host.openPath(options.dataDir);
    return { ok: true };
  });

  if (options.rendererDir) {
    app.register(fastifyStatic, { root: options.rendererDir });
  }

  app.addHook('onClose', async () => db.close());

  return { app, db, setPort: (value) => (port = value) };
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { app, db, setPort } = buildServer(options);
  await app.listen({ host: '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
  setPort(port);
  return { app, db, port, url: `http://127.0.0.1:${port}`, close: () => app.close() };
}
