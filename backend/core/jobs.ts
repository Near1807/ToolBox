import { randomUUID } from 'node:crypto';
import type {
  JobDefinitionOptions,
  JobInfo,
  JobRunContext,
  JobStatus,
  ModuleJobs,
  ModuleLogger,
} from '../../packages/sdk/backend';
import type { DatabaseHandle } from './database';
import type { EventBus } from './events';

export const JOB_UPDATED_EVENT = 'core:job.updated';
const PROGRESS_THROTTLE_MS = 250;
const HISTORY_KEPT = 200;

type Handler = (job: JobRunContext<unknown>) => Promise<unknown>;

interface Definition {
  handler: Handler;
  concurrency: number;
  logger: ModuleLogger;
}

interface Row {
  id: string;
  module_id: string;
  type: string;
  title: string;
  status: JobStatus;
  progress: number | null;
  message: string | null;
  error: string | null;
  input: string | null;
  result: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function toInfo(row: Row): JobInfo {
  return {
    id: row.id,
    moduleId: row.module_id,
    type: row.type,
    title: row.title,
    status: row.status,
    progress: row.progress,
    message: row.message,
    error: row.error,
    result: row.result === null ? null : JSON.parse(row.result),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/**
 * Long-running tasks (video renders…): FIFO queue per job type with a
 * concurrency limit, real progress, cancellation (AbortSignal), history in
 * core__jobs. Jobs still queued or running when the app quit are marked
 * "interrupted" at the next start (no automatic resume).
 */
export class JobManager {
  private readonly definitions = new Map<string, Definition>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Map<string, number>();
  private readonly lastProgressEmit = new Map<string, number>();
  private stopped = false;

  constructor(
    private readonly handle: DatabaseHandle,
    private readonly bus: EventBus,
  ) {}

  /** Marks jobs left over by a previous run and trims the history. */
  recover(): void {
    const now = new Date().toISOString();
    this.handle.db
      .prepare(
        `UPDATE core__jobs SET status = 'interrupted', finished_at = ?,
           message = 'Interrompue par la fermeture de l''application'
         WHERE status IN ('queued', 'running')`,
      )
      .run(now);
    this.handle.db
      .prepare(
        `DELETE FROM core__jobs WHERE id NOT IN
           (SELECT id FROM core__jobs ORDER BY created_at DESC LIMIT ${HISTORY_KEPT})`,
      )
      .run();
  }

  private key(moduleId: string, type: string): string {
    return `${moduleId}/${type}`;
  }

  forModule(moduleId: string, logger: ModuleLogger): ModuleJobs {
    return {
      define: (type, handler, options?: JobDefinitionOptions) => {
        const key = this.key(moduleId, type);
        if (this.definitions.has(key)) throw new Error(`Tâche « ${type} » déjà définie`);
        this.definitions.set(key, {
          handler: handler as Handler,
          concurrency: Math.max(1, options?.concurrency ?? 1),
          logger,
        });
      },
      enqueue: (type, input, options) => this.enqueue(moduleId, type, input, options.title),
      get: (id) => {
        const job = this.get(id);
        return job && job.moduleId === moduleId ? job : null;
      },
      list: () => this.list({ moduleId }),
      cancel: (id) => (this.get(id)?.moduleId === moduleId ? this.cancel(id) : false),
    };
  }

  /** Removes the definitions of a module whose registration failed. */
  forget(moduleId: string): void {
    for (const key of this.definitions.keys()) {
      if (key.startsWith(`${moduleId}/`)) this.definitions.delete(key);
    }
  }

  enqueue(moduleId: string, type: string, input: unknown, title: string): JobInfo {
    if (this.stopped) throw new Error('Le hub est en cours d’arrêt');
    if (!this.definitions.has(this.key(moduleId, type))) {
      throw new Error(`Type de tâche inconnu « ${type} » pour « ${moduleId} »`);
    }
    const id = randomUUID();
    this.handle.db
      .prepare(
        `INSERT INTO core__jobs (id, module_id, type, title, status, input, created_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
      )
      .run(id, moduleId, type, title, JSON.stringify(input ?? null), new Date().toISOString());
    const job = this.get(id)!;
    this.bus.emit(JOB_UPDATED_EVENT, job);
    queueMicrotask(() => this.pump(moduleId, type));
    return job;
  }

  get(id: string): JobInfo | null {
    const row = this.handle.db.prepare('SELECT * FROM core__jobs WHERE id = ?').get(id) as
      Row | undefined;
    return row ? toInfo(row) : null;
  }

  list(filter: { moduleId?: string; limit?: number } = {}): JobInfo[] {
    const limit = filter.limit ?? 100;
    const rows = filter.moduleId
      ? this.handle.db
          .prepare('SELECT * FROM core__jobs WHERE module_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(filter.moduleId, limit)
      : this.handle.db
          .prepare('SELECT * FROM core__jobs ORDER BY created_at DESC LIMIT ?')
          .all(limit);
    return (rows as Row[]).map(toInfo);
  }

  cancel(id: string): boolean {
    const job = this.get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      this.finish(id, 'cancelled', { message: 'Annulée' });
      return true;
    }
    if (job.status === 'running') {
      this.controllers.get(id)?.abort();
      return true;
    }
    return false;
  }

  private update(id: string, fields: Partial<Record<keyof Row, unknown>>): void {
    if (!this.handle.db.open) return; // hub shutting down
    const keys = Object.keys(fields);
    const assignments = keys.map((k) => `${k} = ?`).join(', ');
    this.handle.db
      .prepare(`UPDATE core__jobs SET ${assignments} WHERE id = ?`)
      .run(...keys.map((k) => fields[k as keyof Row]), id);
    const job = this.get(id);
    if (job) this.bus.emit(JOB_UPDATED_EVENT, job);
  }

  private finish(
    id: string,
    status: JobStatus,
    extra: { message?: string | null; error?: string | null; result?: unknown } = {},
  ): void {
    this.update(id, {
      status,
      finished_at: new Date().toISOString(),
      message: extra.message ?? null,
      error: extra.error ?? null,
      result: extra.result === undefined ? null : JSON.stringify(extra.result),
      ...(status === 'succeeded' ? { progress: 1 } : {}),
    });
  }

  private pump(moduleId: string, type: string): void {
    const key = this.key(moduleId, type);
    const definition = this.definitions.get(key);
    if (!definition || this.stopped) return;
    while ((this.running.get(key) ?? 0) < definition.concurrency) {
      const next = this.handle.db
        .prepare(
          `SELECT id FROM core__jobs WHERE module_id = ? AND type = ? AND status = 'queued'
           ORDER BY created_at, rowid LIMIT 1`,
        )
        .get(moduleId, type) as { id: string } | undefined;
      if (!next) return;
      this.running.set(key, (this.running.get(key) ?? 0) + 1);
      void this.run(next.id, definition).finally(() => {
        this.running.set(key, (this.running.get(key) ?? 1) - 1);
        this.pump(moduleId, type);
      });
    }
  }

  private async run(id: string, definition: Definition): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.update(id, { status: 'running', started_at: new Date().toISOString(), progress: 0 });
    const row = this.handle.db.prepare('SELECT input FROM core__jobs WHERE id = ?').get(id) as {
      input: string | null;
    };

    const context: JobRunContext<unknown> = {
      id,
      input: row.input === null ? null : JSON.parse(row.input),
      signal: controller.signal,
      logger: definition.logger,
      progress: (fraction, message) => {
        if (controller.signal.aborted) return;
        const now = Date.now();
        // Persist and broadcast at most every 250 ms (FFmpeg reports many times per second).
        if (now - (this.lastProgressEmit.get(id) ?? 0) < PROGRESS_THROTTLE_MS) return;
        this.lastProgressEmit.set(id, now);
        const clamped = fraction === null ? null : Math.min(1, Math.max(0, fraction));
        this.update(
          id,
          message === undefined ? { progress: clamped } : { progress: clamped, message },
        );
      },
    };

    const abortedStatus = (): [JobStatus, string] =>
      this.stopped
        ? ['interrupted', 'Interrompue par la fermeture de l’application']
        : ['cancelled', 'Annulée'];

    try {
      const result = await definition.handler(context);
      if (controller.signal.aborted) {
        const [status, message] = abortedStatus();
        this.finish(id, status, { message });
      } else this.finish(id, 'succeeded', { result });
    } catch (error) {
      if (controller.signal.aborted) {
        const [status, message] = abortedStatus();
        this.finish(id, status, { message });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        definition.logger.error(`Échec de la tâche ${id}`, error);
        this.finish(id, 'failed', { error: message });
      }
    } finally {
      this.controllers.delete(id);
      this.lastProgressEmit.delete(id);
    }
  }

  /** Cancels running jobs (they will be recorded as cancelled). */
  stop(): void {
    this.stopped = true;
    for (const controller of this.controllers.values()) controller.abort();
  }
}
