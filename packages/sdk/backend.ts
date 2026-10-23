// Backend side of the module contract: what `modules/<id>/backend/index.ts`
// exports and the `ctx` object it receives. See docs/MODULES.md.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModuleManifest, SettingValue } from './manifest';

export type { FastifyReply, FastifyRequest } from 'fastify';
export type * from './manifest';
export { matchByName, nameScore, normaliseName, type NameMatch } from './match';

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
  /** Registry of the files the module generates: every output must go through it. */
  readonly outputs: ModuleOutputs;
  readonly settings: ModuleSettings;
  readonly routes: ModuleRoutes;
  readonly jobs: ModuleJobs;
  readonly scheduler: ModuleScheduler;
  readonly events: ModuleEvents;
  readonly services: ModuleServices;
  /** Connected accounts (OAuth), for the providers declared in permissions.accounts. */
  readonly accounts: ModuleAccounts;
  /** Desktop notifications (Windows), opening a page of the module when clicked. */
  readonly notifications: ModuleNotifications;
  /** Actions the module offers to the voice assistant (and, with permissions.assistant, the catalog). */
  readonly assistant: ModuleAssistant;
  /** Push-to-talk style global keys (held / released), with permissions.globalKeys. */
  readonly hotkeys: ModuleHotkeys;
  /** The desktop window: open a page, show the floating indicator. */
  readonly ui: ModuleUi;
  readonly binaries: ModuleBinaries;
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
  /**
   * URL usable in <img>, <audio>, <video> (which cannot send the API token):
   * signed for this session, only for files under the hub's data folders, the
   * output folder or module assets. Supports seeking (HTTP Range).
   */
  mediaUrl(path: string): string;
  /**
   * Same, but null when there is no file, it no longer exists, or it was moved
   * outside the allowed folders (for DTOs: a missing file shows « Fichier introuvable »).
   */
  mediaUrlIfExists(path: string | null | undefined): string | null;
  /** Read-only files shipped with the module: modules/<id>/assets/ (fonts, images…). */
  readonly assetsDir: string;
  /** Path inside assetsDir; throws if it escapes the folder. */
  assetPath(...segments: string[]): string;
}

/** A generated file, as registered in ctx.outputs. */
export interface OutputRecord {
  id: number;
  moduleId: string;
  /** The module's own identifier of the element, e.g. "video:12". */
  ref: string;
  /** Group the element belongs to (e.g. "pack:3"): deleting the group deletes all of it. */
  parent: string | null;
  /** What the file is about, shared across modules (e.g. "music-library:track:7"). */
  subject: string | null;
  /** Short French label shown in lists ("Vidéo YouTube", "Reel 2"…). */
  label: string;
  kind: string | null;
  path: string;
  fileName: string;
  createdAt: string;
  /** Checked on disk at every read: false when the file was moved or deleted outside the app. */
  exists: boolean;
  /** Signed media URL when the file exists. */
  url: string | null;
}

export interface OutputFilter {
  ids?: number[];
  refs?: string[];
  ref?: string;
  parent?: string;
  /** Only the records whose file is missing. */
  missing?: boolean;
}

/**
 * Called after records of this module were removed — by the module itself,
 * the « Fichiers générés » page or the cleaning of missing files. The module
 * deletes or resets its own rows for these refs ("deleted": files sent to the
 * Recycle Bin; "forgotten": files left as they are, only removed from the lists).
 */
export type OutputRemovedHandler = (
  records: OutputRecord[],
  reason: 'deleted' | 'forgotten',
) => void;

/**
 * Called when the user attaches records of this module to another project
 * (« Sans projet » > Rattacher), with the new `subject`. The core record is
 * already updated; the module moves its OWN row (track_id…), then re-registers
 * the file if `parent` depends on it. Runs inside the same transaction:
 * synchronous only; throw (e.g. HttpError 409) to refuse, nothing changes.
 */
export type OutputReattachHandler = (records: OutputRecord[], subject: string) => void;

