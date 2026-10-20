import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AccountError, openEventStream, type JobInfo } from '../../packages/sdk/backend';
import { listAutomaticBackups } from '../core/backups';
import { getSqliteVersion } from '../core/database';
import { exportBackupZip } from '../core/export';
import { getBinaryVersion, getFfmpegPath, getFfprobePath } from '../core/ffmpeg-binaries';
import type { Hub } from '../core/hub';
import { JOB_UPDATED_EVENT } from '../core/jobs';
import type { LogLevel } from '../core/logger';
import { SettingsValidationError } from '../core/settings';

export interface SystemInfo {
  appVersion: string;
  dataDir: string;
  sqliteVersion: string;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
  runtime: { node: string; electron: string | null; platform: string; arch: string };
}

/** Generic hub API: /api/core/*. Knows nothing about any particular module. */
export function registerCoreRoutes(app: FastifyInstance, hub: Hub, appVersion: string): void {
  app.get('/api/core/system', async (): Promise<SystemInfo> => {
    const [ffmpegVersion, ffprobeVersion] = await Promise.all([
      getBinaryVersion(getFfmpegPath()),
      getBinaryVersion(getFfprobePath()),
    ]);
    return {
      appVersion,
      dataDir: hub.dataDir,
      sqliteVersion: getSqliteVersion(hub.handle.db),
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
    await hub.host.openPath(hub.dataDir);
    return { ok: true };
  });

  app.post('/api/core/restart', async () => {
    setTimeout(() => hub.host.relaunch(), 200);
    return { ok: true };
  });

  // Modules ---------------------------------------------------------------

  app.get('/api/core/modules', async () => hub.moduleInfos());

  app.put<{ Params: { id: string }; Body: { enabled?: unknown } }>(
    '/api/core/modules/:id/enabled',
    async (request, reply) => {
      const { id } = request.params;
      if (!hub.hasModule(id)) return reply.code(404).send({ error: `Module « ${id} » inconnu` });
      if (typeof request.body?.enabled !== 'boolean') {
        return reply.code(400).send({ error: 'Champ « enabled » (booléen) attendu' });
      }
      hub.setModuleEnabled(id, request.body.enabled, 'Désactivé dans les réglages');
      return { ok: true, restartRequired: true };
    },
  );

  // Connected accounts (ctx.accounts) ------------------------------------

  app.get('/api/core/accounts', async () => hub.accounts.describe());

  // Reconnect with the scopes already granted (e.g. after an expired authorization).
  app.post<{ Params: { provider: string } }>(
    '/api/core/accounts/:provider/reconnect',
    async (request, reply) => {
      try {
        const status = hub.accounts.status(request.params.provider);
        return await hub.accounts.connect(request.params.provider, status.scopes);
      } catch (error) {
        if (error instanceof AccountError) return reply.code(400).send({ error: error.message });
        throw error;
      }
    },
  );

  app.delete<{ Params: { provider: string } }>(
    '/api/core/accounts/:provider',
    async (request, reply) => {
      try {
        await hub.accounts.disconnect(request.params.provider);
        return { ok: true };
      } catch (error) {
        if (error instanceof AccountError) return reply.code(400).send({ error: error.message });
        throw error;
      }
    },
  );

  // Settings --------------------------------------------------------------

  app.get('/api/core/settings', async () => hub.settings.describe());

  app.put<{ Params: { scope: string }; Body: Record<string, unknown> }>(
    '/api/core/settings/:scope',
    async (request, reply) => {
      try {
        hub.settings.update(request.params.scope, request.body ?? {});
        return { ok: true };
      } catch (error) {
        if (error instanceof SettingsValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Body: { title?: string; defaultPath?: string } }>(
    '/api/core/dialogs/select-folder',
    async (request) => {
      const folder = await hub.host.selectFolder({
        title: request.body?.title ?? 'Choisir un dossier',
        defaultPath: request.body?.defaultPath,
      });
      return { folder };
    },
  );

  app.post<{
    Body: {
      title?: string;
      filters?: { name: string; extensions: string[] }[];
      multiple?: boolean;
    };
  }>('/api/core/dialogs/select-files', async (request) => {
    const files = await hub.host.selectFiles({
      title: request.body?.title ?? 'Choisir des fichiers',
      filters: request.body?.filters,
      multiple: request.body?.multiple,
    });
    return { files };
  });

  // Jobs ------------------------------------------------------------------

  app.get<{ Querystring: { module?: string } }>('/api/core/jobs', async (request) =>
    hub.jobs.list({ moduleId: request.query.module }),
  );

  app.post<{ Params: { id: string } }>('/api/core/jobs/:id/cancel', async (request, reply) => {
    if (!hub.jobs.cancel(request.params.id)) {
      return reply.code(409).send({ error: 'Cette tâche ne peut pas être annulée' });
    }
    return { ok: true };
  });

  app.get('/api/core/jobs/stream', { config: { streamTicket: true } }, async (request, reply) => {
    const stream = openEventStream(request, reply);
    const off = hub.bus.on(JOB_UPDATED_EVENT, (job) => stream.send('job', job as JobInfo));
    stream.onClose(off);
  });

  // Generated files (ctx.outputs) -----------------------------------------

  const outputIds = (body: unknown): number[] | null => {
    const ids = (body as { ids?: unknown } | undefined)?.ids;
    return Array.isArray(ids) && ids.length > 0 && ids.every((id) => Number.isInteger(id))
      ? (ids as number[])
      : null;
  };

  // Every list reads the disk: a file deleted in the Explorer shows as missing.
  app.get<{ Querystring: { module?: string; missing?: string; subject?: string } }>(
    '/api/core/outputs',
    async (request) =>
      hub.outputs.list({
        moduleId: request.query.module || undefined,
        subject: request.query.subject || undefined,
        missing: request.query.missing === '1',
      }),
  );

  app.post('/api/core/outputs/delete', async (request, reply) => {
    const ids = outputIds(request.body);
    if (!ids) return reply.code(400).send({ error: 'Liste « ids » attendue' });
    const removed = await hub.outputs.delete({ ids });
    return { deleted: removed.length };
  });

  app.post('/api/core/outputs/forget', async (request, reply) => {
    const ids = outputIds(request.body);
    if (!ids) return reply.code(400).send({ error: 'Liste « ids » attendue' });
    return { forgotten: hub.outputs.forget({ ids }).length };
  });

  app.post<{ Params: { id: string; action: string } }>(
    '/api/core/outputs/:id/:action',
    async (request, reply) => {
      const { action } = request.params;
      if (action !== 'open' && action !== 'reveal') {
        return reply.code(404).send({ error: 'Action inconnue' });
      }
      const [record] = hub.outputs.list({ ids: [Number(request.params.id)] });
      if (!record) return reply.code(404).send({ error: 'Fichier inconnu' });
      if (!record.exists) {
        return reply.code(404).send({ error: `Fichier introuvable : ${record.path}` });
      }
      if (action === 'open') await hub.host.openPath(record.path);
      else hub.host.showItemInFolder(record.path);
      return { ok: true };
    },
  );

  app.post<{ Body: { module?: string } }>('/api/core/outputs/clean-missing', async (request) => ({
    forgotten: hub.outputs.forget({ missing: true, moduleId: request.body?.module || undefined })
      .length,
  }));

  // Logs ------------------------------------------------------------------

  app.get<{ Querystring: { source?: string; level?: LogLevel; limit?: string } }>(
    '/api/core/logs',
    async (request) =>
      hub.logs.read({
        source: request.query.source || undefined,
        minLevel: request.query.level,
        limit: Math.min(Number(request.query.limit) || 300, 2000),
      }),
  );

  // Backups ---------------------------------------------------------------

  app.get('/api/core/backups', async () => ({
    folder: hub.backupsDir,
    automatic: listAutomaticBackups(hub.backupsDir).map(({ name, size, createdAt }) => ({
      name,
      size,
      createdAt,
    })),
  }));

  app.post('/api/core/backups/open-folder', async () => {
    await hub.host.openPath(hub.backupsDir);
    return { ok: true };
  });

  app.post('/api/core/backups/export', async () => {
    const date = new Date().toISOString().slice(0, 10);
    const target = await hub.host.selectSaveFile({
      title: 'Exporter une sauvegarde',
      defaultPath: path.join(hub.host.getDefaultOutputRoot(), `ToolBox-sauvegarde-${date}.zip`),
      filters: [{ name: 'Archive ZIP', extensions: ['zip'] }],
    });
    if (!target) return { cancelled: true };
    const result = await exportBackupZip({
      db: hub.handle.db,
      dataDir: hub.dataDir,
      modulesDataDir: hub.modulesDataDir,
      target,
      appVersion,
      modules: hub
        .moduleInfos()
        .filter((m) => m.status === 'loaded')
        .map((m) => ({ id: m.id, version: m.manifest.version })),
    });
    hub.logger.info(`Sauvegarde exportée : ${result.file}`);
    hub.host.showItemInFolder(result.file);
    return { cancelled: false, ...result };
  });
}
