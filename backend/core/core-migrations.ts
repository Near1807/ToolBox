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
];
