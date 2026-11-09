// The phone host (ADR 0044): runs the server code of the portable modules,
// unchanged, inside the app's Worker. It builds the same `ctx` as the PC's
// core (backend/core/hub.ts) and reuses its portable pieces as they are: the
// migration runner, the services and calendar registries, the loading order.
// What the phone does not provide yet (files, images, notifications, jobs…)
// throws an explicit « non disponible sur le téléphone » error — never a
// silent fake success. The assistant is without effect (ADR 0044).
// Portable: no Node import.
import {
  HttpError,
  type BackendModule,
  type Migration,
  type ModuleAssistant,
  type ModuleContext,
  type ModuleDatabase,
  type ModuleLogger,
  type ModuleManifest,
  type ModuleSettings,
  type SettingField,
  type SettingValue,
  type ImageOptions,
  type StoredImage,
} from '../sdk/core';
import { CalendarRegistry } from '../../backend/core/calendar';
import { coreMigrations } from '../../backend/core/core-migrations';
import {
  applyMigrations,
  assertNotSchemaChange,
  ensureMigrationsTable,
  getPendingMigrations,
  prefixedTable,
  tablePrefix,
  type MigrationRuntime,
} from '../../backend/core/migrations-core';
import { planModuleLoading } from '../../backend/core/modules/dependencies';
import { ServiceRegistry } from '../../backend/core/services';
import {
  SettingsValidationError,
  validateSettingValue,
} from '../../backend/core/settings-validation';
import { legacyKey, legacyUuidFromHash } from '../../backend/core/legacy-id-core';
import type { SqlDatabase } from './database';
import { sha256Hex } from './sha256';
import { PhoneRouter, type PhoneRequest, type PhoneResponse } from './router';
import { phoneFiles, type FileStore } from './files';
import { SyncEngine } from '../../backend/core/sync/engine';
import { partly, unavailable, UnavailableOnPhoneError } from './unavailable';

export { partly, unavailable, UnavailableOnPhoneError } from './unavailable';

/**
 * What the phone provides through the PAGE (Android, via the Capacitor
 * plugins): given by the app's Worker, which forwards to the page. Absent in
 * the tests that do not need it (the members then stay unavailable).
 */
export interface PhoneHostServices {
  /**
   * ctx.files.saveAs: the file goes to Android's share sheet, the user
   * chooses where it goes. The file's name, or null when the user cancelled.
   */
  saveAs?: (options: {
    title: string;
    defaultName: string;
    data: string | Uint8Array;
  }) => Promise<string | null>;
  /**
   * ctx.notifications.notify. Absent: without effect. In the app it is
   * without effect too: the Timer's notifications are SCHEDULED in advance
   * by the page (the Worker sleeps in the background), with the same texts.
   */
  notify?: (notification: { title: string; body: string; path?: string }) => void;
  /** ctx.ui.setOverlay. Absent: without effect (no floating window on the phone). */
  setOverlay?: (visible: boolean) => void;
  /** The modules' data folders (OPFS in the app). Absent: ctx.files' data part unavailable. */
  files?: FileStore;
  /**
   * ctx.db.backup. NOT given by the app: what needs it (the Courses' JSON
   * import, « avant import ») stays on the PC. Only the tests give it, to
   * replay a reference that builds its base through that import.
   */
  backupDb?: (reason: string) => string;
  /** ctx.images.normalise (OffscreenCanvas in the app's Worker). Absent: unavailable. */
  normaliseImage?: (input: Uint8Array, options: ImageOptions) => Promise<StoredImage>;
}

/** A module as the app bundles it: its manifest and its server code. */
export interface PhoneModule {
  manifest: ModuleManifest;
  backend?: BackendModule;
}

export interface PhoneModuleState {
  id: string;
  status: 'loaded' | 'failed' | 'missing-dependencies';
  error?: string;
}

/**
 * The phone's runtime for the migration runner: Web Crypto's random UUID and
 * the same legacy ids as the PC (a fresh install converts the rows its first
 * migration created, e.g. the Timer's two presets).
 */
