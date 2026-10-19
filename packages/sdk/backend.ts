// Backend side of the module contract: what `modules/<id>/backend/index.ts`
// exports and the `ctx` object it receives. See docs/MODULES.md.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModuleManifest, SettingValue } from './manifest';

export type { FastifyReply, FastifyRequest } from 'fastify';
export type * from './manifest';

// ---------------------------------------------------------------------------
// What a module exports
// ---------------------------------------------------------------------------

export interface BackendModule {
  /**
   * Schema migrations, applied by the hub BEFORE register() is called.
   * Never edit or remove a migration once released: add a new one.
   */
  migrations?: Migration[];
  /** Declares routes, jobs, scheduled tasks, services and event listeners. */
  register(ctx: ModuleContext): void | Promise<void>;
}

/** Identity helper giving type inference to `backend/index.ts`. */
export function defineBackendModule(module: BackendModule): BackendModule {
  return module;
}

export interface Migration {
  /** 1, 2, 3… contiguous, in order. */
  version: number;
  description: string;
  /** SQL script, or a function for data migrations. Runs inside a transaction. */
  up: string | ((db: MigrationDatabase) => void);
}

export interface MigrationDatabase {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  /** Full table name for this module, e.g. table('tracks') → "music_library__tracks". */
  table(name: string): string;
}

// ---------------------------------------------------------------------------
// ctx
// ---------------------------------------------------------------------------

export interface ModuleContext {
  readonly id: string;
  readonly manifest: ModuleManifest;
  readonly db: ModuleDatabase;
  readonly files: ModuleFiles;
  readonly settings: ModuleSettings;
  readonly routes: ModuleRoutes;
  readonly jobs: ModuleJobs;
  readonly scheduler: ModuleScheduler;
  readonly events: ModuleEvents;
  readonly services: ModuleServices;
  readonly accounts: ModuleAccounts;
  readonly logger: ModuleLogger;
  /** Called when the hub shuts down (close watchers, kill processes…). */
  onShutdown(handler: () => void | Promise<void>): void;
}

/** Minimal statement interface (better-sqlite3 compatible). */
export interface Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface ModuleDatabase {
  /** Prefix of every table owned by the module, e.g. "music_library__". */
  readonly prefix: string;
  /** Full table name: table('tracks') → "music_library__tracks". */
  table(name: string): string;
  /** Prepares a query. Schema changes (CREATE/ALTER/DROP) are refused: use a migration. */
  prepare(sql: string): Statement;
  /** Runs fn inside a transaction (all or nothing). */
  transaction<T>(fn: () => T): T;
}

export interface ModuleFiles {
  /** Private data folder: <userData>/modules/<id>/ (created when the module loads). */
  readonly dataDir: string;
  /** Path inside dataDir; throws if it escapes the folder. */
  dataPath(...segments: string[]): string;
  /** Output folder for user-facing files: <output root>/<id>/ (created on demand). */
  outputDir(): string;
  /** Opens a file or folder with the OS (Explorer, default app). */
  open(path: string): Promise<void>;
  /** Shows a file selected in the OS file explorer. */
  reveal(path: string): void;
}

export interface ModuleSettings {
  /** Current value, or the declared default. Secrets are returned decrypted. */
  get<T extends SettingValue = SettingValue>(key: string): T | null;
  set(key: string, value: SettingValue): void;
  /** Called after a setting of this module changes. Returns an unsubscribe function. */
  onChange(handler: (key: string) => void): () => void;
}

export type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => unknown;

export interface RouteOptions {
  /** GET routes read with EventSource: accept a single-use ?ticket= (see ARCHITECTURE.md). */
  streamTicket?: boolean;
  /** Maximum request body in bytes (default 1 MB). */
  bodyLimit?: number;
}

