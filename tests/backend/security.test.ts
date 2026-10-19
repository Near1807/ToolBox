import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerSecurity, StreamTicketStore, TOKEN_HEADER } from '../../backend/core/security';

const TOKEN = 'a'.repeat(64);
const PORT = 4000;
const HOST = `127.0.0.1:${PORT}`;

function buildApp(tickets = new StreamTicketStore()) {
  const app = Fastify();
  registerSecurity(app, {
    token: TOKEN,
    tickets,
    getPort: () => PORT,
    extraOrigins: ['http://localhost:5173'],
  });
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/private', async () => ({ secret: true }));
  app.get('/api/stream', { config: { streamTicket: true } }, async () => ({ streaming: true }));
  app.get('/index.html', async () => 'ui');
  return app;
}

describe('registerSecurity', () => {
  let app = buildApp();
  afterEach(async () => {
    await app.close();
    app = buildApp();
  });

  it('serves the health route without a token', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host: HOST } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects API calls without a token', async () => {
    const res = await app.inject({ url: '/api/private', headers: { host: HOST } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const res = await app.inject({
      url: '/api/private',
      headers: { host: HOST, [TOKEN_HEADER]: 'b'.repeat(64) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts the session token', async () => {
    const res = await app.inject({
      url: '/api/private',
      headers: { host: HOST, [TOKEN_HEADER]: TOKEN },
    });
    expect(res.statusCode).toBe(200);
  });

  it('does not require a token for the static UI', async () => {
    const res = await app.inject({ url: '/index.html', headers: { host: HOST } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const res = await app.inject({
      url: '/api/private',
      headers: { host: `evil.example:${PORT}`, [TOKEN_HEADER]: TOKEN },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects foreign origins and cross-site requests (CSRF)', async () => {
    const foreign = await app.inject({
      url: '/api/private',
      headers: { host: HOST, origin: 'https://evil.example', [TOKEN_HEADER]: TOKEN },
    });
    expect(foreign.statusCode).toBe(403);

    const crossSite = await app.inject({
      url: '/api/private',
      headers: { host: HOST, 'sec-fetch-site': 'cross-site', [TOKEN_HEADER]: TOKEN },
    });
    expect(crossSite.statusCode).toBe(403);
  });

  it('accepts same-origin and configured dev origins', async () => {
    for (const origin of [`http://${HOST}`, 'http://localhost:5173']) {
      const res = await app.inject({
        url: '/api/private',
        headers: { host: HOST, origin, [TOKEN_HEADER]: TOKEN },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('lets SSE routes use a single-use ticket instead of the header', async () => {
    const issued = await app.inject({
      method: 'POST',
      url: '/api/core/stream-tickets',
      headers: { host: HOST, [TOKEN_HEADER]: TOKEN },
    });
    const { ticket } = issued.json<{ ticket: string }>();

    const first = await app.inject({
      url: `/api/stream?ticket=${ticket}`,
      headers: { host: HOST },
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      url: `/api/stream?ticket=${ticket}`,
      headers: { host: HOST },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('refuses tickets on routes not flagged for streaming', async () => {
    const tickets = new StreamTicketStore();
    await app.close();
    app = buildApp(tickets);
    const res = await app.inject({
      url: `/api/private?ticket=${tickets.issue()}`,
      headers: { host: HOST },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('StreamTicketStore', () => {
  it('expires tickets after 30 seconds', () => {
    let now = 1_000;
    const store = new StreamTicketStore(() => now);
    const ticket = store.issue();
    now += 31_000;
    expect(store.consume(ticket)).toBe(false);
  });

  it('rejects unknown tickets', () => {
    expect(new StreamTicketStore().consume('nope')).toBe(false);
  });
});
