// The phone's mini router (ADR 0044): the modules' routes (ctx.routes) served
// inside the Worker, with the answers Fastify gives on the PC — same paths
// (`/api/modules/<id>/…`, `:params`), same query and body parsing, same
// errors (HttpError → { error }, AccountError → 409, anything else → 500
// « Erreur dans « Module » : … », unknown route → Fastify's 404, bad JSON →
// 400). Portable: no Node import.
import {
  AccountError,
  HttpError,
  type ModuleLogger,
  type ModuleRoutes,
  type RouteHandler,
  type RouteOptions,
  type RouteReply,
  type RouteRequest,
} from '../sdk/core';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A request as the page's transport sends it. */
export interface PhoneRequest {
  method: string;
  /** Path and query string: `/api/modules/todo/tasks?x=1`. */
  url: string;
  /** The raw body (JSON text) or nothing. */
  body?: string | null;
  contentType?: string | null;
}

/** The answer: an HTTP status and the JSON text (empty when the handler returned nothing). */
export interface PhoneResponse {
  status: number;
  text: string;
}

interface Route {
  method: Method;
  segments: string[];
  handler: RouteHandler;
  options: RouteOptions;
  moduleId: string;
  moduleName: string;
  logger: ModuleLogger;
}

/** Fastify's default body limit (1 MiB). */
const DEFAULT_BODY_LIMIT = 1024 * 1024;

const json = (status: number, body: unknown): PhoneResponse => ({
  status,
  text: JSON.stringify(body),
});

/** Fastify's querystring: decoded values, a repeated key becomes an array. */
function parseQuery(search: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const before = out[key];
    if (before === undefined) out[key] = value;
    else out[key] = Array.isArray(before) ? [...before, value] : [before, value];
  }
  return out;
}

export class PhoneRouter {
  private readonly routes: Route[] = [];
  private readonly core = new Map<
    string,
    (query: Record<string, unknown>) => Promise<PhoneResponse>
  >();

  /** The `ctx.routes` of a module: its routes under /api/modules/<id>/. */
  forModule(moduleId: string, moduleName: string, logger: ModuleLogger) {
    const collected: Route[] = [];
    const add =
      (method: Method) =>
      (path: string, handler: RouteHandler, options: RouteOptions = {}): void => {
        if (!path.startsWith('/'))
          throw new Error(`Chemin de route invalide « ${path} » (doit commencer par /)`);
        collected.push({
          method,
          segments: `/api/modules/${moduleId}${path}`.split('/').slice(1),
          handler,
          options,
          moduleId,
          moduleName,
          logger,
        });
      };
    const api: ModuleRoutes = {
      get: add('GET'),
      post: add('POST'),
      put: add('PUT'),
      patch: add('PATCH'),
      delete: add('DELETE'),
    };
    // Mounted only once register() succeeded (like the PC).
    return { api, mount: () => this.routes.push(...collected) };
  }

  /**
   * A route of the core with the modules' parsing and errors (body, params,
   * HttpError → { error }): e.g. PUT `/api/core/settings/:scope`.
   */
  coreRoute(method: Method, path: string, handler: RouteHandler, logger: ModuleLogger) {
    this.routes.push({
      method,
      segments: path.split('/').slice(1),
      handler,
      options: {},
      moduleId: 'core',
      moduleName: 'ToolBox',
      logger,
    });
  }

  /** A route of the core (GET only): `/api/core/calendar`. */
  coreGet(path: string, handler: (query: Record<string, unknown>) => Promise<PhoneResponse>) {
    this.core.set(path, handler);
  }

  private match(method: string, path: string) {
    const parts = path.split('/').slice(1);
    let best: { route: Route; params: Record<string, string>; dynamic: number } | null = null;
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let dynamic = 0;
      const ok = route.segments.every((segment, i) => {
        const part = parts[i]!;
        if (segment.startsWith(':')) {
          if (part === '') return false;
          params[segment.slice(1)] = decodeURIComponent(part);
          dynamic++;
          return true;
        }
        return segment === part;
      });
      // A static segment wins over a parameter (find-my-way).
      if (ok && (!best || dynamic < best.dynamic)) best = { route, params, dynamic };
    }
    return best;
  }

  async handle(request: PhoneRequest): Promise<PhoneResponse> {
    const method = request.method.toUpperCase();
    const q = request.url.indexOf('?');
    const path = q < 0 ? request.url : request.url.slice(0, q);
    const query = parseQuery(q < 0 ? '' : request.url.slice(q + 1));
    const notFound = () =>
      json(404, {
        message: `Route ${method}:${request.url} not found`,
        error: 'Not Found',
        statusCode: 404,
      });

    const core = method === 'GET' ? this.core.get(path) : undefined;
    if (core) return core(query);
    const found = this.match(method, path);
    if (!found) return notFound();
    const { route, params } = found;

    // Body: JSON only (the page's transport always sends JSON), like Fastify.
    let body: unknown = undefined;
    const raw = request.body ?? '';
    if (raw !== '' || request.contentType) {
      const type = (request.contentType ?? '').split(';')[0]!.trim().toLowerCase();
      if (type !== 'application/json') return json(415, { error: 'Unsupported Media Type' });
      if (new TextEncoder().encode(raw).length > (route.options.bodyLimit ?? DEFAULT_BODY_LIMIT))
        return json(413, { error: 'Request body is too large' });
      if (raw === '')
        return json(400, {
          error: "Body cannot be empty when content-type is set to 'application/json'",
        });
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, {
          error: "Body is not valid JSON but content-type is set to 'application/json'",
        });
      }
    }

    const req: RouteRequest = { params, query, body, raw: { on: () => undefined } };
    const reply: RouteReply = {
      hijack: () => {
        throw new Error('Flux d’événements non disponible sur le téléphone');
      },
      raw: {
        writeHead: () => undefined,
        write: () => undefined,
        end: () => undefined,
      },
    };
    try {
      const result = await route.handler(req, reply);
      return { status: 200, text: result === undefined ? '' : JSON.stringify(result) };
    } catch (error) {
      if (error instanceof HttpError) return json(error.statusCode, { error: error.message });
      if (error instanceof AccountError)
        return json(409, { error: error.message, account: error.code });
      const routePath = `/${route.segments.slice(3).join('/')}`;
      route.logger.error(`Erreur sur ${route.method} ${routePath}`, error);
      const message = error instanceof Error ? error.message : String(error);
      return json(500, { error: `Erreur dans « ${route.moduleName} » : ${message}` });
    }
  }
}
