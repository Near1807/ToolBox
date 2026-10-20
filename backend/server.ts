import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { Hub, type DiscoveredModule, type HubOptions } from './core/hub';
import type { HostAdapter } from './core/host';
import { MEDIA_PREFIX } from './core/media';
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
  /** Folder containing `<module folder>/assets/` (see HubOptions.assetsRoot). */
  assetsRoot: string;
  /** 0 = random free port (production). */
  port?: number;
  /** Built UI to serve at `/`; omitted in dev, where Vite serves the UI. */
  rendererDir?: string;
  /** Extra allowed origins, e.g. the Vite dev server. */
  extraOrigins?: string[];
  echoLogs?: boolean;
  /** Endpoint overrides of the OAuth providers (tests). */
  accountProviders?: HubOptions['accountProviders'];
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
    assetsRoot: options.assetsRoot,
    accountProviders: options.accountProviders,
  });
  let port = options.port ?? 0;

  // forceCloseConnections: open SSE streams must not block shutdown.
  // maxParamLength: media tokens encode a full file path (backend/core/media.ts).
  const app = Fastify({ logger: false, forceCloseConnections: true, maxParamLength: 4096 });

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

  // Serves the UI (production) and provides reply.sendFile() for media files.
  void app.register(fastifyStatic, {
    root: options.rendererDir ?? options.dataDir,
    serve: Boolean(options.rendererDir),
  });

  app.get<{ Params: { token: string; name: string } }>(
    `${MEDIA_PREFIX}:token/:name`,
    async (request, reply) => {
      const filePath = hub.media.resolve(request.params.token);
      if (!filePath || !existsSync(filePath)) {
        return reply.code(404).send({ error: 'Fichier introuvable' });
      }
      return reply.sendFile(path.basename(filePath), path.dirname(filePath));
    },
  );

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