const PHONE_RUNTIME: MigrationRuntime = {
  randomId: () => globalThis.crypto.randomUUID(),
  legacyUuid: (seed, kind, oldId) => legacyUuidFromHash(sha256Hex(legacyKey(seed, kind, oldId))),
};

/** The settings of the modules, in the same table as the PC (core__settings). */
class PhoneSettings {
  private readonly fields = new Map<string, SettingField[]>();
  private readonly titles = new Map<string, string>();
  private readonly listeners = new Set<(scope: string, key: string) => void>();
  /** A synchronised setting changed here (journaled by the synchronisation). */
  onSynced: ((scope: string, key: string, value: SettingValue) => void) | null = null;

  constructor(private readonly db: SqlDatabase) {}

  /** The synchronised keys of each scope (`sync: true`). */
  syncedKeys(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [scope, fields] of this.fields) {
      const keys = fields.filter((f) => f.sync).map((f) => f.key);
      if (keys.length) out[scope] = keys;
    }
    return out;
  }

  register(scope: string, fields: SettingField[], title = scope) {
    this.fields.set(scope, fields);
    this.titles.set(scope, title);
  }

  /** Like the PC's GET /api/core/settings: the sections with fields, their values. */
  describe() {
    return [...this.fields.entries()]
      .filter(([, fields]) => fields.some((f) => !f.hidden))
      .map(([scope, fields]) => ({
        scope,
        title: this.titles.get(scope) ?? scope,
        fields: fields
          .filter((field) => !field.hidden)
          .map((field) => {
            const row = this.db
              .prepare('SELECT value FROM core__settings WHERE scope = ? AND key = ?')
              .get(scope, field.key) as { value: string | null } | undefined;
            if (field.type === 'secret') return { field, value: null, isSet: Boolean(row?.value) };
            return { field, value: this.get(scope, field.key), isSet: row !== undefined };
          }),
      }));
  }

  /** Like the PC's PUT /api/core/settings/:scope: every value validated first, then all saved (or none). */
  update(scope: string, values: Record<string, unknown>): void {
    if (!this.fields.has(scope)) throw new SettingsValidationError(`Section inconnue « ${scope} »`);
    const entries = Object.entries(values).map(([key, value]) => {
      const field = this.field(scope, key);
      if (field.type === 'secret') throw new UnavailableOnPhoneError('réglage chiffré (secret)');
      validateSettingValue(field, value as SettingValue, () => {
        throw new UnavailableOnPhoneError('réglage de dossier');
      });
      return [key, value as SettingValue] as const;
    });
    this.db.transaction(() => {
      for (const [key, value] of entries) this.set(scope, key, value);
    })();
  }

  private field(scope: string, key: string): SettingField {
    const field = this.fields.get(scope)?.find((f) => f.key === key);
    if (!field) throw new SettingsValidationError(`Réglage inconnu « ${scope}.${key} »`);
    return field;
  }

  get(scope: string, key: string): SettingValue {
    const field = this.field(scope, key);
    const row = this.db
      .prepare('SELECT value, encrypted FROM core__settings WHERE scope = ? AND key = ?')
      .get(scope, key) as { value: string | null; encrypted: number } | undefined;
    if (!row || row.value === null)
      return 'default' in field && field.default !== undefined ? field.default : null;
    if (row.encrypted) throw new UnavailableOnPhoneError('réglage chiffré (secret)');
    return JSON.parse(row.value) as SettingValue;
  }

  set(scope: string, key: string, value: SettingValue, fromSync = false): void {
    const field = this.field(scope, key);
    if (field.type === 'secret') throw new UnavailableOnPhoneError('réglage chiffré (secret)');
    const normalized = validateSettingValue(field, value, () => {
      throw new UnavailableOnPhoneError('réglage de dossier');
    });
    if (normalized === null) {
      this.db.prepare('DELETE FROM core__settings WHERE scope = ? AND key = ?').run(scope, key);
    } else {
      this.db
        .prepare(
          `INSERT INTO core__settings (scope, key, value, encrypted, updated_at) VALUES (?, ?, ?, 0, ?)
           ON CONFLICT (scope, key) DO UPDATE SET value = excluded.value,
             encrypted = excluded.encrypted, updated_at = excluded.updated_at`,
        )
        .run(scope, key, JSON.stringify(normalized), new Date().toISOString());
    }
    if (field.sync && !fromSync) this.onSynced?.(scope, key, normalized);
    for (const listener of this.listeners) listener(scope, key);
  }

  forModule(scope: string, onDispose: (off: () => void) => void): ModuleSettings {
    return {
      get: <T extends SettingValue = SettingValue>(key: string) => this.get(scope, key) as T | null,
      set: (key, value) => this.set(scope, key, value),
      onChange: (handler) => {
        const listener = (s: string, key: string) => {
          if (s === scope) handler(key);
        };
        this.listeners.add(listener);
        const off = () => void this.listeners.delete(listener);
        onDispose(off);
        return off;
      },
    };
  }
}

