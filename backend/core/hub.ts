import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type {
  BackendModule,
  Migration,
  ModuleContext,
  ModuleDatabase,
  ModuleLogger,
} from '../../packages/sdk/backend';
import type { ModuleInfo, ModuleManifest, SettingField } from '../../packages/sdk/manifest';
import {
  AccountManager,
  accountSettingsFields,
  ACCOUNTS_SCOPE,
  type OAuthProvider,
} from './accounts';
import { createAutomaticBackup, restoreBackup } from './backups';
import { coreMigrations } from './core-migrations';
import { DatabaseHandle } from './database';
import { EventBus } from './events';
import { getFfmpegPath, getFfprobePath } from './ffmpeg-binaries';
import { createModuleFiles } from './files';
import type { HostAdapter } from './host';
import { JobManager } from './jobs';
import { LogStore } from './logger';
import { MediaSigner } from './media';
import { createModuleNotifications } from './notifications';
import { OutputStore } from './outputs';
import {
  applyMigrations,
  assertNotSchemaChange,
  ensureMigrationsTable,
  getPendingMigrations,
  MigrationError,
  prefixedTable,
  tablePrefix,
} from './migrations';
import { planModuleLoading } from './modules/dependencies';
import { ManifestError, validateManifest } from './modules/manifest';
import { createRouteCollector, mountModuleRoutes, type RouteDefinition } from './modules/routes';
import { Scheduler } from './scheduler';
import { ServiceRegistry } from './services';
import { SETTINGS_CHANGED_EVENT, SettingsStore } from './settings';

/** A module folder found at build time (see scripts/esbuild-config.mjs). */
export interface DiscoveredModule {
  /** Folder name under modules/. Folders starting with "_" are examples. */
  folder: string;
  /** Parsed module.json (validated by the hub). */
  manifest: unknown;
  /** Default export of backend/index.ts, if the module has a backend. */
  backend?: BackendModule;
}

export interface HubOptions {
  dataDir: string;
  host: HostAdapter;
  appVersion: string;
  modules: DiscoveredModule[];
  /** Also load example modules (folders starting with "_"), e.g. for the smoke test. */
  loadExamples?: boolean;
  /** Echo logs to the console (dev). */
  echoLogs?: boolean;
  /**
   * Folder containing `<module folder>/assets/` for every module: the source
   * `modules/` folder in dev and tests, `build/modules` (unpacked) when packaged.
   */
  assetsRoot: string;
  /** Endpoint overrides of the OAuth providers (tests: mock servers). */
  accountProviders?: Record<string, Partial<OAuthProvider>>;
}

interface ModuleRecord {
  id: string;
  folder: string;
  manifest: ModuleManifest | null;
  backend?: BackendModule;
  example: boolean;
  status: ModuleInfo['status'];
  error?: string;
  disabled: boolean;
  routes: RouteDefinition[];
  shutdownHandlers: (() => void | Promise<void>)[];
}

export const CORE_SCOPE = 'core';

