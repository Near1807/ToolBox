import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ModuleFiles } from '../../packages/sdk/backend';
import { isRunnable, parseZoneIdentifier } from '../../packages/sdk/core';
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

/** Names a module library may not take (the hub's own folders and files in userData). */
const RESERVED_LIBRARY_NAMES = new Set(['modules', 'backups', 'logs', 'outputs', 'sync', 'hub.db']);

export function createModuleFiles(options: {
  moduleId: string;
  modulesDataDir: string;
  /** v0.45.0: <userData>/<id>/, the user's files kept by the module (see ModuleFiles.libraryDir). */
  libraryDir?: string;
  assetsDir: string;
  getOutputRoot: () => string;
  host: HostAdapter;
  mediaUrl: (filePath: string) => string;
  /** v0.46.0: an external folder the UI may show (ctx.files.allowMediaRoot). */
  allowMediaRoot?: (dir: string) => () => void;
}): ModuleFiles {
  const dataDir = path.join(options.modulesDataDir, options.moduleId);
  mkdirSync(dataDir, { recursive: true });
  const libraryDir = () => {
    if (RESERVED_LIBRARY_NAMES.has(options.moduleId.toLowerCase()))
      throw new Error(`Nom de module réservé pour un dossier de fichiers : ${options.moduleId}`);
    return options.libraryDir ?? path.join(path.dirname(options.modulesDataDir), options.moduleId);
  };
  const outputDir = () => {
    const dir = path.join(options.getOutputRoot(), options.moduleId);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  return {
    assetsDir: options.assetsDir,
    assetPath: (...segments) => safeJoin(options.assetsDir, ...segments),
    mediaUrl: options.mediaUrl,
    ...(options.allowMediaRoot
      ? {
          allowMediaRoot: (dir: string) => {
            if (!path.isAbsolute(dir)) throw new Error('Dossier externe : chemin absolu attendu');
            return options.allowMediaRoot!(dir);
          },
        }
      : {}),
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
    outputDir,
    outputPath: (...segments) => safeJoin(outputDir(), ...segments),
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
    trash: async (target) => {
      // Only a file of this module's own data folder.
      const inside = safeJoin(dataDir, path.relative(dataDir, path.resolve(target)));
      if (inside === path.resolve(dataDir))
        throw new Error('Refus : le dossier du module lui-même');
      if (existsSync(inside)) await options.host.trashItem(inside);
    },
    readFile: (target) => readFileSync(target),
    fileSize: (target) => {
      try {
        return statSync(target).size;
      } catch {
        return null;
      }
    },
    writeFile: (target, data) => {
      // A file of the module's data, or a generated file of its output folder.
      const root = path.resolve(target).startsWith(path.resolve(outputDir()) + path.sep)
        ? outputDir()
        : dataDir;
      const inside = safeJoin(root, path.relative(root, path.resolve(target)));
      mkdirSync(path.dirname(inside), { recursive: true });
      writeFileSync(inside, data);
    },
    removeFile: (target) => {
      unlinkSync(safeJoin(dataDir, path.relative(dataDir, path.resolve(target))));
    },
    open: async (target, openOptions) => {
      // v0.45.0: never run a program, a script or a shortcut without a confirmation that named it.
      if (isRunnable(target) && !openOptions?.runnable)
        throw new Error(
          `Refus : « ${path.basename(target)} » lance un programme (confirmation nécessaire)`,
        );
      await options.host.openPath(target);
    },
    libraryDir: libraryDir(),
    libraryPath: (...segments) => safeJoin(libraryDir(), ...segments),
    provenance: (target) => {
      try {
        // NTFS keeps it in the file's alternate stream « :Zone.Identifier ».
        return parseZoneIdentifier(readFileSync(`${target}:Zone.Identifier`, 'utf8'));
      } catch {
        return null;
      }
    },
    reveal: (target) => options.host.showItemInFolder(target),
  };
}
