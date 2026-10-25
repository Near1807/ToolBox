import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
    saveAs: async ({ title, defaultName, filters, data }) => {
      // Characters Windows refuses in a file name (control characters included).
      const safeName = [...defaultName]
        .map((c) => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? '_' : c))
        .join('')
        .slice(0, 150);
      const target = await options.host.selectSaveFile({
        title,
        defaultPath: path.join(options.getOutputRoot(), safeName),
        filters,
      });
      if (!target) return null;
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, data);
      return target;
    },
    open: (target) => options.host.openPath(target),
    reveal: (target) => options.host.showItemInFolder(target),
  };
}
