import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AccountError,
  HttpError,
  type ModuleLogger,
  type ModuleRoutes,
  type RouteHandler,
  type RouteOptions,
} from '../../../packages/sdk/backend';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDefinition {
  method: Method;
  path: string;
  handler: RouteHandler;
  options: RouteOptions;
}

/** Collects a module's routes during register(); they are mounted only if it succeeds. */
export function createRouteCollector(): { api: ModuleRoutes; routes: RouteDefinition[] } {
  const routes: RouteDefinition[] = [];
  const add =
    (method: Method) =>
    (path: string, handler: RouteHandler, options: RouteOptions = {}): void => {
      if (!path.startsWith('/'))
        throw new Error(`Chemin de route invalide « ${path} » (doit commencer par /)`);
      routes.push({ method, path, handler, options });
    };
  return {
    routes,
    api: {
      get: add('GET'),
      post: add('POST'),
      put: add('PUT'),
      patch: add('PATCH'),
      delete: add('DELETE'),
    },
  };
}

/**
 * Mounts a module's routes under /api/modules/<id>/. Every handler is wrapped:
 * an HttpError becomes a clean JSON error, anything else is logged and
 * answered with 500 — a crashing route never affects the rest of the hub.
 */
export function mountModuleRoutes(
  app: FastifyInstance,
  moduleId: string,
  moduleName: string,
  routes: RouteDefinition[],
  logger: ModuleLogger,
): void {
  void app.register(
    async (instance) => {
      for (const route of routes) {
        instance.route({
          method: route.method,
          url: route.path,
          bodyLimit: route.options.bodyLimit,
          config: { streamTicket: route.options.streamTicket === true },
          handler: async (request: FastifyRequest, reply: FastifyReply) => {
            try {
              return await route.handler(request, reply);
            } catch (error) {
              if (error instanceof HttpError) {
                return reply.code(error.statusCode).send({ error: error.message });
              }
              // Account not configured, not connected, expired…: a clear message, not a crash.
              if (error instanceof AccountError) {
                return reply.code(409).send({ error: error.message, account: error.code });
              }
              logger.error(`Erreur sur ${route.method} ${route.path}`, error);
              const message = error instanceof Error ? error.message : String(error);
              return reply.code(500).send({ error: `Erreur dans « ${moduleName} » : ${message}` });
            }
          },
        });
      }
    },
    { prefix: `/api/modules/${moduleId}` },
  );
}
