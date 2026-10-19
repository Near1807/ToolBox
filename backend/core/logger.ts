import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ModuleLogger } from '../../packages/sdk/backend';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  /** "core" or a module id. */
  source: string;
  message: string;
  data?: unknown;
}

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const RETENTION_DAYS = 14;

function serializeData(data: unknown): unknown {
  if (data instanceof Error) return { name: data.name, message: data.message, stack: data.stack };
  return data;
}

/**
 * Logs as JSON lines in <userData>/logs/toolbox-YYYY-MM-DD.log (kept 14 days).
 * Files, not SQLite: logs must survive a database restore after a failed migration.
 */
export class LogStore {
  constructor(
    readonly dir: string,
    private readonly echo = false,
  ) {
    mkdirSync(dir, { recursive: true });
    this.prune();
  }

  private fileFor(date: Date): string {
    return path.join(this.dir, `toolbox-${date.toISOString().slice(0, 10)}.log`);
  }

  write(source: string, level: LogLevel, message: string, data?: unknown): void {
    const now = new Date();
    const entry: LogEntry = { ts: now.toISOString(), level, source, message };
    if (data !== undefined) entry.data = serializeData(data);
    try {
      appendFileSync(this.fileFor(now), JSON.stringify(entry) + '\n');
    } catch {
      // Logging must never break the hub.
    }
    if (this.echo) console.log(`[${level}] ${source}: ${message}`);
  }

  logger(source: string): ModuleLogger {
    return {
      debug: (message, data) => this.write(source, 'debug', message, data),
      info: (message, data) => this.write(source, 'info', message, data),
      warn: (message, data) => this.write(source, 'warn', message, data),
      error: (message, data) => this.write(source, 'error', message, data),
    };
  }

  /** Most recent entries first, filtered by source and minimum level. */
  read(options: { source?: string; minLevel?: LogLevel; limit?: number } = {}): LogEntry[] {
    const { source, minLevel = 'debug', limit = 500 } = options;
    const minIndex = LEVELS.indexOf(minLevel);
    const files = readdirSync(this.dir)
      .filter((name) => /^toolbox-\d{4}-\d{2}-\d{2}\.log$/.test(name))
      .sort()
      .reverse();

    const result: LogEntry[] = [];
    for (const name of files) {
      const lines = readFileSync(path.join(this.dir, name), 'utf8').split('\n').reverse();
      for (const line of lines) {
        if (!line) continue;
        let entry: LogEntry;
        try {
          entry = JSON.parse(line) as LogEntry;
        } catch {
          continue;
        }
        if (source && entry.source !== source) continue;
        if (LEVELS.indexOf(entry.level) < minIndex) continue;
        result.push(entry);
        if (result.length >= limit) return result;
      }
    }
    return result;
  }

  private prune(): void {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const name of readdirSync(this.dir)) {
      const match = /^toolbox-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
      if (match?.[1] && match[1] < cutoff) rmSync(path.join(this.dir, name), { force: true });
    }
  }
}
