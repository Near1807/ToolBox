// ctx.files on the phone (ADR 0044): the module's data folder lives in OPFS
// (the app's private storage, like the base). The modules use it
// synchronously (writeFile, readFile…): the app's store keeps the files in
// memory, loaded at start, and writes them through to OPFS; the Worker waits
// for those writes before answering a request (mobile/app/src/opfs-files.ts).
// Images are shown through a blob: URL. What has no meaning on a phone
// (outputs folder, open in Explorer…) throws the explicit error.
// Portable: no Node import.
import type { ModuleFiles } from '../sdk/core';
import { partly } from './unavailable';

/** Where the files are: synchronous, by absolute path (« /modules/courses/images/x.jpg »). */
export interface FileStore {
  read(path: string): Uint8Array | null;
  write(path: string, data: Uint8Array): void;
  remove(path: string): void;
  /** A URL for <img> (blob:), or null when there is no file. */
  url(path: string): string | null;
}

/** A store in memory (tests; the app's store adds OPFS under it). */
export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Uint8Array>();
  read(path: string) {
    return this.files.get(path) ?? null;
  }
  write(path: string, data: Uint8Array) {
    this.files.set(path, data);
  }
  remove(path: string) {
    this.files.delete(path);
  }
  url(path: string) {
    return this.files.has(path) ? `blob:toolbox${path}` : null;
  }
}

/** `root` + segments, refusing any path that escapes it (same message as the PC). */
export function safeJoin(root: string, ...segments: string[]): string {
  const parts = root.split('/').filter(Boolean);
  const base = parts.length;
  for (const segment of segments.join('/').split(/[\\/]+/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === base)
        throw new Error(`Chemin hors du dossier autorisé : ${segments.join('/')}`);
      parts.pop();
    } else parts.push(segment);
  }
  return `/${parts.join('/')}`;
}

const inside = (root: string, path: string) => path.startsWith(`${root}/`);

/**
 * The module's ctx.files: its data folder in the store; `saveAs` through the
 * page (Android's share sheet). No Recycle Bin on a phone: `trash` deletes
 * the file (the module's row of it is a tombstone, as on the PC).
 */
export function phoneFiles(
  moduleId: string,
  store: FileStore | undefined,
  saveAs: ModuleFiles['saveAs'] | undefined,
): ModuleFiles {
  const dataDir = `/modules/${moduleId}`;
  const own = (path: string) => {
    const p = safeJoin('/', path);
    if (!inside(dataDir, p)) throw new Error(`Chemin hors du dossier autorisé : ${path}`);
    return p;
  };
  const provided: Partial<ModuleFiles> = {};
  if (saveAs) provided.saveAs = saveAs;
  if (store) {
    Object.assign(provided, {
      dataDir,
      dataPath: (...segments: string[]) => safeJoin(dataDir, ...segments),
      mediaUrlIfExists: (path: string | null | undefined) => {
        if (!path) return null;
        try {
          return store.url(own(path));
        } catch {
          return null;
        }
      },
      mediaUrl: (path: string) => {
        const url = store.url(own(path));
        if (!url) throw new Error(`Fichier introuvable : ${path}`);
        return url;
      },
      readFile: (path: string) => {
        const data = store.read(safeJoin('/', path));
        if (!data) throw new Error(`Fichier introuvable : ${path}`);
        return data;
      },
      fileSize: (path: string) => store.read(safeJoin('/', path))?.length ?? null,
      writeFile: (path: string, data: Uint8Array | string) =>
        store.write(own(path), typeof data === 'string' ? new TextEncoder().encode(data) : data),
      removeFile: (path: string) => store.remove(own(path)),
      trash: async (path: string) => {
        const p = own(path);
        if (p === dataDir) throw new Error('Refus : le dossier du module lui-même');
        store.remove(p);
      },
    } satisfies Partial<ModuleFiles>);
  }
  return partly<ModuleFiles>('files', provided);
}