export interface PhoneHubOptions {
  db: SqlDatabase;
  modules: PhoneModule[];
  /** What the page provides (share sheet…); absent: those parts stay unavailable. */
  host?: PhoneHostServices;
  /** Where the modules' logs go (default: the console). */
  log?: (
    level: 'debug' | 'info' | 'warn' | 'error',
    moduleId: string,
    message: string,
    data?: unknown,
  ) => void;
}

export class PhoneHub {
  readonly router = new PhoneRouter();
  /** The synchronisation's engine (ADR 0044), created once the core is migrated. */
  sync!: SyncEngine;
  readonly services = new ServiceRegistry();
  readonly calendar = new CalendarRegistry();
  readonly settings: PhoneSettings;
  private readonly states = new Map<string, PhoneModuleState>();
  private readonly shutdown: (() => void | Promise<void>)[] = [];
  private readonly logger: ModuleLogger;

  /** The base (the synchronisation's Worker steps read it). */
  get db(): SqlDatabase {
    return this.options.db;
  }

  private constructor(private readonly options: PhoneHubOptions) {
    this.settings = new PhoneSettings(options.db);
    this.logger = this.loggerFor('core');
    this.router.coreGet('/api/core/calendar', async (query) => {
      const { from, to } = query as { from?: string; to?: string };
      const day = /^\d{4}-\d{2}-\d{2}$/;
      if (!from || !to || !day.test(from) || !day.test(to) || from > to)
        return {
          status: 400,
          text: JSON.stringify({ error: 'Période invalide (from, to : AAAA-MM-JJ)' }),
        };
      return {
        status: 200,
        text: JSON.stringify({
          sources: this.calendar.list(),
          events: await this.calendar.events(from, to, this.logger),
        }),
      };
    });
  }

  /**
   * The migrations a start would apply, per scope (core first), WITHOUT
   * writing anything: the app copies a non-empty base before (« avant-migration »).
   * A scope whose base is newer than its code is left out (it is not migrated).
   */
  static pendingMigrations(
    db: SqlDatabase,
    modules: PhoneModule[],
  ): { scope: string; count: number }[] {
    const hasTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'core__migrations'")
      .get();
    const scopes: [string, Migration[]][] = [
      ['core', coreMigrations],
      ...modules.map((m): [string, Migration[]] => [m.manifest.id, m.backend?.migrations ?? []]),
    ];
    const pending: { scope: string; count: number }[] = [];
    for (const [scope, migrations] of scopes) {
      let count = migrations.length;
      if (hasTable) {
        try {
          count = getPendingMigrations(db, scope, migrations).length;
        } catch {
          count = 0;
        }
      }
      if (count > 0) pending.push({ scope, count });
    }
    return pending;
  }

  /** The settings routes of the PC (the same form on the phone's Réglages). */
  private settingsRoutes() {
    this.router.coreRoute('GET', '/api/core/settings', () => this.settings.describe(), this.logger);
    this.router.coreRoute(
      'PUT',
      '/api/core/settings/:scope',
      (request) => {
        try {
          this.settings.update(
            (request.params as { scope: string }).scope,
            (request.body ?? {}) as Record<string, unknown>,
          );
        } catch (error) {
          if (error instanceof SettingsValidationError || error instanceof UnavailableOnPhoneError)
            throw new HttpError(400, error.message);
          throw error;
        }
        return { ok: true };
      },
      this.logger,
    );
  }

