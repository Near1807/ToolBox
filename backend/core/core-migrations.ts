import type { Migration } from '../../packages/sdk/backend';

/** Schema of the hub itself (scope "core", tables "core__*"). Same rules as modules. */
export const coreMigrations: Migration[] = [
  {
    version: 1,
    description: 'module state, settings, jobs, schedules',
    up: `
      CREATE TABLE core__module_state (
        module_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        disabled_reason TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE core__settings (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        encrypted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, key)
      );
      CREATE TABLE core__jobs (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL,
        message TEXT,
        error TEXT,
        input TEXT,
        result TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX core__jobs_module ON core__jobs (module_id, created_at);
      CREATE TABLE core__schedules (
        module_id TEXT NOT NULL,
        name TEXT NOT NULL,
        last_success_at TEXT,
        last_attempt_at TEXT,
        last_error TEXT,
        PRIMARY KEY (module_id, name)
      );
    `,
  },
  {
    version: 2,
    description: 'generated files of the modules (ctx.outputs)',
    up: `
      CREATE TABLE core__outputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id TEXT NOT NULL,
        ref TEXT NOT NULL,
        parent TEXT,
        subject TEXT,
        label TEXT NOT NULL,
        kind TEXT,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        missing_since TEXT,
        UNIQUE (module_id, file_path)
      );
      CREATE INDEX core__outputs_ref ON core__outputs (module_id, ref);
      CREATE INDEX core__outputs_parent ON core__outputs (module_id, parent);
      CREATE INDEX core__outputs_subject ON core__outputs (subject);
    `,
  },
  {
    version: 3,
    description: 'connected accounts (ctx.accounts, OAuth tokens encrypted)',
    up: `
      CREATE TABLE core__accounts (
        provider TEXT PRIMARY KEY,
        scopes TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        access_token TEXT,
        access_expires_at TEXT,
        status TEXT NOT NULL,
        error TEXT,
        connected_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 4,
    description:
      'project of a generated file chosen by the user (kept when the module registers it again)',
    up: `
      ALTER TABLE core__outputs ADD COLUMN subject_manual INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 5,
    description: 'installation id (seed of the UUIDs given to old numbered rows, MODULES.md §6 bis)',
    up: `
      CREATE TABLE core__meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];