/** Interface preferences (theme, sidebar layout): a hidden settings section, see /api/core/ui. */
export const UI_SCOPE = 'ui';
export const UI_SETTINGS: SettingField[] = [
  { key: 'theme', type: 'string', label: 'Thème', default: '' },
  // JSON of the sidebar layout (categories, placement and order of the tools).
  { key: 'navigation', type: 'text', label: 'Barre latérale', default: '' },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The hub core: owns the database, the shared services and the module
 * lifecycle. It knows nothing about any particular module.
 */
export class Hub {
  readonly dataDir: string;
  readonly backupsDir: string;
  readonly modulesDataDir: string;
  readonly handle: DatabaseHandle;
  readonly logs: LogStore;
  readonly logger: ModuleLogger;
  readonly bus = new EventBus();
  readonly services = new ServiceRegistry();
  readonly settings: SettingsStore;
  readonly jobs: JobManager;
  readonly scheduler: Scheduler;
  readonly media: MediaSigner;
  readonly outputs: OutputStore;
  readonly accounts: AccountManager;
  private readonly records = new Map<string, ModuleRecord>();

  private constructor(readonly options: HubOptions) {
    this.dataDir = options.dataDir;
    this.backupsDir = path.join(options.dataDir, 'backups');
    this.modulesDataDir = path.join(options.dataDir, 'modules');
    for (const dir of [this.dataDir, this.backupsDir, this.modulesDataDir]) {
      mkdirSync(dir, { recursive: true });
    }
    this.logs = new LogStore(path.join(options.dataDir, 'logs'), options.echoLogs);
    this.logger = this.logs.logger(CORE_SCOPE);
    this.handle = new DatabaseHandle(path.join(options.dataDir, 'hub.db'));
    this.settings = new SettingsStore(this.handle, options.host, this.bus);
    this.jobs = new JobManager(this.handle, this.bus);
    this.scheduler = new Scheduler(this.handle);
    this.media = new MediaSigner(() => [
      this.modulesDataDir,
      this.getOutputRoot(),
      options.assetsRoot,
    ]);
    this.outputs = new OutputStore(this.handle, options.host, (file) => this.media.url(file));
    this.accounts = new AccountManager(
      this.handle,
      options.host,
      this.settings,
      this.logs.logger(ACCOUNTS_SCOPE),
      options.accountProviders,
    );
  }

  static async create(options: HubOptions): Promise<Hub> {
    const hub = new Hub(options);
    try {
      await hub.initialize();
    } catch (error) {
      hub.handle.close();
      throw error;
    }
    return hub;
  }

  get host(): HostAdapter {
    return this.options.host;
  }

  /** Root folder for generated files (core setting "outputRoot"). */
  getOutputRoot(): string {
    return String(this.settings.get(CORE_SCOPE, 'outputRoot') ?? this.host.getDefaultOutputRoot());
  }

  private async initialize(): Promise<void> {
    this.logger.info(`Démarrage de ToolBox ${this.options.appVersion}`);
    ensureMigrationsTable(this.handle.db);
    const coreFailure = this.migrateScope(CORE_SCOPE, coreMigrations);
    if (coreFailure) throw new Error(coreFailure);

    this.settings.register(CORE_SCOPE, 'Général', [
      {
        key: 'outputRoot',
        type: 'folder',
        label: 'Dossier de sortie',
        description:
          'Les fichiers générés par les outils (vidéos…) y sont rangés, dans un sous-dossier par outil.',
        default: this.host.getDefaultOutputRoot(),
      },
      {
        key: 'launchAtStartup',
        type: 'boolean',
        label: 'Lancer ToolBox au démarrage de Windows',
        description:
          'Réduit dans la zone de notification, pour que les rappels et les tâches planifiées tournent sans ouvrir l’app. Fermer la fenêtre la garde alors dans la zone de notification (clic droit sur l’icône > Quitter).',
        default: false,
      },
    ]);
    this.settings.register(ACCOUNTS_SCOPE, 'Comptes connectés', accountSettingsFields());
    this.settings.register(UI_SCOPE, 'Interface', UI_SETTINGS, { hidden: true });
    this.applyLaunchAtStartup();
    this.bus.on(SETTINGS_CHANGED_EVENT, (payload) => {
      const { scope, key } = payload as { scope: string; key: string };
      if (scope === CORE_SCOPE && key === 'launchAtStartup') this.applyLaunchAtStartup();
    });
    this.jobs.recover();

    this.discover();
    await this.loadModules();

    // Generated files deleted or moved outside the app since the last start.
    const missing = this.outputs.sync();
    if (missing > 0) {
      this.logger.warn(`${missing} fichier(s) généré(s) introuvable(s) sur le disque`);
    }
  }

  /** Keeps the OS login item in line with the core setting. */
  private applyLaunchAtStartup(): void {
    try {
      this.host.setLaunchAtStartup(this.settings.get(CORE_SCOPE, 'launchAtStartup') === true);
    } catch (error) {
      this.logger.warn('Lancement au démarrage de Windows : réglage non appliqué', error);
    }
  }

  // -------------------------------------------------------------------------
  // Migrations (with automatic backup and restore)
  // -------------------------------------------------------------------------

  /**
   * Applies pending migrations of a scope. Takes a timestamped backup first
   * (unless the database was just created). On failure, restores the backup and
   * returns the error message; returns null on success.
   */
  private migrateScope(scope: string, migrations: Migration[]): string | null {
    let backupFile: string | null = null;
    try {
      const pending = getPendingMigrations(this.handle.db, scope, migrations);
      if (pending.length === 0) return null;
      if (!this.handle.createdNow) {
        const target = pending[pending.length - 1]!.version;
        backupFile = createAutomaticBackup(
          this.handle.db,
          this.backupsDir,
          `avant-${scope}-v${target}`,
        );
        this.logger.info(
          `Sauvegarde avant migration de « ${scope} » : ${path.basename(backupFile)}`,
        );
      }
      applyMigrations(this.handle.db, scope, pending);
      this.logger.info(
        `Migrations de « ${scope} » appliquées jusqu'à la version ${pending.at(-1)!.version}`,
      );
      return null;
    } catch (error) {
      // Any failure (bad migration, backup impossible, disk full…) only affects this scope.
      const message =
        error instanceof MigrationError
          ? error.message
          : `Mise à jour de la base de « ${scope} » impossible : ${errorMessage(error)}`;
      this.logger.error(message, error);
      if (backupFile) {
        restoreBackup(this.handle, backupFile);
        this.logger.warn(`Base restaurée depuis ${path.basename(backupFile)}`);
      }
      return message;
    }
  }

  // -------------------------------------------------------------------------
  // Module lifecycle
  // -------------------------------------------------------------------------

  private discover(): void {
    for (const found of this.options.modules) {
      const example = found.folder.startsWith('_');
      if (example && !this.options.loadExamples) continue;
      const expectedId = example ? found.folder.slice(1) : found.folder;
      const record: ModuleRecord = {
        id: expectedId,
        folder: found.folder,
        manifest: null,
        backend: found.backend,
        example,
        status: 'failed',
        disabled: false,
        routes: [],
        shutdownHandlers: [],
      };
      try {
        record.manifest = validateManifest(found.manifest, expectedId);
        if (this.records.has(record.id)) throw new ManifestError(`id « ${record.id} » en double`);
        if (found.backend && typeof found.backend.register !== 'function') {
          throw new ManifestError(
            'backend/index.ts doit exporter par défaut un objet avec register(ctx)',
          );
        }
      } catch (error) {
        record.error = errorMessage(error);
        this.logger.error(`Module « ${found.folder} » ignoré : ${record.error}`);
      }
      if (!this.records.has(record.id)) this.records.set(record.id, record);
    }
  }

  private readDisabledState(): Map<string, string | null> {
    const rows = this.handle.db
      .prepare('SELECT module_id, disabled_reason FROM core__module_state WHERE enabled = 0')
      .all() as { module_id: string; disabled_reason: string | null }[];
    return new Map(rows.map((row) => [row.module_id, row.disabled_reason]));
  }

  private async loadModules(): Promise<void> {
    const valid = [...this.records.values()].filter((r) => r.manifest !== null);
    const disabled = this.readDisabledState();
    const unavailable = new Map<string, string>();
    for (const record of this.records.values()) {
      if (record.manifest === null) unavailable.set(record.id, record.error ?? 'manifest invalide');
      if (disabled.has(record.id)) {
        record.status = 'disabled';
        record.disabled = true;
        record.error = disabled.get(record.id) ?? 'Désactivé dans les réglages';
        unavailable.set(record.id, 'désactivé');
      }
    }

    // 1. Migrations of every loadable module, BEFORE any register(): restoring a
    //    backup reopens the database, which must not happen under live modules.
    let plan = planModuleLoading(
      valid.map((r) => r.manifest!),
      unavailable,
    );
    for (const id of plan.order) {
      const record = this.records.get(id)!;
      const failure = this.migrateScope(id, record.backend?.migrations ?? []);
      if (failure) {
        record.status = 'failed';
        record.error = failure;
        record.disabled = true;
        this.setModuleEnabled(id, false, failure);
        unavailable.set(id, 'migration échouée');
      }
    }
    plan = planModuleLoading(
      valid.map((r) => r.manifest!),
      unavailable,
    );

    for (const [id, reason] of plan.blocked) {
      const record = this.records.get(id)!;
      record.status = 'missing-dependencies';
      record.error = reason;
      this.logger.warn(`Module « ${id} » non chargé : ${reason}`);
    }

    // 2. Registration, providers first.
    const loaded = new Set<string>();
    for (const id of plan.order) {
      const record = this.records.get(id)!;
      const manifest = record.manifest!;
      const providersReady =
        (manifest.dependsOn?.modules ?? []).every((dep) => loaded.has(dep)) &&
        (manifest.dependsOn?.services ?? []).every((service) => this.services.has(service));
      if (!providersReady) {
        record.status = 'missing-dependencies';
        record.error = 'Dépendance manquante : un module requis n’a pas pu démarrer';
        this.logger.warn(`Module « ${id} » non chargé : ${record.error}`);
        continue;
      }
      if (await this.registerModule(record)) loaded.add(id);
    }
  }

  private async registerModule(record: ModuleRecord): Promise<boolean> {
    const manifest = record.manifest!;
    const id = manifest.id;
    const logger = this.logs.logger(id);
    const disposers: (() => void)[] = [];
    const pendingServices = new Map<string, object>();
    const { api: routes, routes: routeList } = createRouteCollector();

    this.settings.register(id, manifest.name, manifest.settings ?? []);

    const db: ModuleDatabase = {
      prefix: tablePrefix(id),
      table: (name) => prefixedTable(id, name),
      prepare: (sql) => {
        assertNotSchemaChange(sql);
        return this.handle.db.prepare(sql);
      },
      transaction: (fn) => this.handle.db.transaction(fn)(),
    };

    const events = this.bus.forSource(id, logger, (off) => disposers.push(off));

    const ctx: ModuleContext = {
      id,
      manifest,
      db,
      files: createModuleFiles({
        moduleId: id,
        modulesDataDir: this.modulesDataDir,
        assetsDir: path.join(this.options.assetsRoot, record.folder, 'assets'),
        getOutputRoot: () => this.getOutputRoot(),
        host: this.host,
        mediaUrl: (filePath) => this.media.url(filePath),
      }),
      outputs: this.outputs.forModule(id),
      settings: {
        get: <T>(key: string) => this.settings.get(id, key) as T | null,
        set: (key, value) => this.settings.set(id, key, value),
        onChange: (handler) => {
          const off = this.bus.on(SETTINGS_CHANGED_EVENT, (payload) => {
            const { scope, key } = payload as { scope: string; key: string };
            if (scope === id) handler(key);
          });
          disposers.push(off);
          return off;
        },
      },
      routes,
      jobs: this.jobs.forModule(id, logger),
      scheduler: this.scheduler.forModule(id, logger),
      events,
      services: this.services.forModule(manifest, pendingServices),
      accounts: this.accounts.forModule(manifest),
      notifications: createModuleNotifications(id, this.host, logger),
      binaries: {
        get ffmpeg() {
          return getFfmpegPath();
        },
        get ffprobe() {
          return getFfprobePath();
        },
      },
      logger,
      onShutdown: (handler) => record.shutdownHandlers.push(handler),
    };

    try {
      await record.backend?.register(ctx);
      const missing = (manifest.provides?.services ?? []).filter((s) => !pendingServices.has(s));
      if (missing.length > 0) {
        throw new Error(`service(s) déclaré(s) mais non fourni(s) : ${missing.join(', ')}`);
      }
      this.services.commit(id, pendingServices);
      record.routes = routeList;
      record.status = 'loaded';
      record.error = undefined;
      logger.info(`Module chargé (v${manifest.version})`);
      return true;
    } catch (error) {
      // Undo everything the module declared before failing.
      for (const dispose of disposers) dispose();
      this.jobs.forget(id);
      this.scheduler.forget(id);
      this.outputs.forgetModule(id);
      this.settings.unregister(id);
      record.shutdownHandlers = [];
      record.status = 'failed';
      record.error = `Erreur au démarrage du module : ${errorMessage(error)}`;
      logger.error(record.error, error);
      return false;
    }
  }

  /** Routes of loaded modules, under /api/modules/<id>/. */
  mountRoutes(app: FastifyInstance): void {
    for (const record of this.records.values()) {
      if (record.status !== 'loaded' || !record.manifest) continue;
      mountModuleRoutes(
        app,
        record.id,
        record.manifest.name,
        record.routes,
        this.logs.logger(record.id),
      );
    }
  }

  moduleInfos(): ModuleInfo[] {
    return [...this.records.values()].map((r) => ({
      id: r.id,
      manifest:
        r.manifest ??
        ({
          id: r.id,
          name: r.folder,
          description: '',
          version: '0.0.0',
          section: 'Autres',
          icon: '⚠️',
        } as ModuleManifest),
      status: r.status,
      error: r.error,
      disabled: r.disabled,
      example: r.example,
    }));
  }

  hasModule(id: string): boolean {
    return this.records.has(id);
  }

  /** Persists the enabled state; takes effect at the next start. */
  setModuleEnabled(id: string, enabled: boolean, reason: string | null = null): void {
    this.handle.db
      .prepare(
        `INSERT INTO core__module_state (module_id, enabled, disabled_reason, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (module_id) DO UPDATE SET enabled = excluded.enabled,
           disabled_reason = excluded.disabled_reason, updated_at = excluded.updated_at`,
      )
      .run(id, enabled ? 1 : 0, enabled ? null : reason, new Date().toISOString());
  }

  start(): void {
    this.scheduler.start();
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    this.accounts.stop();
    this.jobs.stop();
    for (const record of this.records.values()) {
      for (const handler of record.shutdownHandlers) {
        try {
          await handler();
        } catch (error) {
          this.logs.logger(record.id).error('Erreur à l’arrêt du module', error);
        }
      }
    }
    this.logger.info('Arrêt de ToolBox');
    this.handle.close();
  }
}