export interface ModuleOutputs {
  /** Records (or updates, same path) a generated file. Call it after every render. */
  register(output: {
    path: string;
    ref: string;
    label: string;
    kind?: string;
    parent?: string;
    /**
     * Project the element belongs to — mandatory (docs/MODULES.md §5.13). Music:
     * `music-library:track:<id>`, the track it was made from.
     */
    subject: string;
    /** Default: now. */
    createdAt?: string;
  }): OutputRecord;
  /** Records of this module, newest first, with `exists` checked on disk. */
  list(filter?: OutputFilter): OutputRecord[];
  /** Sends the files to the Recycle Bin and forgets the records. Returns the count. */
  delete(filter: OutputFilter): Promise<number>;
  /** Forgets the records, leaving the files alone (« Retirer de la liste »). */
  forget(filter: OutputFilter): number;
  /** Declares how the module cleans its own data when records are removed. */
  onRemoved(handler: OutputRemovedHandler): void;
  /** Records of every module about a subject (e.g. all files made from a track). */
  bySubject(subject: string): OutputRecord[];
  /** Deletes the files of every module about a subject; each owner cleans its data. */
  deleteBySubject(subject: string): Promise<number>;
  /**
   * Records of every module without a project: no subject, or one for which
   * `isKnown` returns false (e.g. a deleted track). For the « Sans projet » list.
   */
  orphans(isKnown: (subject: string) => boolean): OutputRecord[];
  /**
   * Attaches records of any module to a project chosen by the user (kept from
   * then on). Each owner module follows through its onReattach handler, in one
   * transaction; refused when an owner declares none (absent or too old).
   */
  attach(ids: number[], subject: string): number;
  /** Declares how the module moves its own rows when records change project. */
  onReattach(handler: OutputReattachHandler): void;
}

