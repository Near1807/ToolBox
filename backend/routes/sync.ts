// /api/core/sync/* : what the PC's Réglages show and do for the
// synchronisation with the phone (ADR 0044). Same protection as every core
// route (the session token): only the PC's own interface reaches them.
import type { FastifyInstance } from 'fastify';
import type { Hub } from '../core/hub';
import { SyncError } from '../core/sync/engine';
import type { SyncServer } from '../core/sync/server';

export function registerSyncRoutes(
  app: FastifyInstance,
  hub: Hub,
  sync: SyncServer,
  token: string,
): void {
  const fail = (reply: { code(n: number): { send(b: unknown): unknown } }, error: unknown) => {
    if (error instanceof SyncError) return reply.code(400).send({ error: error.message });
    throw error;
  };

  app.get('/api/core/sync', async () => sync.status());

  /** Turns the listener on or off (the page asks for the confirmation first). */
  app.put<{ Body: { enabled?: boolean; port?: number } }>(
    '/api/core/sync',
    async (request, reply) => {
      try {
        return await sync.setEnabled(request.body?.enabled === true, request.body?.port);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.post<{ Body: { address?: string } }>('/api/core/sync/pairing', async (request, reply) => {
    try {
      return sync.newPairing(request.body?.address);
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** « QR de l'adresse » : address + port + fingerprint, no token (a paired phone on another Wi-Fi). */
  app.post<{ Body: { address?: string } }>(
    '/api/core/sync/address-code',
    async (request, reply) => {
      try {
        return sync.addressCode(request.body?.address);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/core/sync/peers/:id', async (request) => {
    sync.forget(request.params.id);
    return sync.status();
  });

  app.get('/api/core/sync/conflicts', async () => ({
    conflicts: hub.sync.conflicts(true).slice(0, 300),
  }));

  /** « Vu » : the conflict leaves the list (nothing changes in the data). */
  app.post<{ Params: { id: string } }>('/api/core/sync/conflicts/:id/dismiss', async (request) => {
    hub.sync.resolveConflict(request.params.id, 'vu');
    return { ok: true };
  });

  /** « Fusionner » two same names: the module's own merge (the second goes into the first). */
  app.post<{ Params: { id: string } }>(
    '/api/core/sync/conflicts/:id/merge',
    async (request, reply) => {
      const conflict = hub.sync.conflict(request.params.id);
      const merge = conflict && hub.sync.mergeFor(conflict);
      if (!conflict || !merge)
        return reply.code(400).send({ error: 'Rien à fusionner pour ce conflit' });
      const response = await app.inject({
        method: 'POST',
        url: `/api/modules/${merge.scope}${merge.route}`,
        payload: merge.body as object,
        headers: { 'x-toolbox-token': token, host: '127.0.0.1' },
      });
      if (response.statusCode >= 400) return reply.code(response.statusCode).send(response.json());
      hub.sync.resolveConflict(conflict.id, 'fusionné');
      return { ok: true };
    },
  );
}
