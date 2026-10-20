import type { ModuleLogger, ModuleNotifications } from '../../packages/sdk/backend';
import type { HostAdapter } from './host';

/** ctx.notifications of a module: Windows notification + a line in the module's logs. */
export function createModuleNotifications(
  moduleId: string,
  host: HostAdapter,
  logger: ModuleLogger,
): ModuleNotifications {
  return {
    notify: ({ title, body, path }) => {
      const page = (path ?? '').replace(/^\/+/, '');
      logger.info(`Notification : ${title} — ${body}`);
      try {
        host.notify({ title, body, target: `/m/${moduleId}${page ? `/${page}` : ''}` });
      } catch (error) {
        logger.warn('Notification impossible', error);
      }
    },
  };
}