/** Executables embedded in the app, usable by any module (child_process.execFile/spawn). */
export interface ModuleBinaries {
  /** FFmpeg (6.1 on Windows): stay compatible with it. */
  readonly ffmpeg: string;
  readonly ffprobe: string;
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

/** The `:id` of a route (a positive integer); answers 400 otherwise. */
export function idParam(params: unknown): number {
  const id = Number((params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Identifiant invalide');
  return id;
}

/** The JSON body of a request, or {} when there is none (fields still to be checked). */
export function requestBody(request: { body?: unknown }): Record<string, unknown> {
  return (request.body ?? {}) as Record<string, unknown>;
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
  /**
   * Returns a service declared in manifest.dependsOn.optionalServices, or
   * undefined when no loaded module provides it (the module must work without).
   */
  optional<T extends object>(name: string): T | undefined;
}

/** State of a connected account (OAuth), as seen by modules and the Settings page. */
export interface AccountStatus {
  /** Provider id, e.g. "google". */
  provider: string;
  label: string;
  /** True when the OAuth client (ID, secret) is entered in Réglages > Comptes connectés. */
  configured: boolean;
  connected: boolean;
  /** The authorization expired or was revoked: connect again. */
  needsReconnect: boolean;
  /** Scopes granted by the user. */
  scopes: string[];
  connectedAt: string | null;
  error: string | null;
  /** A consent page is open in the browser, waiting for the user. */
  connecting: boolean;
}

export type AccountErrorCode =
  | 'not-configured'
  | 'not-connected'
  | 'reauth-required'
  | 'denied'
  | 'cancelled'
  | 'network'
  | 'encryption';

/** Error of ctx.accounts, with a French message ready to show. */
export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

export interface ModuleAccounts {
  readonly available: boolean;
  status(provider: string): AccountStatus;
  /**
   * Opens the provider's consent page in the browser and resolves once the user
   * answered (5 min max). Scopes already granted are kept (incremental).
   */
  connect(provider: string, scopes: string[]): Promise<AccountStatus>;
  /** Revokes the authorization at the provider and forgets the tokens. */
  disconnect(provider: string): Promise<void>;
  /** A valid access token (refreshed when needed). Throws AccountError. */
  accessToken(provider: string): Promise<string>;
  /**
   * fetch() with the bearer token; "/path" is resolved against the provider's
   * API base (Google: https://www.googleapis.com). A 401 refreshes the token and
   * sends the request once more, so the body must be a string or a Buffer.
   */
  fetch(provider: string, url: string, init?: RequestInit): Promise<Response>;
}

export interface ModuleNotifications {
  /**
   * Shows a Windows notification (when the app runs). `path` is a page of the
   * module ("" = its main page, "items/3"…) opened when the notification is clicked.
   */
  notify(notification: { title: string; body: string; path?: string }): void;
}

// ---------------------------------------------------------------------------
// Assistant actions (docs/MODULES.md §5.15, ADR 0028)
// ---------------------------------------------------------------------------

/**
 * Risk level of an action, enforced by the hub:
 * - `read`: reads only, run directly;
 * - `change`: harmless change (add, tick), run directly, undoable;
 * - `destructive`: change that loses something (delete), run only after the
 *   user confirmed (`confirmation()` gives the question);
 * - `sensitive`: publishes, uploads, deletes files, moves a scheduled date…
 *   never run by the assistant: it says so and offers to open `page`.
 */
export type AssistantRisk = 'read' | 'change' | 'destructive' | 'sensitive';

/** One parameter of an action (a small JSON Schema subset, sent to the model). */
export interface AssistantParameter {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'string[]';
  /** French: what to put there, with an example. */
  description: string;
  enum?: string[];
}

export type AssistantParams = Record<string, string | number | boolean | string[] | undefined>;

export interface AssistantActionResult {
  /** French sentence stating what was done or found (« J'ai ajouté … »): never more than what happened. */
  message: string;
  /** Facts for the model to answer from (small, JSON-serializable). */
  data?: unknown;
  /** Undoes a `change` / `destructive` action (« Annuler »). */
  undo?: () => void | Promise<void>;
  /** A UI route to open (« ouvre le Planning »): "/m/<module id>/…". */
  open?: string;
}

export interface AssistantActionDefinition {
  /** kebab-case, unique in the module; the full id is "<module id>.<name>". */
  name: string;
  /** French, for the model: what it does and when to use it. */
  description: string;
  parameters?: Record<string, AssistantParameter>;
  required?: string[];
  risk: AssistantRisk;
  /** `destructive` only (required): the question asked before running (« Supprimer la tâche « … » ? »). */
  confirmation?: (params: AssistantParams) => string | Promise<string>;
  /** `sensitive` only: the page where the user does it himself (relative to the module: "" or "items/3"). */
  page?: string;
  /** Not called for `sensitive` actions. Throw an HttpError with a French message on bad input. */
  run?: (params: AssistantParams) => AssistantActionResult | Promise<AssistantActionResult>;
}

/** An action as listed in the catalog. */
export interface AssistantActionInfo {
  /** "<module id>.<name>" */
  id: string;
  moduleId: string;
  moduleName: string;
  name: string;
  description: string;
  parameters: Record<string, AssistantParameter>;
  required: string[];
  risk: AssistantRisk;
  /** Full UI route of a sensitive action's page. */
  page: string | null;
}

export type AssistantOutcome =
  | {
      status: 'done';
      id: string;
      message: string;
      data: unknown;
      /** Pass to undo(); null when the action cannot be undone. */
      undoId: string | null;
      open: string | null;
    }
  /** Destructive action not confirmed yet: ask `question`, then run again with confirmed. */
  | { status: 'confirm'; id: string; question: string }
  /** Sensitive action: never run; `open` is the page where the user does it. */
  | { status: 'refused'; id: string; message: string; open: string | null }
  /** Unknown action or bad parameters (French message, for the model to fix or ask). */
  | { status: 'invalid'; id: string; message: string }
  | { status: 'error'; id: string; message: string };

export interface ModuleAssistant {
  /** Declares an action of this module. */
  define(action: AssistantActionDefinition): void;
  /** Every action of the loaded modules (requires permissions.assistant). */
  actions(): AssistantActionInfo[];
  /** Validates the parameters, applies the risk rules and runs (requires permissions.assistant). */
  run(id: string, params: unknown, options?: { confirmed?: boolean }): Promise<AssistantOutcome>;
  /** Undoes a done action (requires permissions.assistant). */
  undo(undoId: string): Promise<{ ok: boolean; message: string }>;
}

// ---------------------------------------------------------------------------
// Global keys, window (desktop only)
// ---------------------------------------------------------------------------

/** A key of the keyboard, as seen by the system-wide hook (libuiohook key code). */
export interface HotkeySpec {
  code: number;
  /** French, for the UI (« Touche Copilot », « Ctrl droit », « F13 »). */
  label: string;
}

export interface ModuleHotkeys {
  /** False outside the desktop app or when the system hook could not start (`reason` says why). */
  status(): { available: boolean; reason: string | null };
  /**
   * Calls onPress when `key` goes down and onRelease when it comes back up,
   * even when ToolBox has no focus (auto-repeat is filtered). Replaces the
   * previous binding of this module; `null` stops listening.
   */
  hold(key: HotkeySpec | null, handlers: { onPress: () => void; onRelease: () => void }): void;
  /** Resolves with the next key pressed anywhere (« appuie sur la touche voulue »), or null after timeoutMs. */
  capture(timeoutMs?: number): Promise<HotkeySpec | null>;
}

export interface ModuleUi {
  /** Shows the main window (restored, focused) on a UI route ("/m/todo", "/jobs"…). */
  open(route: string): void;
  /** Shows or hides the floating indicator (the module's `Overlay` component, always on top). */
  setOverlay(visible: boolean): void;
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
