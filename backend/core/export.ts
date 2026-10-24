import { createWriteStream, type Dirent, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { snapshotDatabase } from './backups';
import type { SqliteDatabase } from './database';

export interface ExportResult {
  file: string;
  size: number;
  fileCount: number;
}

/**
 * Writes a full user backup as a .zip: a consistent copy of hub.db plus every
 * module's private files (<userData>/modules/**), and a small description file.
 * Generated outputs (videos…) are not included: they live outside userData.
 */
export async function exportBackupZip(options: {
  db: SqliteDatabase;
  dataDir: string;
  modulesDataDir: string;
  target: string;
  appVersion: string;
  modules: { id: string; version: string }[];
  /** Left out (downloaded again on demand), relative to modulesDataDir: « assistant/models ». */
  exclude?: string[];
}): Promise<ExportResult> {
  const excluded = (options.exclude ?? []).map((p) => p.replace(/\/+$/, '') + '/');
  const tempDb = path.join(options.dataDir, 'tmp', `export-${Date.now()}.db`);
  const partial = `${options.target}.part`;
  snapshotDatabase(options.db, tempDb);

  try {
    const zip = new yazl.ZipFile();
    let fileCount = 1;
    zip.addFile(tempDb, 'hub.db');

    let entries: Dirent[] = [];
    try {
      entries = readdirSync(options.modulesDataDir, { recursive: true, withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const absolute = path.join(entry.parentPath, entry.name);
      const relative = path.relative(options.modulesDataDir, absolute).split(path.sep).join('/');
      if (excluded.some((prefix) => relative.startsWith(prefix))) continue;
      zip.addFile(absolute, `modules/${relative}`);
      fileCount += 1;
    }

    const description = {
      app: 'ToolBox',
      appVersion: options.appVersion,
      createdAt: new Date().toISOString(),
      modules: options.modules,
      contents: { 'hub.db': 'base de données', 'modules/': 'fichiers des modules' },
      // Downloaded engines and models: not in the backup, downloaded again with one click.
      excluded: options.exclude ?? [],
    };
    zip.addBuffer(Buffer.from(JSON.stringify(description, null, 2)), 'toolbox-sauvegarde.json');
    zip.end();

    await pipeline(zip.outputStream, createWriteStream(partial));
    renameSync(partial, options.target);
    return { file: options.target, size: statSync(options.target).size, fileCount };
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  } finally {
    rmSync(tempDb, { force: true });
  }
}
