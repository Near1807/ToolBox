import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AccountError, openEventStream, type JobInfo } from '../../packages/sdk/backend';
import { localToday } from '../../packages/sdk/dates';
import { KEPT_BACKUPS, listAutomaticBackups } from '../core/backups';
import {
  cancelRestore,
  dismissRestoreResult,
  inspectBackup,
  pendingRestore,
  restoreResult,
  stageRestore,
} from '../core/restore';
import { getSqliteVersion } from '../core/database';
import { exportBackupZip } from '../core/export';
import { getBinaryVersion, getFfmpegPath, getFfprobePath } from '../core/ffmpeg-binaries';
import { UI_SCOPE, UI_SETTINGS, type Hub } from '../core/hub';
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

  // Rights of the assistant (Réglages > Général), the same as on the assistant's page.
  app.get('/api/core/assistant/rights', async () => hub.assistant.rights());
  app.put<{ Params: { id: string }; Body: { granted?: unknown } }>(
    '/api/core/assistant/rights/:id',
    async (request, reply) => {
      const id = decodeURIComponent(request.params.id);
      if (!hub.assistant.rights().some((r) => r.id === id))
        return reply.code(404).send({ error: 'Droit inconnu' });
      hub.assistant.setRight(id, request.body?.granted === true);
      return hub.assistant.rights();
    },
  );

  // « Prêt pour le calendrier » (MODULES.md §5.17): every module's dated items for a period.
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/core/calendar',
    async (request, reply) => {
      const { from, to } = request.query;
      const day = /^\d{4}-\d{2}-\d{2}$/;
      if (!from || !to || !day.test(from) || !day.test(to) || from > to)
        return reply.code(400).send({ error: 'Période invalide (from, to : AAAA-MM-JJ)' });
      return {
        sources: hub.calendar.list(),
        events: await hub.calendar.events(from, to, hub.logger),
      };
    },
  );

  // v0.47.0: « Ranger dans ToolBox » in Windows' right click and « Envoyer vers » (ADR 0059).
  app.get('/api/core/shell-integration', async () => {
    const integration = hub.host.shellIntegration;
    if (!integration) return { available: false, menu: false, sendTo: false };
    return { available: true, ...(await integration.get()) };
  });
  app.put<{ Body: { enabled?: unknown } }>(
    '/api/core/shell-integration',
    async (request, reply) => {
      const integration = hub.host.shellIntegration;
      if (!integration)
        return reply.code(409).send({ error: 'Seulement dans l’app ToolBox sous Windows' });
      if (typeof request.body?.enabled !== 'boolean')
        return reply.code(400).send({ error: 'Champ « enabled » (booléen) attendu' });
      hub.logger.info(
        `Clic droit de Windows « Ranger dans ToolBox » : ${request.body.enabled ? 'remis' : 'retiré'}`,
      );
      return { available: true, ...(await integration.set(request.body.enabled)) };
    },
  );

  // v0.47.0: the hub's search (Ctrl+K anywhere, MODULES.md §5.18): every module's results.
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/core/search', async (request) => {
    const t0 = performance.now();
    const limit = Math.max(1, Math.min(50, Number(request.query.limit) || 8));
    const groups = await hub.search.search(String(request.query.q ?? ''), limit);
    return { groups, ms: Math.round((performance.now() - t0) * 10) / 10 };
  });

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

  // Interface preferences (theme, sidebar layout), stored like settings but not listed.
  app.get('/api/core/ui', async () =>
    Object.fromEntries(UI_SETTINGS.map((f) => [f.key, hub.settings.get(UI_SCOPE, f.key)])),
  );

  app.put<{ Body: Record<string, unknown> }>('/api/core/ui', async (request, reply) => {
    try {
      hub.settings.update(UI_SCOPE, request.body ?? {});
      return { ok: true };
    } catch (error) {
      if (error instanceof SettingsValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

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

  // v0.49.0: « Réessayer ceux-là » — a new job for the items that failed.
  app.post<{ Params: { id: string } }>('/api/core/jobs/:id/retry', async (request, reply) => {
    const job = hub.jobs.retry(request.params.id);
    if (!job) return reply.code(409).send({ error: 'Rien à réessayer pour cette tâche' });
    return job;
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
    kept: KEPT_BACKUPS,
    automatic: listAutomaticBackups(hub.backupsDir).map(({ name, kind, size, createdAt }) => ({
      name,
      kind,
      size,
      createdAt,
    })),
  }));

  // v0.47.0: restore ToolBox from a copy of its base (ADR 0063).
  const inspect = (file: unknown) => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Fichier invalide');
    return inspectBackup(file, {
      appVersion: hub.options.appVersion,
      known: hub.knownMigrations(),
      nameOf: (scope) => hub.moduleName(scope),
    });
  };
  app.get('/api/core/restore', async () => ({
    pending: pendingRestore(hub.dataDir),
    result: restoreResult(hub.dataDir),
    automatic: listAutomaticBackups(hub.backupsDir).map(
      ({ file, name, kind, size, createdAt }) => ({
        file,
        name,
        kind,
        size,
        createdAt,
      }),
    ),
  }));
  /** What a copy holds (read only). */
  app.post<{ Body: { file?: unknown } }>('/api/core/restore/preview', async (request, reply) => {
    try {
      return inspect(request.body?.file);
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  /** Confirmed: the current base saved, the copy put aside; replaced at the next start. */
  app.post<{ Body: { file?: unknown; confirm?: unknown } }>(
    '/api/core/restore/stage',
    async (request, reply) => {
      if (request.body?.confirm !== true)
        return reply.code(400).send({ error: 'Restauration : confirmation nécessaire' });
      try {
        const preview = inspect(request.body?.file);
        if (preview.refused) return reply.code(409).send({ error: preview.refused });
        const pending = stageRestore(hub.handle.db, hub.dataDir, hub.backupsDir, preview);
        hub.logger.info(`Restauration préparée depuis ${preview.file} (au prochain démarrage)`);
        return pending;
      } catch (error) {
        return reply
          .code(400)
          .send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );
  app.post('/api/core/restore/cancel', async () => {
    cancelRestore(hub.dataDir);
    hub.logger.info('Restauration annulée avant le redémarrage');
    return { ok: true };
  });
  app.delete('/api/core/restore/result', async () => {
    dismissRestoreResult(hub.dataDir);
    return { ok: true };
  });

  app.post('/api/core/backups/open-folder', async () => {
    await hub.host.openPath(hub.backupsDir);
    return { ok: true };
  });

  app.post('/api/core/backups/export', async () => {
    // The day of the computer (not UTC): a backup at 00:30 is of that day.
    const date = localToday();
    const target = await hub.host.selectSaveFile({
      title: 'Exporter une sauvegarde',
      defaultPath: path.join(hub.host.getDefaultOutputRoot(), `ToolBox-sauvegarde-${date}.zip`),
      filters: [{ name: 'Archive ZIP', extensions: ['zip'] }],
    });
    if (!target) return { cancelled: true };
    const loaded = hub.moduleInfos().filter((m) => m.status === 'loaded');
    const result = await exportBackupZip({
      db: hub.handle.db,
      dataDir: hub.dataDir,
      modulesDataDir: hub.modulesDataDir,
      target,
      appVersion,
      modules: loaded.map((m) => ({ id: m.id, version: m.manifest.version })),
      exclude: loaded.flatMap((m) => (m.manifest.backup?.exclude ?? []).map((p) => `${m.id}/${p}`)),
    });
    hub.logger.info(`Sauvegarde exportée : ${result.file}`);
    hub.host.showItemInFolder(result.file);
    return { cancelled: false, ...result };
  });
}
