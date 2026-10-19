import type {
  ModuleLogger,
  ModuleScheduler,
  ScheduleSpec,
  ScheduledTaskContext,
} from '../../packages/sdk/backend';
import type { DatabaseHandle } from './database';

const TICK_MS = 60_000;
export const RETRY_DELAY_MS = 15 * 60_000;

interface Task {
  moduleId: string;
  name: string;
  spec: ScheduleSpec;
  handler: (task: ScheduledTaskContext) => Promise<void>;
  logger: ModuleLogger;
  running: boolean;
}

export interface TaskState {
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
}

export function validateScheduleSpec(spec: ScheduleSpec): void {
  if ('daily' in spec) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(spec.daily)) {
      throw new Error(`Heure invalide « ${spec.daily} » (format HH:MM attendu)`);
    }
  } else if (!Number.isInteger(spec.everyMinutes) || spec.everyMinutes < 1) {
    throw new Error('everyMinutes doit être un entier ≥ 1');
  }
}

/** When the task should run next, given its last success (local time for "daily"). */
export function nextRunAfter(spec: ScheduleSpec, lastSuccessAt: Date): Date {
  if ('everyMinutes' in spec) return new Date(lastSuccessAt.getTime() + spec.everyMinutes * 60_000);
  const [hours, minutes] = spec.daily.split(':').map(Number) as [number, number];
  const next = new Date(lastSuccessAt);
  next.setHours(hours, minutes, 0, 0);
  if (next <= lastSuccessAt) next.setDate(next.getDate() + 1);
  return next;
}

/**
 * A task is due when it never succeeded, or when its next run time has passed
 * (this is also the catch-up rule: if the app was closed at the scheduled time,
 * the task runs once at the next start). After a failure it waits RETRY_DELAY_MS.
 */
export function isDue(spec: ScheduleSpec, state: TaskState, now: Date): boolean {
  const failedRecently =
    state.lastAttemptAt !== null &&
    (state.lastSuccessAt === null || state.lastAttemptAt > state.lastSuccessAt) &&
    now.getTime() - state.lastAttemptAt.getTime() < RETRY_DELAY_MS;
  if (failedRecently) return false;
  if (state.lastSuccessAt === null) return true;
  return now >= nextRunAfter(spec, state.lastSuccessAt);
}

/** Periodic tasks of all modules, checked every minute and at startup. */
export class Scheduler {
  private readonly tasks = new Map<string, Task>();
  private timer: NodeJS.Timeout | null = null;
  private readonly controller = new AbortController();

  constructor(
    private readonly handle: DatabaseHandle,
    private readonly now: () => Date = () => new Date(),
  ) {}

  forModule(moduleId: string, logger: ModuleLogger): ModuleScheduler {
    return {
      schedule: (name, spec, handler) => {
        validateScheduleSpec(spec);
        const key = `${moduleId}/${name}`;
        if (this.tasks.has(key)) throw new Error(`Tâche planifiée « ${name} » déjà déclarée`);
        this.tasks.set(key, { moduleId, name, spec, handler, logger, running: false });
      },
    };
  }

  forget(moduleId: string): void {
    for (const key of this.tasks.keys()) {
      if (key.startsWith(`${moduleId}/`)) this.tasks.delete(key);
    }
  }

  private state(task: Task): TaskState {
    const row = this.handle.db
      .prepare(
        'SELECT last_success_at, last_attempt_at FROM core__schedules WHERE module_id = ? AND name = ?',
      )
      .get(task.moduleId, task.name) as
      { last_success_at: string | null; last_attempt_at: string | null } | undefined;
    return {
      lastSuccessAt: row?.last_success_at ? new Date(row.last_success_at) : null,
      lastAttemptAt: row?.last_attempt_at ? new Date(row.last_attempt_at) : null,
    };
  }

  private record(task: Task, success: boolean, error: string | null): void {
    if (!this.handle.db.open) return;
    const now = this.now().toISOString();
    this.handle.db
      .prepare(
        `INSERT INTO core__schedules (module_id, name, last_success_at, last_attempt_at, last_error)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (module_id, name) DO UPDATE SET
           last_success_at = COALESCE(excluded.last_success_at, last_success_at),
           last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error`,
      )
      .run(task.moduleId, task.name, success ? now : null, now, error);
  }

  /** Runs every due task once. Resolves when they are all done (used by tests). */
  async tick(): Promise<void> {
    const now = this.now();
    const due = [...this.tasks.values()].filter(
      (task) => !task.running && isDue(task.spec, this.state(task), now),
    );
    await Promise.all(due.map((task) => this.runTask(task)));
  }

  private async runTask(task: Task): Promise<void> {
    task.running = true;
    const { lastSuccessAt } = this.state(task);
    try {
      task.logger.info(`Tâche planifiée « ${task.name} » : démarrage`);
      await task.handler({ signal: this.controller.signal, lastSuccessAt, logger: task.logger });
      this.record(task, true, null);
      task.logger.info(`Tâche planifiée « ${task.name} » : terminée`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.record(task, false, message);
      task.logger.error(
        `Tâche planifiée « ${task.name} » : échec (nouvel essai dans 15 min)`,
        error,
      );
    } finally {
      task.running = false;
    }
  }

  /** Catch-up run at startup, then a check every minute. */
  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.controller.abort();
  }
}