/** Routes are mounted under /api/modules/<id>/. Paths start with "/". */
export interface ModuleRoutes {
  get(path: string, handler: RouteHandler, options?: RouteOptions): void;
  post(path: string, handler: RouteHandler, options?: RouteOptions): void;
  put(path: string, handler: RouteHandler, options?: RouteOptions): void;
  patch(path: string, handler: RouteHandler, options?: RouteOptions): void;
  delete(path: string, handler: RouteHandler, options?: RouteOptions): void;
}

/** Thrown from a route handler to answer with a clean HTTP error (French message). */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export interface JobInfo {
  id: string;
  moduleId: string;
  type: string;
  title: string;
  status: JobStatus;
  /** 0..1, or null when unknown. */
  progress: number | null;
  message: string | null;
  error: string | null;
  result: unknown;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface JobRunContext<TInput> {
  readonly id: string;
  readonly input: TInput;
  /** Aborted when the user cancels the job or the hub shuts down. */
  readonly signal: AbortSignal;
  /** Reports progress (0..1) and an optional French status message. */
  progress(fraction: number | null, message?: string): void;
  readonly logger: ModuleLogger;
}

export interface JobDefinitionOptions {
  /** How many jobs of this type may run at the same time (default 1). */
  concurrency?: number;
}

export interface ModuleJobs {
  /** Declares a job type (during register). */
  define<TInput, TResult>(
    type: string,
    handler: (job: JobRunContext<TInput>) => Promise<TResult>,
    options?: JobDefinitionOptions,
  ): void;
  /** Queues a job of a type defined by THIS module. */
  enqueue<TInput>(type: string, input: TInput, options: { title: string }): JobInfo;
  get(id: string): JobInfo | null;
  /** Jobs of this module, most recent first. */
  list(): JobInfo[];
  cancel(id: string): boolean;
}

export type ScheduleSpec =
  /** Every day at a local time "HH:MM". */
  | { daily: string }
  /** Every N minutes. */
  | { everyMinutes: number };

export interface ScheduledTaskContext {
  readonly signal: AbortSignal;
  /** When the task last succeeded (null on first run). */
  readonly lastSuccessAt: Date | null;
  readonly logger: ModuleLogger;
}

export interface ModuleScheduler {
  /**
   * Declares a periodic task (during register). Missed runs (app closed at the
   * scheduled time) are caught up once at startup. A failed run is retried after 15 minutes.
   */
  schedule(
    name: string,
    spec: ScheduleSpec,
    handler: (task: ScheduledTaskContext) => Promise<void>,
  ): void;
}

export interface ModuleEvents {
  /** Emits "<module id>:<name>". A module can only emit in its own namespace. */
  emit(name: string, payload?: unknown): void;
  /** Listens to a fully-qualified event, e.g. "music-library:track.created". */
  on(event: string, handler: (payload: unknown) => void | Promise<void>): () => void;
}

export interface ModuleServices {
  /** Registers a service declared in manifest.provides.services. */
  provide<T extends object>(name: string, implementation: T): void;
  /** Returns a service declared in manifest.dependsOn.services. */
  get<T extends object>(name: string): T;
}

export interface ModuleAccounts {
  /** Available from phase 5 (OAuth Google). Throws until then. */
  readonly available: boolean;
}

export interface ModuleLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

// ---------------------------------------------------------------------------
// Server-Sent Events helper
// ---------------------------------------------------------------------------

export interface EventStream {
  /** Sends one SSE message; `data` is JSON-encoded. */
  send(event: string, data: unknown): void;
  /** Called once when the client disconnects. */
  onClose(handler: () => void): void;
  close(): void;
}

/**
 * Turns a GET route into an SSE stream. Declare the route with
 * `{ streamTicket: true }` so EventSource can authenticate with ?ticket=.
 */
export function openEventStream(request: FastifyRequest, reply: FastifyReply): EventStream {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  const closeHandlers: (() => void)[] = [];
  let closed = false;
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const handler of closeHandlers) handler();
  };
  request.raw.on('close', cleanup);

  return {
    send: (event, data) => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    onClose: (handler) => closeHandlers.push(handler),
    close: () => {
      cleanup();
      res.end();
    },
  };
}
