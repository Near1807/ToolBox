import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Header carrying the per-session API token. */
export const TOKEN_HEADER = 'x-toolbox-token';

/** Routes reachable without any token (liveness probe only). */
const PUBLIC_API_ROUTES = new Set(['/api/health']);

const TICKET_TTL_MS = 30_000;

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Set to true on GET routes consumed with `EventSource` (SSE). EventSource
     * cannot send custom headers, so these routes also accept a single-use
     * `?ticket=` obtained from POST /api/core/stream-tickets.
     */
    streamTicket?: boolean;
  }
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Short-lived, single-use tickets that stand in for the token on SSE routes. */
export class StreamTicketStore {
  private readonly tickets = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(): string {
    this.prune();
    const ticket = randomBytes(24).toString('hex');
    this.tickets.set(ticket, this.now() + TICKET_TTL_MS);
    return ticket;
  }

  /** Returns true once per valid ticket; the ticket is then destroyed. */
  consume(ticket: string): boolean {
    const expiresAt = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return expiresAt !== undefined && expiresAt >= this.now();
  }

  private prune(): void {
    const now = this.now();
    for (const [ticket, expiresAt] of this.tickets) {
      if (expiresAt < now) this.tickets.delete(ticket);
    }
  }
}

export interface SecurityOptions {
  token: string;
  tickets: StreamTicketStore;
  /** Returns the port the server listens on (known only after listen()). */
  getPort: () => number;
  /** Extra origins allowed to call the API (the Vite dev server in dev). */
  extraOrigins?: string[];
}

/**
 * Protects the local API against other local processes and, above all,
 * against web pages open in the user's browser:
 * - Host header check (DNS rebinding),
 * - Origin / Sec-Fetch-Site check (CSRF),
 * - per-session token on every /api route (or a single-use ticket on SSE routes).
 * No CORS headers are ever sent: the UI is always same-origin.
 */
export function registerSecurity(app: FastifyInstance, options: SecurityOptions): void {
  const { token, tickets, getPort, extraOrigins = [] } = options;

  const deny = (reply: FastifyReply, status: number, message: string) =>
    reply.code(status).send({ error: message });

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const port = getPort();
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(request.headers.host ?? '')) {
      return deny(reply, 403, 'Host non autorisé');
    }

    const origin = request.headers.origin;
    const allowedOrigins = [...allowedHosts.map((h) => `http://${h}`), ...extraOrigins];
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      return deny(reply, 403, 'Origine non autorisée');
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      return deny(reply, 403, 'Requête inter-sites refusée');
    }

    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || PUBLIC_API_ROUTES.has(path)) return;

    const header = request.headers[TOKEN_HEADER];
    if (typeof header === 'string' && safeEqual(header, token)) return;

    const query = request.query as Record<string, unknown> | undefined;
    const ticket = typeof query?.ticket === 'string' ? query.ticket : undefined;
    if (
      request.method === 'GET' &&
      request.routeOptions.config.streamTicket === true &&
      ticket !== undefined &&
      tickets.consume(ticket)
    ) {
      return;
    }

    return deny(reply, 401, 'Jeton de session manquant ou invalide');
  });

  app.post('/api/core/stream-tickets', async () => ({ ticket: tickets.issue() }));
}