  /** Migrates the core and the modules, then registers the modules (providers first). */
  static async start(options: PhoneHubOptions): Promise<PhoneHub> {
    const hub = new PhoneHub(options);
    hub.settingsRoutes();
    await hub.load();
    return hub;
  }

  private loggerFor(moduleId: string): ModuleLogger {
    const sink =
      this.options.log ??
      ((level, id, message, data) =>
        console[level](`[${id}] ${message}`, ...(data === undefined ? [] : [data])));
    return {
      debug: (m, d) => sink('debug', moduleId, m, d),
      info: (m, d) => sink('info', moduleId, m, d),
      warn: (m, d) => sink('warn', moduleId, m, d),
      error: (m, d) => sink('error', moduleId, m, d),
    };
  }

  private migrate(scope: string, migrations: Migration[]): string | null {
    try {
      const pending = getPendingMigrations(this.options.db, scope, migrations);
      if (pending.length) applyMigrations(this.options.db, scope, pending, PHONE_RUNTIME);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private async load() {
    const { db, modules } = this.options;
    ensureMigrationsTable(db);
    const coreFailure = this.migrate('core', coreMigrations);
    if (coreFailure) throw new Error(coreFailure);
    this.sync = new SyncEngine({ db, role: 'phone', randomId: PHONE_RUNTIME.randomId });
    this.sync.setSettings({
      keys: () => this.settings.syncedKeys(),
      read: (scope, key) => this.settings.get(scope, key),
      write: (scope, key, value) => this.settings.set(scope, key, value, true),
    });
    this.settings.onSynced = (scope, key, value) => this.sync.logSetting(scope, key, value);

    const byId = new Map(modules.map((m) => [m.manifest.id, m]));
    const unavailableIds = new Map<string, string>();
    let plan = planModuleLoading(
      modules.map((m) => m.manifest),
      unavailableIds,
    );
    // 1. Migrations of every module, BEFORE any register() (like the PC).
    for (const id of plan.order) {
      const failure = this.migrate(id, byId.get(id)!.backend?.migrations ?? []);
      if (failure) {
        this.states.set(id, { id, status: 'failed', error: failure });
        unavailableIds.set(id, 'migration échouée');
      }
    }
    plan = planModuleLoading(
      modules.map((m) => m.manifest),
      unavailableIds,
    );
    for (const [id, reason] of plan.blocked)
      if (!this.states.has(id))
        this.states.set(id, { id, status: 'missing-dependencies', error: reason });
    // 2. Registration, providers first.
    const loaded = new Set<string>();
    for (const id of plan.order) {
      const module = byId.get(id)!;
      const ready =
        (module.manifest.dependsOn?.modules ?? []).every((dep) => loaded.has(dep)) &&
        (module.manifest.dependsOn?.services ?? []).every((s) => this.services.has(s));
      if (!ready) {
        this.states.set(id, {
          id,
          status: 'missing-dependencies',
          error: 'Dépendance manquante : un module requis n’a pas pu démarrer',
        });
        continue;
      }
      if (await this.register(module)) loaded.add(id);
    }
  }

  private async register(module: PhoneModule): Promise<boolean> {
    const { manifest } = module;
    const id = manifest.id;
    const logger = this.loggerFor(id);
    const disposers: (() => void)[] = [];
    const pendingServices = new Map<string, object>();
    const routes = this.router.forModule(id, manifest.name, logger);
    const shutdown: (() => void | Promise<void>)[] = [];
    this.settings.register(id, manifest.settings ?? [], manifest.name);

    const db: ModuleDatabase = {
      prefix: tablePrefix(id),
      table: (name) => prefixedTable(id, name),
      prepare: (sql) => {
        assertNotSchemaChange(sql);
        return this.options.db.prepare(sql);
      },
      transaction: (fn) => this.options.db.transaction(fn)(),
      syncClock: module.backend?.sync ? this.sync.clock : undefined,
      backup: (reason) => {
        const backup = this.options.host?.backupDb;
        if (!backup) throw new UnavailableOnPhoneError('ctx.db.backup');
        return backup(reason);
      },
    };
    // Without effect on the phone: actions are declared and ignored.
    const assistant = new Proxy({} as ModuleAssistant, {
      get(_target, prop) {
        if (prop === 'define') return () => undefined;
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        throw new UnavailableOnPhoneError(`ctx.assistant.${prop}`);
      },
    });
    const ctx: ModuleContext = {
      id,
      manifest,
      db,
      files: phoneFiles(id, this.options.host?.files, this.saveAs()),
      outputs: unavailable('outputs'),
      settings: this.settings.forModule(id, (off) => disposers.push(off)),
      routes: routes.api,
      jobs: unavailable('jobs'),
      scheduler: unavailable('scheduler'),
      events: unavailable('events'),
      services: this.services.forModule(manifest, pendingServices),
      accounts: unavailable('accounts'),
      notifications: partly<ModuleContext['notifications']>('notifications', {
        notify: (n) => this.options.host?.notify?.(n),
      }),
      assistant,
      hotkeys: unavailable('hotkeys'),
      ui: partly<ModuleContext['ui']>('ui', {
        setOverlay: (visible) => this.setOverlay(id, visible),
      }),
      images: partly<ModuleContext['images']>(
        'images',
        this.options.host?.normaliseImage ? { normalise: this.options.host.normaliseImage } : {},
      ),
      calendar: this.calendar.forModule(id, (off) => disposers.push(off)),
      binaries: unavailable('binaries'),
      logger,
      onShutdown: (handler) => shutdown.push(handler),
    };
    try {
      await module.backend?.register(ctx);
      const missing = (manifest.provides?.services ?? []).filter((s) => !pendingServices.has(s));
      if (missing.length > 0)
        throw new Error(`service(s) déclaré(s) mais non fourni(s) : ${missing.join(', ')}`);
      this.services.commit(id, pendingServices);
      if (module.backend?.sync)
        this.sync.addModule({ id, sync: module.backend.sync, db, files: ctx.files });
      routes.mount();
      this.shutdown.push(...shutdown);
      this.states.set(id, { id, status: 'loaded' });
      logger.info(`Module chargé (v${manifest.version})`);
      return true;
    } catch (error) {
      for (const dispose of disposers) dispose();
      const message = error instanceof Error ? error.message : String(error);
      this.states.set(id, {
        id,
        status: 'failed',
        error: `Erreur au démarrage du module : ${message}`,
      });
      logger.error(`Erreur au démarrage du module : ${message}`, error);
      return false;
    }
  }

  /** Like the PC's hub: the window is asked for while one module wants it (changes only). */
  private readonly overlayRequests = new Set<string>();
  private setOverlay(moduleId: string, visible: boolean) {
    const before = this.overlayRequests.size > 0;
    if (visible) this.overlayRequests.add(moduleId);
    else this.overlayRequests.delete(moduleId);
    const after = this.overlayRequests.size > 0;
    if (before !== after) this.options.host?.setOverlay?.(after);
  }

  /** ctx.files.saveAs on the phone: Android's share sheet, through the page. */
  private saveAs(): ModuleContext['files']['saveAs'] | undefined {
    const saveAs = this.options.host?.saveAs;
    return saveAs
      ? (o) => saveAs({ title: o.title, defaultName: o.defaultName, data: o.data })
      : undefined;
  }

  /** State of every module (loaded, failed…), in loading order. */
  modules(): PhoneModuleState[] {
    return [...this.states.values()];
  }

  handle(request: PhoneRequest): Promise<PhoneResponse> {
    return this.router.handle(request);
  }

  /** An event stream of a module (route declared with `streamTicket: true`): see PhoneRouter.openStream. */
  openStream(url: string, onEvent: (event: string, data: unknown) => void): (() => void) | null {
    return this.router.openStream(url, onEvent);
  }

  async close(): Promise<void> {
    for (const handler of this.shutdown.splice(0)) await handler();
  }
}
