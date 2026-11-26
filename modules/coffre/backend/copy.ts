// v0.46.0: a copy that can never leave a wrong file at a good place (ADR 0055):
// read in pieces (any size: videos, projects) while computing the fingerprint,
// write under a TEMPORARY name, force it onto the medium, READ IT BACK and
// compare, and only then may the caller rename it to its place (`place`, which
// refuses to replace anything). Cancellable between two pieces; a cancelled or
// failed copy removes its temporary file (and when the disk is gone, the next
// update wipes the temporary folder: a temporary file is never taken for a
// good one).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDepsFolder } from './walk';
import { toRel } from './library';

const CHUNK = 1024 * 1024;

/** A cancellation (by the user, or ToolBox closing). */
export class Cancelled extends Error {
  constructor() {
    super('Annulée');
    this.name = 'Cancelled';
  }
}

/** The copy read back is not the file read: nothing is put in place. */
export class VerifyError extends Error {
  constructor(name: string) {
    super(`Copie de « ${name} » relue différente : rien n'est mis en place`);
    this.name = 'VerifyError';
  }
}

export interface CopyOptions {
  signal?: AbortSignal;
  /** Bytes read (or read back) since the last call. */
  onBytes?: (bytes: number) => void;
}

const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Cancelled();
};

/** sha256 of a file, read in pieces, cancellable. */
export async function hashFileChecked(file: string, options: CopyOptions = {}): Promise<string> {
  const hash = createHash('sha256');
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      check(options.signal);
      const { bytesRead } = await fh.read(buf, 0, CHUNK, null);
      if (!bytesRead) break;
      hash.update(buf.subarray(0, bytesRead));
      options.onBytes?.(bytesRead);
    }
  } finally {
    await fh.close();
  }
  return hash.digest('hex');
}

/**
 * Copies `source` to `temp` (created, never replaced), forced to the medium,
 * then read back: the fingerprint of what was read must be the fingerprint of
 * what was written. Returns it. On any failure, `temp` is removed.
 */
export async function copyFileVerified(
  source: string,
  temp: string,
  options: CopyOptions = {},
): Promise<{ sha256: string; size: number }> {
  await mkdir(path.dirname(temp), { recursive: true });
  const hash = createHash('sha256');
  let size = 0;
  try {
    const input = await open(source, 'r');
    try {
      const output = await open(temp, 'wx');
      try {
        const buf = Buffer.allocUnsafe(CHUNK);
        for (;;) {
          check(options.signal);
          const { bytesRead } = await input.read(buf, 0, CHUNK, null);
          if (!bytesRead) break;
          const piece = buf.subarray(0, bytesRead);
          hash.update(piece);
          let written = 0;
          while (written < bytesRead)
            written += (await output.write(piece, written, bytesRead - written)).bytesWritten;
          size += bytesRead;
          options.onBytes?.(bytesRead);
        }
        // On the medium before it can be read back (a power cut cannot leave half of it).
        await output.sync();
      } finally {
        await output.close();
      }
    } finally {
      await input.close();
    }
    const sha256 = hash.digest('hex');
    const again = await hashFileChecked(temp, { signal: options.signal });
    if (again !== sha256) throw new VerifyError(path.basename(source));
    return { sha256, size };
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Every file of a folder (relative, « / », sorted). */
export function listFiles(folder: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      // v0.50.0: a project's excluded folders (node_modules, build…) are never saved;
      // .git is (hidden, never excluded).
      if (entry.isDirectory() && isDepsFolder(entry.name, true)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(toRel(path.relative(folder, full)));
    }
  };
  walk(folder);
  return out.sort();
}

/** A project's fingerprint from its files' (library.ts hashFolder: the same formula). */
export function projectHash(files: readonly { rel: string; sha256: string }[]): string {
  const hash = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)))
    hash.update(`${f.rel}\0${f.sha256}\n`);
  return hash.digest('hex');
}

/** A whole folder (a project), each file copied and read back; the folder's fingerprint. */
export async function copyFolderVerified(
  source: string,
  temp: string,
  options: CopyOptions = {},
): Promise<{
  sha256: string;
  size: number;
  files: { rel: string; sha256: string; size: number }[];
}> {
  if (existsSync(temp)) throw new Error(`Dossier temporaire déjà présent : ${temp}`);
  try {
    const files: { rel: string; sha256: string; size: number }[] = [];
    for (const rel of listFiles(source)) {
      const r = await copyFileVerified(
        path.join(source, ...rel.split('/')),
        path.join(temp, ...rel.split('/')),
        options,
      );
      files.push({ rel, ...r });
    }
    await mkdir(temp, { recursive: true }); // an empty project is a folder too
    return {
      sha256: projectHash(files),
      size: files.reduce((s, f) => s + f.size, 0),
      files,
    };
  } catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** A file or a folder, verified (temp is the temporary name next to the place). */
export async function copyVerified(
  source: string,
  temp: string,
  options: CopyOptions = {},
): Promise<{ sha256: string; size: number }> {
  return (await stat(source)).isDirectory()
    ? copyFolderVerified(source, temp, options)
    : copyFileVerified(source, temp, options);
}

/** The fingerprint of a file or a folder as it is now (read back, cancellable). */
export async function fingerprint(target: string, options: CopyOptions = {}): Promise<string> {
  if (!(await stat(target)).isDirectory()) return hashFileChecked(target, options);
  const files: { rel: string; sha256: string }[] = [];
  for (const rel of listFiles(target))
    files.push({
      rel,
      sha256: await hashFileChecked(path.join(target, ...rel.split('/')), options),
    });
  return projectHash(files);
}

/**
 * Puts `from` at `to`, which must be free: a rename never replaces anything
 * (Windows would replace a file silently). Creates the folders on the way.
 */
export async function place(from: string, to: string): Promise<void> {
  if (existsSync(to)) throw new Error(`Place déjà prise : ${to}`);
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
}

/** Size of a file or of a folder's files. */
export async function sizeOf(target: string): Promise<number> {
  const s = await stat(target);
  if (!s.isDirectory()) return s.size;
  let total = 0;
  for (const rel of listFiles(target))
    total += (await stat(path.join(target, ...rel.split('/')))).size;
  return total;
}
