// v0.45.0: the Coffre du PC on the disk — userData/coffre (ctx.files.libraryDir).
// Its folders are Thomas's folders (Cours/Thermo/fichier.pdf: the route),
// readable without ToolBox; « _À ranger » holds what is not put away yet,
// « _Corbeille » what was deleted. The original a user drops is only READ (règle 6): the
// Coffre copies it. A name never replaces a file (« fichier (2).pdf »).
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { copyFile, cp, rename, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { PENDING_FOLDER, freeName, safeName, TRASH_FOLDER } from '../shared/names';

/** A relative path of the Coffre, always with « / ». */
export const toRel = (p: string) => p.split(path.sep).join('/');

/** sha256 of a file, read as a stream (any size). */
export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * v0.50.0: a file or folder renamed or moved on the PC. On Windows a folder whose file
 * is open for a moment (the reading of the texts, an antivirus, the indexer)
 * refuses (EPERM / EBUSY / EACCES): tried again for up to 3 s before failing.
 */
export async function renameHeld(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (attempt >= 30 || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw error;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

export class Library {
  /**
   * v0.46.0: `reserved(dirRel)` gives the names (lowercase) taken in a folder by
   * ARCHIVED elements (on the disk only, not in the folder): a new file never
   * takes one, so the PC and the disk keep the same paths.
   */
  constructor(
    readonly root: string,
    private readonly reserved: (dirRel: string) => Set<string> = () => new Set(),
  ) {}

  /** The Coffre's own folders, created on first use. */
  ensure(): void {
    for (const dir of [this.root, this.abs(PENDING_FOLDER), this.abs(TRASH_FOLDER)])
      mkdirSync(dir, { recursive: true });
  }

  /** v0.50.0: a folder of the Coffre created on the PC (its parents too). */
  ensureDir(rel: string): void {
    mkdirSync(this.abs(rel), { recursive: true });
  }

  /** The absolute path of a relative one, refusing anything outside the Coffre. */
  abs(rel: string): string {
    const root = path.resolve(this.root);
    const target = path.resolve(root, ...rel.split('/'));
    if (target !== root && !target.startsWith(root + path.sep))
      throw new Error(`Chemin hors du Coffre : ${rel}`);
    return target;
  }

  /** v0.48.0: the relative path of an absolute one inside the Coffre, or null (outside). */
  relOf(abs: string): string | null {
    const root = path.resolve(this.root);
    const target = path.resolve(abs);
    if (target === root) return '';
    const inside =
      process.platform === 'win32'
        ? target.toLowerCase().startsWith(root.toLowerCase() + path.sep)
        : target.startsWith(root + path.sep);
    return inside ? path.relative(root, target).split(path.sep).join('/') : null;
  }

  /** A free name in a folder (Windows: case does not count). */
  freeIn(dirAbs: string, name: string): string {
    const taken = new Set([
      ...(existsSync(dirAbs) ? readdirSync(dirAbs).map((n) => n.toLowerCase()) : []),
      ...this.reserved(toRel(path.relative(this.root, dirAbs))),
    ]);
    return freeName(safeName(name), (candidate) => taken.has(candidate.toLowerCase()));
  }

  /**
   * Copies a file or a whole folder (a project) into `relDir`, under a free
   * name; the original is only read. Returns the copy's relative path.
   */
  async copyIn(source: string, relDir: string, name: string): Promise<string> {
    const dirAbs = this.abs(relDir);
    mkdirSync(dirAbs, { recursive: true });
    const free = this.freeIn(dirAbs, name);
    const target = path.join(dirAbs, free);
    if (statSync(source).isDirectory())
      await cp(source, target, { recursive: true, errorOnExist: true, force: false });
    else await copyFile(source, target, fsConstants.COPYFILE_EXCL);
    return toRel(path.relative(this.root, target));
  }

  /** Moves an element (file or folder) into `relDir` under a free name; its new relative path. */
  async move(rel: string, relDir: string, name = path.basename(rel)): Promise<string> {
    const dirAbs = this.abs(relDir);
    mkdirSync(dirAbs, { recursive: true });
    if (path.dirname(this.abs(rel)) === dirAbs && path.basename(rel) === name) return rel;
    const target = path.join(dirAbs, this.freeIn(dirAbs, name));
    await renameHeld(this.abs(rel), target);
    return toRel(path.relative(this.root, target));
  }

  /** Deletes for good (the Coffre's Recycle Bin emptied, or a copy just made and undone). */
  async erase(rel: string): Promise<void> {
    const target = this.abs(rel);
    if (target === path.resolve(this.root)) throw new Error('Refus : le Coffre lui-même');
    // Windows: a file just written can be held a moment (antivirus, indexer): tried again.
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  exists(rel: string): boolean {
    return existsSync(this.abs(rel));
  }

  /** The disk holding the Coffre: free and total bytes (null when unknown). */
  async disk(): Promise<{ free: number | null; total: number | null }> {
    try {
      const s = await statfs(this.root);
      return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch {
      return { free: null, total: null };
    }
  }
}
