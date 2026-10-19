import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { Hub, type DiscoveredModule } from './core/hub';
import type { HostAdapter } from './core/host';
import { registerSecurity, StreamTicketStore } from './core/security';
import { registerCoreRoutes } from './routes/core';

export type { SystemInfo } from './routes/core';

export interface ServerOptions {
  /** Root of all user data (Electron's userData folder). Never the install folder. */
  dataDir: string;
  /** Per-session API token, shared with the UI through the preload script. */
  token: string;
  appVersion: string;
  host: HostAdapter;
  /** Modules discovered at build time (virtual:toolbox-modules). */
  modules: DiscoveredModule[];
  /** Also load example modules (folders starting with "_"). */
  loadExamples?: boolean;
  /** 0 = random free port (production). */
  port?: number;
  /** Built UI to serve at `/`; omitted in dev, where Vite serves the UI. */
  rendererDir?: string;
  /** Extra allowed origins, e.g. the Vite dev server. */
  extraOrigins?: string[];
  echoLogs?: boolean;
}

export interface BuiltServer {
  app: FastifyInstance;
  hub: Hub;
  setPort(port: number): void;
}

export interface RunningServer extends BuiltServer {
  /** Base URL, e.g. http://127.0.0.1:53124 */
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Builds the hub and the Fastify app without listening (tests use inject()). */
export async function buildServer(options: ServerOptions): Promise<BuiltServer> {
  const hub = await Hub.create({
    dataDir: options.dataDir,
    host: options.host,
    appVersion: options.appVersion,
    modules: options.modules,
    loadExamples: options.loadExamples,
    echoLogs: options.echoLogs,
  });
  let port = options.port ?? 0;

  // forceCloseConnections: open SSE streams must not block shutdown.
  const app = Fastify({ logger: false, forceCloseConnections: true });

  registerSecurity(app, {
    token: options.token,
    tickets: new StreamTicketStore(),
    getPort: () => port,
    extraOrigins: options.extraOrigins,
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) hub.logger.error(`Erreur sur ${request.method} ${request.url}`, error);
    void reply.code(status).send({ error: error.message });
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  registerCoreRoutes(app, hub, options.appVersion);
  hub.mountRoutes(app);

  if (options.rendererDir) {
    void app.register(fastifyStatic, { root: options.rendererDir });
  }

  app.addHook('onClose', async () => hub.stop());
  await app.ready();
  hub.start();

  return { app, hub, setPort: (value) => (port = value) };
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const built = await buildServer(options);
  await built.app.listen({ host: '127.0.0.1', port: options.port ?? 0 });
  const address = built.app.server.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
  built.setPort(port);
  return { ...built, port, url: `http://127.0.0.1:${port}`, close: () => built.app.close() };
}
