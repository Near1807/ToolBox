import { randomUUID } from 'node:crypto';
import type {
  JobDefinitionOptions,
  JobDetails,
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
/** Items that failed, kept per job (the count goes on). */
const ERRORS_KEPT = 500;

type Handler = (job: JobRunContext<unknown>) => Promise<unknown>;

interface Definition {
  handler: Handler;
  concurrency: number;
  logger: ModuleLogger;
  resumable: boolean;
  retry: JobDefinitionOptions['retry'] | null;
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
  details: string | null;
  state: string | null;
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
    details: row.details === null ? null : (JSON.parse(row.details) as JobDetails),
  };
}

const emptyDetails = (): JobDetails => ({
  done: null,
  total: null,
  unit: null,
  current: null,
  etaSeconds: null,
  errors: [],
  errorCount: 0,
  retryable: false,
  resumed: false,
});

/**
 * Long-running tasks (video renders…): FIFO queue per job type with a
 * concurrency limit, real progress, cancellation (AbortSignal), history in
 * core__jobs. Jobs still queued or running when the app quit are marked
 * "interrupted" at the next start; v0.49.0: those of a resumable type are
 * queued again once the modules are loaded (resumeInterrupted), with their
 * last checkpoint. Each job also reports its detail (counts, current item,
 * time left, every failed item) and may be retried for its failed items.
 */
export class JobManager {
  private readonly definitions = new Map<string, Definition>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Map<string, number>();
  private readonly lastProgressEmit = new Map<string, number>();
  /** The detail being built by each running job (written with the throttle, and at the end). */
  private readonly live = new Map<string, { details: JobDetails; since: number; base: number }>();
  /** Jobs this start found interrupted (resumed when their type is resumable). */
  private interruptedNow: string[] = [];
  private stopped = false;

  constructor(
    private readonly handle: DatabaseHandle,
    private readonly bus: EventBus,
  ) {}

  /** Marks jobs left over by a previous run and trims the history. */
  recover(): void {
    const now = new Date().toISOString();
    this.interruptedNow = (
      this.handle.db
        .prepare(`SELECT id FROM core__jobs WHERE status IN ('queued', 'running')`)
        .all() as { id: string }[]
    ).map((r) => r.id);
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
          resumable: options?.resumable === true,
          retry: options?.retry ?? null,
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

  /**
   * v0.49.0: after the modules are loaded, the jobs interrupted by the last
   * close are queued again when their type is resumable (their checkpoint
   * kept); the others stay « interrompue » with what they had done.
   */
  resumeInterrupted(): number {
    let resumed = 0;
    for (const id of this.interruptedNow) {
      const row = this.handle.db.prepare('SELECT * FROM core__jobs WHERE id = ?').get(id) as
        Row | undefined;
      if (!row) continue;
      const definition = this.definitions.get(this.key(row.module_id, row.type));
      if (!definition?.resumable) continue;
      const details = {
        ...(row.details ? (JSON.parse(row.details) as JobDetails) : emptyDetails()),
        resumed: true,
      };
      this.update(id, {
        status: 'queued',
        finished_at: null,
        message: 'Reprise après la fermeture de ToolBox',
        details: JSON.stringify(details),
      });
      resumed++;
      queueMicrotask(() => this.pump(row.module_id, row.type));
    }
    this.interruptedNow = [];
    return resumed;
  }

  /** v0.49.0: how many jobs run or wait now (the sidebar's witness, the warning at quit). */
  activeCount(): number {
    return (
      this.handle.db
        .prepare(`SELECT COUNT(*) AS n FROM core__jobs WHERE status IN ('queued', 'running')`)
        .get() as { n: number }
    ).n;
  }

  /**
   * v0.49.0: « Réessayer ceux-là » — a new job of the same type for the items
   * that failed (the type's retry gives its input). Null when nothing to retry.
   */
  retry(id: string): JobInfo | null {
    const row = this.handle.db.prepare('SELECT * FROM core__jobs WHERE id = ?').get(id) as
      Row | undefined;
    if (!row) return null;
    const definition = this.definitions.get(this.key(row.module_id, row.type));
    const details = row.details ? (JSON.parse(row.details) as JobDetails) : null;
    if (!definition?.retry || !details?.errors.length) return null;
    const input = definition.retry(
      row.input === null ? null : JSON.parse(row.input),
      details.errors,
      row.result === null ? null : JSON.parse(row.result),
    );
    if (input === null || input === undefined) return null;
    return this.enqueue(row.module_id, row.type, input, `${row.title} (réessai)`);
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
    const live = this.live.get(id)?.details;
    if (live) live.etaSeconds = null;
    this.update(id, {
      ...(live ? { details: JSON.stringify({ ...live, current: null }) } : {}),
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
    const row = this.handle.db
      .prepare('SELECT input, details, state FROM core__jobs WHERE id = ?')
      .get(id) as { input: string | null; details: string | null; state: string | null };
    const details: JobDetails = {
      ...emptyDetails(),
      ...(row.details ? (JSON.parse(row.details) as JobDetails) : {}),
      retryable: definition.retry !== null,
      etaSeconds: null,
    };
    // The time left counts from now (a resumed job: from where it resumes).
    this.live.set(id, { details, since: Date.now(), base: details.done ?? 0 });
    const flush = (force = false) => {
      const now = Date.now();
      if (!force && now - (this.lastProgressEmit.get(id) ?? 0) < PROGRESS_THROTTLE_MS) return;
      this.lastProgressEmit.set(id, now);
      const d = this.live.get(id)?.details;
      if (!d) return;
      const fraction = d.total ? Math.min(1, (d.done ?? 0) / d.total) : null;
      this.update(id, {
        details: JSON.stringify(d),
        ...(fraction === null ? {} : { progress: fraction }),
      });
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
      step: (done, total, options) => {
        if (controller.signal.aborted) return;
        const l = this.live.get(id);
        if (!l) return;
        const d = l.details;
        d.done = done;
        d.total = total;
        if (options?.unit !== undefined) d.unit = options.unit;
        if (options?.current !== undefined) d.current = options.current;
        // The time left: the rate since this run started, applied to what remains.
        const elapsed = (Date.now() - l.since) / 1000;
        const progressed = done - l.base;
        d.etaSeconds =
          total !== null && progressed > 0 && elapsed > 1
            ? Math.max(0, Math.round(((total - done) * elapsed) / progressed))
            : null;
        flush(total !== null && done >= total);
      },
      problem: (item, reason) => {
        const d = this.live.get(id)?.details;
        if (!d) return;
        d.errorCount++;
        if (d.errors.length < ERRORS_KEPT) d.errors.push({ item, reason });
        flush();
      },
      state: row.state === null ? null : JSON.parse(row.state),
      checkpoint: (state) => {
        if (!this.handle.db.open) return;
        this.handle.db
          .prepare('UPDATE core__jobs SET state = ? WHERE id = ?')
          .run(JSON.stringify(state ?? null), id);
      },
    };

    const abortedStatus = (): [JobStatus, string] =>
      this.stopped
        ? ['interrupted', 'Interrompue par la fermeture de l’application']
        : ['cancelled', 'Annulée'];

    try {
      const result = await definition.handler(context);
      if (controller.signal.aborted) {
        // v0.49.0: what it returned is kept (what was done before the stop, its « Annuler »).
        const [status, message] = abortedStatus();
        this.finish(id, status, { message, result });
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
      this.live.delete(id);
    }
  }

  /** Cancels running jobs (they will be recorded as cancelled). */
  stop(): void {
    this.stopped = true;
    for (const controller of this.controllers.values()) controller.abort();
  }
}
