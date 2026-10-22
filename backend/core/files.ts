import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ModuleFiles } from '../../packages/sdk/backend';
import type { HostAdapter } from './host';

/** Resolves `segments` inside `root`, refusing any path that escapes it. */
export function safeJoin(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Chemin hors du dossier autorisé : ${segments.join('/')}`);
  }
  return target;
}

export function createModuleFiles(options: {
  moduleId: string;
  modulesDataDir: string;
  assetsDir: string;
  getOutputRoot: () => string;
  host: HostAdapter;
  mediaUrl: (filePath: string) => string;
}): ModuleFiles {
  const dataDir = path.join(options.modulesDataDir, options.moduleId);
  mkdirSync(dataDir, { recursive: true });
  return {
    assetsDir: options.assetsDir,
    assetPath: (...segments) => safeJoin(options.assetsDir, ...segments),
    mediaUrl: options.mediaUrl,
    mediaUrlIfExists: (filePath) => {
      if (!filePath || !existsSync(filePath)) return null;
      try {
        return options.mediaUrl(filePath);
      } catch {
        return null; // Moved outside the allowed folders.
      }
    },
    dataDir,
    dataPath: (...segments) => safeJoin(dataDir, ...segments),
    outputDir: () => {
      const dir = path.join(options.getOutputRoot(), options.moduleId);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    open: (target) => options.host.openPath(target),
    reveal: (target) => options.host.showItemInFolder(target),
  };
}
